import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

import { MAX_LAUNCH_SPEED, MIN_CHARGE_MS } from '@pfa/shared';
import type { AuthResult, RoomResult, Snapshot } from '@pfa/shared';

import { createApp } from '../src/app.js';
import type { RunningServer } from '../src/app.js';

let server: RunningServer;
let baseUrl: string;
let dataDir: string;

/** Waits for one event, failing loudly rather than hanging the suite. */
function once<T>(socket: Socket, event: string, timeoutMs = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeoutMs);

    const handler = (payload: T): void => {
      clearTimeout(timer);
      resolve(payload);
    };

    socket.once(event, handler);
  });
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, { transports: ['websocket'], forceNew: true });
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 15_000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function emitWithAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout for "${event}"`)), 15_000);
    socket.emit(event, payload, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function authenticate(socket: Socket, nickname: string, suffix: string): Promise<AuthResult> {
  return emitWithAck<AuthResult>(socket, 'auth', {
    clientId: `test${suffix}`.padEnd(24, '0'),
    nickname,
  });
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'pfa-mp-'));
  server = await createApp({
    port: 0,
    host: '127.0.0.1',
    disableDatabase: true,
    dataDir,
    publicUrl: 'http://localhost:5173',
    corsOrigins: [],
    serveClient: false,
  });
  const port = await server.listen(0);
  baseUrl = `http://127.0.0.1:${port}`;
}, 60_000);

afterAll(async () => {
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('two real clients against one authoritative server', () => {
  it('runs the full create, join, ready, play and finish flow', async () => {
    const alice = await connect();
    const bob = await connect();

    try {
      const aliceAuth = await authenticate(alice, 'Alice', 'alice');
      const bobAuth = await authenticate(bob, 'Bob', 'bob');

      expect(aliceAuth.ok).toBe(true);
      expect(bobAuth.ok).toBe(true);
      if (!aliceAuth.ok || !bobAuth.ok) return;

      // Each browser gets its own profile and its own ownership token.
      expect(aliceAuth.profile.id).not.toBe(bobAuth.profile.id);
      expect(aliceAuth.secret).toBeTruthy();

      const created = await emitWithAck<RoomResult>(alice, 'room:create', {
        mode: 'ranked',
        arenaId: 'classroom-morning',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const code = created.room.code;
      expect(code).toHaveLength(5);
      expect(created.room.inviteUrl).toContain(code);
      expect(created.slot).toBe('A');

      const joined = await emitWithAck<RoomResult>(bob, 'room:join', { code });
      expect(joined.ok).toBe(true);
      if (!joined.ok) return;
      expect(joined.slot).toBe('B');
      expect(joined.room.players).toHaveLength(2);

      // Both ready starts the countdown on both clients at once.
      const aliceStart = once<number>(alice, 'match:start', 20_000);
      const bobStart = once<number>(bob, 'match:start', 20_000);
      const countdownSeen = once<number>(bob, 'match:countdown', 20_000);

      alice.emit('room:ready', true);
      bob.emit('room:ready', true);

      await countdownSeen;
      await Promise.all([aliceStart, bobStart]);

      // Snapshots must reach both clients.
      const snapshots: Snapshot[] = [];
      alice.on('snapshot', (snapshot: Snapshot) => snapshots.push(snapshot));

      const bobSnapshot = await once<Snapshot>(bob, 'snapshot', 10_000);
      expect(bobSnapshot.pens).toHaveLength(2);
      expect(bobSnapshot.phase).toBe('playing');

      const startX = bobSnapshot.pens.find((pen) => pen.slot === 'A')?.position.x ?? 0;

      // Both players charge and fire at the same time - this is simultaneous,
      // real-time play, not turn taking.
      alice.emit('input:charge', { down: true });
      bob.emit('input:charge', { down: true });
      await new Promise((resolve) => setTimeout(resolve, MIN_CHARGE_MS + 450));

      alice.emit('input:fire', { dirX: 1, dirZ: 0, power: 1 });
      bob.emit('input:fire', { dirX: -1, dirZ: 0, power: 1 });

      await new Promise((resolve) => setTimeout(resolve, 2500));

      // The server moved the pens; the clients only ever asked.
      const latest = snapshots.at(-1);
      expect(latest).toBeDefined();
      const movedX = latest?.pens.find((pen) => pen.slot === 'A')?.position.x ?? startX;
      expect(Math.abs(movedX - startX)).toBeGreaterThan(0.5);

      // Nothing the clients sent produced a speed beyond the design maximum.
      const fastest = snapshots.reduce(
        (max, snapshot) => Math.max(max, ...snapshot.pens.map((pen) => pen.speed)),
        0,
      );
      expect(fastest).toBeGreaterThan(1);
      expect(fastest).toBeLessThan(MAX_LAUNCH_SPEED * 1.6);

      // Leaving ends the match for the player who stayed.
      const over = once<{ outcome: string }>(bob, 'match:over', 20_000);
      alice.emit('room:leave');
      const result = await over;
      expect(result.outcome).toBe('B');

      // And the result reached storage as a real record.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const history = await server.store.getMatchHistory(bobAuth.profile.id, 10);
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0]?.outcome).toBe('B');

      const refreshed = await server.store.getProfile(bobAuth.profile.id);
      expect(refreshed?.gamesPlayed).toBe(1);
      expect(refreshed?.wins).toBe(1);
      expect(refreshed?.coins).toBeGreaterThan(0);
    } finally {
      alice.close();
      bob.close();
    }
  }, 90_000);

  it('rejects a bad room code and a full room', async () => {
    const one = await connect();
    const two = await connect();
    const three = await connect();

    try {
      await authenticate(one, 'One', 'one');
      await authenticate(two, 'Two', 'two');
      await authenticate(three, 'Three', 'three');

      const missing = await emitWithAck<RoomResult>(two, 'room:join', { code: 'ZZZZZ' });
      expect(missing).toMatchObject({ ok: false });

      const malformed = await emitWithAck<RoomResult>(two, 'room:join', { code: 'no' });
      expect(malformed).toMatchObject({ ok: false, error: { code: 'bad_code' } });

      const created = await emitWithAck<RoomResult>(one, 'room:create', {
        mode: 'casual',
        arenaId: 'classroom-morning',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      expect(await emitWithAck<RoomResult>(two, 'room:join', { code: created.room.code })).toMatchObject({
        ok: true,
      });
      expect(
        await emitWithAck<RoomResult>(three, 'room:join', { code: created.room.code }),
      ).toMatchObject({ ok: false, error: { code: 'room_full' } });
    } finally {
      one.close();
      two.close();
      three.close();
    }
  }, 60_000);

  it('refuses an unknown nickname or client id at the door', async () => {
    const socket = await connect();
    try {
      const badId = await emitWithAck<AuthResult>(socket, 'auth', {
        clientId: 'short',
        nickname: 'Fine',
      });
      expect(badId).toMatchObject({ ok: false, error: { code: 'bad_client_id' } });

      const badName = await emitWithAck<AuthResult>(socket, 'auth', {
        clientId: 'validclientid1234567890',
        nickname: ' ',
      });
      expect(badName).toMatchObject({ ok: false, error: { code: 'bad_nickname' } });
    } finally {
      socket.close();
    }
  }, 30_000);

  it('will not let an unauthenticated socket open a room', async () => {
    const socket = await connect();
    try {
      const result = await emitWithAck<RoomResult>(socket, 'room:create', {
        mode: 'casual',
        arenaId: 'classroom-morning',
      });
      expect(result).toMatchObject({ ok: false, error: { code: 'not_authenticated' } });
    } finally {
      socket.close();
    }
  }, 30_000);
});

describe('play vs AI', () => {
  it('starts a practice match from one client, with no room code and no second player', async () => {
    const solo = await connect();

    try {
      const auth = await authenticate(solo, 'Practicer', 'practice');
      expect(auth.ok).toBe(true);
      if (!auth.ok) return;

      const started = await emitWithAck<RoomResult>(solo, 'solo:start', {
        difficulty: 'hard',
        arenaId: 'classroom-morning',
      });

      expect(started.ok).toBe(true);
      if (!started.ok) return;

      expect(started.slot).toBe('A');
      expect(started.room.vsAi).toBe('hard');
      expect(started.room.players).toHaveLength(2);

      const opponent = started.room.players.find((player) => player.slot === 'B');
      expect(opponent?.isAi).toBe(true);
      expect(opponent?.profile.nickname).toContain('AI');

      // No second client ever connects, yet the match starts on its own.
      await once<number>(solo, 'match:start', 25_000);

      const snapshot = await once<Snapshot>(solo, 'snapshot', 10_000);
      expect(snapshot.pens).toHaveLength(2);
      expect(snapshot.phase).toBe('playing');

      // The computer takes shots without any input from this client.
      const shot = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 12_000);
        solo.on('match:event', (event: { type: string; slot: string }) => {
          if (event.type === 'fire' && event.slot === 'B') {
            clearTimeout(timer);
            resolve(true);
          }
        });
      });
      expect(shot).toBe(true);

      solo.emit('room:leave');
    } finally {
      solo.close();
    }
  }, 90_000);

  it('rejects a practice match from a socket that has not signed in', async () => {
    const socket = await connect();
    try {
      const result = await emitWithAck<RoomResult>(socket, 'solo:start', {
        difficulty: 'easy',
        arenaId: 'classroom-morning',
      });
      expect(result).toMatchObject({ ok: false, error: { code: 'not_authenticated' } });
    } finally {
      socket.close();
    }
  }, 30_000);

  it('falls back to Medium when the difficulty is nonsense', async () => {
    const socket = await connect();
    try {
      const auth = await authenticate(socket, 'Fuzzer', 'fuzz');
      expect(auth.ok).toBe(true);

      const started = await emitWithAck<RoomResult>(socket, 'solo:start', {
        difficulty: 'impossible' as unknown as 'hard',
        arenaId: 'not-a-real-arena',
      });

      expect(started.ok).toBe(true);
      if (!started.ok) return;
      expect(started.room.vsAi).toBe('medium');
      expect(started.room.arenaId).toBe('classroom-morning');

      socket.emit('room:leave');
    } finally {
      socket.close();
    }
  }, 30_000);

  it('keeps practice results off the leaderboard', async () => {
    const socket = await connect();
    try {
      const auth = await authenticate(socket, 'Quiet', 'quiet');
      expect(auth.ok).toBe(true);
      if (!auth.ok) return;

      await emitWithAck<RoomResult>(socket, 'solo:start', {
        difficulty: 'easy',
        arenaId: 'classroom-morning',
      });
      socket.emit('room:leave');
      await new Promise((resolve) => setTimeout(resolve, 400));

      // No profile for the bot, and no match row for the practice game.
      const board = await server.store.leaderboard({ period: 'all', sort: 'rating', limit: 50 });
      expect(board.some((row) => row.nickname.includes('AI'))).toBe(false);

      const history = await server.store.getMatchHistory(auth.profile.id, 10);
      expect(history).toHaveLength(0);
    } finally {
      socket.close();
    }
  }, 45_000);
});

describe('REST surface', () => {
  it('reports health and the storage backend honestly', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.ok).toBe(true);

    const body = (await response.json()) as { ok: boolean; storage: { kind: string } };
    expect(body.ok).toBe(true);
    // This suite deliberately runs on the local JSON store.
    expect(body.storage.kind).toBe('local-json');
  });

  it('serves a leaderboard made only of real records', async () => {
    const response = await fetch(`${baseUrl}/api/leaderboard?period=all&sort=rating&limit=10`);
    const body = (await response.json()) as { rows: unknown[]; storage: string };
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.storage).toBe('local-json');
  });

  it('refuses to spend coins without the profile secret', async () => {
    const socket = await connect();
    try {
      const auth = await authenticate(socket, 'Spender', 'spend');
      expect(auth.ok).toBe(true);
      if (!auth.ok) return;

      const noSecret = await fetch(`${baseUrl}/api/profiles/${auth.profile.id}/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attribute: 'impact' }),
      });
      expect(noSecret.status).toBe(401);

      const wrongSecret = await fetch(`${baseUrl}/api/profiles/${auth.profile.id}/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pfa-secret': 'not-the-secret' },
        body: JSON.stringify({ attribute: 'impact' }),
      });
      expect(wrongSecret.status).toBe(403);

      const correct = await fetch(`${baseUrl}/api/profiles/${auth.profile.id}/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pfa-secret': auth.secret ?? '' },
        body: JSON.stringify({ attribute: 'impact' }),
      });
      expect(correct.status).toBe(200);

      const updated = (await correct.json()) as { attributes: { impact: number }; coins: number };
      expect(updated.attributes.impact).toBe(1);
      expect(updated.coins).toBeLessThan(auth.profile.coins);
    } finally {
      socket.close();
    }
  }, 30_000);
});
