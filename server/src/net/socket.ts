import { randomUUID } from 'node:crypto';

import { Server as SocketServer } from 'socket.io';
import type { Socket } from 'socket.io';

import {
  ARENA_IDS,
  DEFAULT_ARENA_ID,
  RateLimiter,
  isAiDifficulty,
  isValidClientId,
  isValidMode,
  normalizeRoomCode,
  resolveArenaId,
  sanitizeNickname,
} from '@pfa/shared';
import type {
  AuthPayload,
  AuthResult,
  ChargePayload,
  ClientToServerEvents,
  CreateRoomPayload,
  JoinRoomPayload,
  PlayerProfile,
  RoomResult,
  StartSoloPayload,
  ServerToClientEvents,
} from '@pfa/shared';

import { logger } from '../logger.js';
import type { RoomManager } from '../game/rooms.js';
import type { Store } from '../store/types.js';

export type GameSocketServer = SocketServer<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

interface Session {
  profile: PlayerProfile | null;
  limiter: RateLimiter;
}

function ackError(code: string, message: string): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } };
}

/**
 * Wires the Socket.IO protocol to the room manager.
 *
 * Every handler here treats its payload as hostile: identifiers are format
 * checked, nicknames are sanitised, arena ids are resolved against the known
 * list, and each socket carries a token bucket so a scripted client cannot
 * flood the simulation. Nothing in this layer touches physics directly.
 */
export function attachSocketHandlers(
  io: GameSocketServer,
  store: Store,
  rooms: RoomManager,
): void {
  const sessions = new Map<string, Session>();

  io.on('connection', (socket: GameSocket) => {
    sessions.set(socket.id, { profile: null, limiter: new RateLimiter() });
    logger.debug(`Socket connected: ${socket.id}`);

    const session = (): Session => {
      const existing = sessions.get(socket.id);
      if (existing) return existing;
      const created: Session = { profile: null, limiter: new RateLimiter() };
      sessions.set(socket.id, created);
      return created;
    };

    const withinBudget = (): boolean => {
      if (session().limiter.tryConsume()) return true;
      socket.emit('server:error', {
        code: 'rate_limited',
        message: 'Too many inputs too quickly.',
      });
      return false;
    };

    socket.on('auth', async (payload: AuthPayload, ack) => {
      try {
        if (!payload || !isValidClientId(payload.clientId)) {
          ack?.(ackError('bad_client_id', 'Invalid client identifier.') as AuthResult);
          return;
        }

        const nickname = sanitizeNickname(payload.nickname);
        if (!nickname) {
          ack?.(
            ackError('bad_nickname', 'Pick a nickname of 2 to 16 characters.') as AuthResult,
          );
          return;
        }

        const secret = typeof payload.secret === 'string' && payload.secret.length >= 8
          ? payload.secret
          : randomUUID();

        const authenticated = await store.authenticate({
          clientId: payload.clientId,
          nickname,
          secret,
        });

        if (!authenticated) {
          ack?.(
            ackError(
              'auth_failed',
              'That profile belongs to another device. Clear site data or use ?guest=1 for a fresh profile.',
            ) as AuthResult,
          );
          return;
        }

        session().profile = authenticated.profile;

        const result: AuthResult = {
          ok: true,
          profile: authenticated.profile,
          storage: store.status(),
          secret: authenticated.issuedSecret,
          rejoinRoom: rooms.findRoomForClient(authenticated.profile.clientId),
          serverTime: Date.now(),
        };
        ack?.(result);
      } catch (error) {
        logger.error('auth failed', error);
        ack?.(ackError('server_error', 'Could not sign you in.') as AuthResult);
      }
    });

    socket.on('room:create', (payload: CreateRoomPayload, ack) => {
      const profile = session().profile;
      if (!profile) {
        ack?.(ackError('not_authenticated', 'Sign in first.') as RoomResult);
        return;
      }
      if (!withinBudget()) {
        ack?.(ackError('rate_limited', 'Slow down.') as RoomResult);
        return;
      }

      const mode = isValidMode(payload?.mode) ? payload.mode : 'casual';
      const arenaId = resolveArenaId(payload?.arenaId, ARENA_IDS, DEFAULT_ARENA_ID);
      ack?.(rooms.createRoom(socket.id, profile, mode, arenaId) as RoomResult);
    });

    socket.on('room:join', (payload: JoinRoomPayload, ack) => {
      const profile = session().profile;
      if (!profile) {
        ack?.(ackError('not_authenticated', 'Sign in first.') as RoomResult);
        return;
      }
      if (!withinBudget()) {
        ack?.(ackError('rate_limited', 'Slow down.') as RoomResult);
        return;
      }

      const code = normalizeRoomCode(payload?.code);
      if (!code) {
        ack?.(ackError('bad_code', 'Room codes are 5 characters.') as RoomResult);
        return;
      }

      ack?.(rooms.joinRoom(socket.id, profile, code) as RoomResult);
    });

    socket.on('solo:start', async (payload: StartSoloPayload, ack) => {
      const profile = session().profile;
      if (!profile) {
        ack?.(ackError('not_authenticated', 'Sign in first.') as RoomResult);
        return;
      }
      if (!withinBudget()) {
        ack?.(ackError('rate_limited', 'Slow down.') as RoomResult);
        return;
      }

      const difficulty = isAiDifficulty(payload?.difficulty) ? payload.difficulty : 'medium';
      const arenaId = resolveArenaId(payload?.arenaId, ARENA_IDS, DEFAULT_ARENA_ID);

      try {
        const result = await rooms.createSoloRoom(socket.id, profile, difficulty, arenaId);
        ack?.(result as RoomResult);
      } catch (error) {
        logger.error('solo:start failed', error);
        ack?.(ackError('server_error', 'Could not start the practice match.') as RoomResult);
      }
    });

    socket.on('room:leave', () => {
      rooms.leave(socket.id);
    });

    socket.on('room:ready', (ready: boolean) => {
      if (!withinBudget()) return;
      rooms.setReady(socket.id, Boolean(ready));
    });

    socket.on('input:charge', (payload: ChargePayload) => {
      if (!withinBudget()) return;
      rooms.handleCharge(socket.id, Boolean(payload?.down));
    });

    socket.on('input:fire', (payload) => {
      if (!withinBudget()) return;
      rooms.handleFire(socket.id, payload);
    });

    socket.on('rematch:vote', () => {
      if (!withinBudget()) return;
      rooms.voteRematch(socket.id);
    });

    socket.on('net:ping', (clientTime: number, ack) => {
      ack?.(Date.now());
    });

    socket.on('disconnect', (reason) => {
      logger.debug(`Socket disconnected: ${socket.id} (${reason})`);
      rooms.handleDisconnect(socket.id);
      sessions.delete(socket.id);
    });
  });
}

/** Broadcaster implementation backed by Socket.IO rooms. */
export function createBroadcaster(io: GameSocketServer) {
  return {
    attach(socketId: string, code: string): void {
      io.sockets.sockets.get(socketId)?.join(`room:${code}`);
    },
    detach(socketId: string, code: string): void {
      io.sockets.sockets.get(socketId)?.leave(`room:${code}`);
    },
    roomState(code: string, view: Parameters<ServerToClientEvents['room:state']>[0]): void {
      io.to(`room:${code}`).emit('room:state', view);
    },
    countdown(code: string, secondsLeft: number): void {
      io.to(`room:${code}`).emit('match:countdown', secondsLeft);
    },
    matchStart(code: string, startedAt: number): void {
      io.to(`room:${code}`).emit('match:start', startedAt);
    },
    snapshot(code: string, snapshot: Parameters<ServerToClientEvents['snapshot']>[0]): void {
      io.to(`room:${code}`).emit('snapshot', snapshot);
    },
    matchEvent(code: string, event: Parameters<ServerToClientEvents['match:event']>[0]): void {
      io.to(`room:${code}`).emit('match:event', event);
    },
    matchOver(code: string, result: Parameters<ServerToClientEvents['match:over']>[0]): void {
      io.to(`room:${code}`).emit('match:over', result);
    },
    profileUpdate(socketId: string, profile: PlayerProfile): void {
      io.to(socketId).emit('profile:update', profile);
    },
    error(socketId: string, payload: { code: string; message: string }): void {
      io.to(socketId).emit('server:error', payload);
    },
  };
}
