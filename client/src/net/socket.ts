import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

import { SnapshotBuffer } from '@pfa/shared';
import type {
  AiDifficulty,
  AuthResult,
  ClientToServerEvents,
  GameMode,
  MatchEvent,
  RoomResult,
  ServerToClientEvents,
} from '@pfa/shared';

import { store } from '../state/store.js';

const CLIENT_ID_KEY = 'pfa.clientId.v1';
const SECRET_KEY = 'pfa.secret.v1';
const NICKNAME_KEY = 'pfa.nickname.v1';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * True when the tab was opened with ?guest=1.
 *
 * Guest tabs keep their identity in sessionStorage instead of localStorage, so
 * a second tab on the same browser is a genuinely separate player. That is what
 * makes local two-player testing a one-click affair.
 */
export function isGuestTab(): boolean {
  return new URLSearchParams(window.location.search).get('guest') === '1';
}

function storageFor(): Storage {
  return isGuestTab() ? window.sessionStorage : window.localStorage;
}

function readOrCreate(key: string, create: () => string): string {
  try {
    const existing = storageFor().getItem(key);
    if (existing) return existing;
    const created = create();
    storageFor().setItem(key, created);
    return created;
  } catch {
    // Storage blocked: fall back to a per-load identity.
    return create();
  }
}

export function getClientId(): string {
  return readOrCreate(CLIENT_ID_KEY, randomId);
}

export function getStoredSecret(): string | null {
  try {
    return storageFor().getItem(SECRET_KEY);
  } catch {
    return null;
  }
}

function storeSecret(secret: string): void {
  try {
    storageFor().setItem(SECRET_KEY, secret);
  } catch {
    // Nothing to do; the profile will be re-created next session.
  }
}

export function getStoredNickname(): string {
  try {
    return storageFor().getItem(NICKNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function storeNickname(nickname: string): void {
  try {
    storageFor().setItem(NICKNAME_KEY, nickname);
  } catch {
    // Ignore.
  }
}

export function roomCodeFromUrl(): string | null {
  const code = new URLSearchParams(window.location.search).get('room');
  return code ? code.trim().toUpperCase() : null;
}

export type MatchEventHandler = (event: MatchEvent) => void;

/**
 * The client's single connection to the authoritative server.
 *
 * It owns the snapshot buffer, the clock offset and the room-level events.
 * Nothing here simulates physics: the client sends intents and renders what
 * comes back.
 */
class NetClient {
  readonly buffer = new SnapshotBuffer();
  private socket: GameSocket | null = null;
  private pingTimer: number | null = null;
  private eventHandlers = new Set<MatchEventHandler>();
  private secret: string | null = getStoredSecret();

  onMatchEvent(handler: MatchEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  connect(): GameSocket {
    if (this.socket) return this.socket;

    const explicit = import.meta.env.VITE_SERVER_URL;
    const socket: GameSocket = explicit
      ? io(explicit, { transports: ['websocket', 'polling'] })
      : io({ transports: ['websocket', 'polling'] });

    this.socket = socket;

    socket.on('connect', () => {
      store.set({ connected: true });
      this.startPing();
    });

    socket.on('disconnect', (reason) => {
      store.set({ connected: false });
      this.stopPing();
      this.buffer.clear();
      if (reason !== 'io client disconnect') {
        store.toast('Connection lost. Reconnecting...', 'warn');
      }
    });

    socket.io.on('reconnect', () => {
      store.toast('Reconnected.', 'good');
      void this.authenticate(store.getState().profile?.nickname ?? getStoredNickname());
    });

    socket.on('room:state', (room) => {
      store.set({ room });
      if (room.phase === 'playing' || room.phase === 'countdown') {
        if (store.getState().screen !== 'match') store.navigate('match');
      }
    });

    socket.on('match:countdown', (secondsLeft) => {
      store.set({ countdown: secondsLeft, result: null });
      if (store.getState().screen !== 'match') store.navigate('match');
    });

    socket.on('match:start', () => {
      store.set({ countdown: null, result: null });
    });

    socket.on('snapshot', (snapshot) => {
      this.buffer.push(snapshot);
    });

    socket.on('match:event', (event) => {
      for (const handler of this.eventHandlers) handler(event);
    });

    socket.on('match:over', (result) => {
      store.set({ result, countdown: null });
    });

    socket.on('profile:update', (profile) => {
      store.set({ profile });
    });

    socket.on('server:error', (payload) => {
      // Cooldown and charge rejections are normal play feedback, not failures.
      const quiet = ['cooldown', 'charge_too_short', 'no_charge', 'wrong_phase'];
      if (!quiet.includes(payload.code)) {
        store.toast(payload.message, 'warn');
      }
    });

    return socket;
  }

  private startPing(): void {
    this.stopPing();
    const send = (): void => {
      const socket = this.socket;
      if (!socket?.connected) return;
      const sentAt = Date.now();
      socket.emit('net:ping', sentAt, (serverTime: number) => {
        const now = Date.now();
        const rtt = now - sentAt;
        // Server time at the midpoint of the round trip.
        this.buffer.setClockOffset(serverTime + rtt / 2 - now);
        store.set({ pingMs: rtt });
      });
    };
    send();
    this.pingTimer = window.setInterval(send, 3000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  async authenticate(nickname: string): Promise<AuthResult> {
    const socket = this.connect();

    if (!socket.connected) {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('connect_timeout')), 12_000);
        socket.once('connect', () => {
          window.clearTimeout(timeout);
          resolve();
        });
        socket.once('connect_error', (error) => {
          window.clearTimeout(timeout);
          reject(error instanceof Error ? error : new Error('connect_error'));
        });
      });
    }

    const result = await new Promise<AuthResult>((resolve) => {
      socket.emit(
        'auth',
        { clientId: getClientId(), nickname, secret: this.secret ?? undefined },
        resolve,
      );
    });

    if (result.ok) {
      if (result.secret) {
        this.secret = result.secret;
        storeSecret(result.secret);
      }
      storeNickname(result.profile.nickname);
      store.set({ profile: result.profile, storage: result.storage });
      this.buffer.setClockOffset(result.serverTime - Date.now());
    }

    return result;
  }

  get profileSecret(): string | null {
    return this.secret;
  }

  createRoom(mode: GameMode, arenaId: string): Promise<RoomResult> {
    return new Promise((resolve) => {
      const socket = this.connect();
      socket.emit('room:create', { mode, arenaId }, resolve);
    });
  }

  /**
   * Starts a single-player match against the computer.
   *
   * It goes through the same socket as online play, but the server seats an AI
   * opponent instead of waiting for a second person, so there is no room code
   * and no lobby step.
   */
  startSoloMatch(difficulty: AiDifficulty, arenaId: string): Promise<RoomResult> {
    return new Promise((resolve) => {
      const socket = this.connect();
      this.buffer.clear();
      socket.emit('solo:start', { difficulty, arenaId }, resolve);
    });
  }

  joinRoom(code: string): Promise<RoomResult> {
    return new Promise((resolve) => {
      const socket = this.connect();
      socket.emit('room:join', { code }, resolve);
    });
  }

  leaveRoom(): void {
    this.socket?.emit('room:leave');
    this.buffer.clear();
    store.set({ room: null, slot: null, result: null, countdown: null });
  }

  setReady(ready: boolean): void {
    this.socket?.emit('room:ready', ready);
  }

  voteRematch(): void {
    this.socket?.emit('rematch:vote');
  }

  setCharging(down: boolean): void {
    this.socket?.emit('input:charge', { down });
  }

  fire(dirX: number, dirZ: number, power: number): void {
    this.socket?.emit('input:fire', { dirX, dirZ, power });
  }
}

export const net = new NetClient();
