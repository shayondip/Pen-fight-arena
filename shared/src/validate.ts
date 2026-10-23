import {
  INPUT_RATE_CAPACITY,
  INPUT_RATE_REFILL_PER_SEC,
  MAX_NICKNAME_LENGTH,
  MIN_CHARGE_MS,
  MIN_NICKNAME_LENGTH,
  ROOM_CODE_LENGTH,
} from './constants.js';
import { clamp01, isFiniteNumber, normalize2 } from './math.js';
import { ROOM_CODE_ALPHABET } from './roomCode.js';
import type { FirePayload, GameMode, MatchPhase } from './types.js';

export interface ValidationFailure {
  ok: false;
  code: string;
  message: string;
}

export type ValidationResult<T> = ({ ok: true } & T) | ValidationFailure;

function fail(code: string, message: string): ValidationFailure {
  return { ok: false, code, message };
}

/**
 * Cleans a nickname. Control characters are stripped, runs of whitespace are
 * collapsed, and the result is length-checked. Returns null when nothing
 * usable survives, so callers never persist an empty or hostile name.
 */
export function sanitizeNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  if (collapsed.length < MIN_NICKNAME_LENGTH) return null;
  return collapsed.slice(0, MAX_NICKNAME_LENGTH);
}

export function isValidRoomCode(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  if (raw.length !== ROOM_CODE_LENGTH) return false;
  for (const char of raw) {
    if (!ROOM_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  return isValidRoomCode(upper) ? upper : null;
}

export function isValidMode(raw: unknown): raw is GameMode {
  return raw === 'casual' || raw === 'ranked';
}

export function isValidClientId(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(raw);
}

export interface FireContext {
  now: number;
  /** Whether this socket actually occupies a player seat in this match. */
  isPlayer: boolean;
  phase: MatchPhase;
  /** Set when the player is holding the charge button; null otherwise. */
  chargeStartedAt: number | null;
  /** Earliest timestamp at which this pen may fire again. */
  nextFireAt: number;
  eliminated: boolean;
}

export interface FireAccepted {
  power: number;
  dirX: number;
  dirZ: number;
  chargeMs: number;
}

/**
 * Server-side validation of a fire request.
 *
 * Everything a client sends is treated as an intent, never as a result: the
 * direction is re-normalised here, power is clamped into 0..1, and the shot is
 * rejected outright if the player has no seat, is eliminated, never held the
 * charge, released faster than a human can, or is still on cooldown.
 */
export function validateFire(
  payload: unknown,
  ctx: FireContext,
): ValidationResult<FireAccepted> {
  if (!ctx.isPlayer) {
    return fail('not_a_player', 'Only the two seated players can fire.');
  }
  if (ctx.phase !== 'playing') {
    return fail('wrong_phase', 'The match is not running.');
  }
  if (ctx.eliminated) {
    return fail('eliminated', 'Your pen is already out.');
  }
  if (payload === null || typeof payload !== 'object') {
    return fail('bad_payload', 'Malformed fire payload.');
  }

  const input = payload as Partial<FirePayload>;
  if (!isFiniteNumber(input.power) || !isFiniteNumber(input.dirX) || !isFiniteNumber(input.dirZ)) {
    return fail('bad_numbers', 'Fire payload must contain finite numbers.');
  }

  if (ctx.chargeStartedAt === null) {
    return fail('no_charge', 'You must charge before firing.');
  }

  const chargeMs = ctx.now - ctx.chargeStartedAt;
  if (chargeMs < MIN_CHARGE_MS) {
    return fail('charge_too_short', 'Released too fast to be a real charge.');
  }

  if (ctx.now < ctx.nextFireAt) {
    return fail('cooldown', 'Your pen is still recovering.');
  }

  const direction = normalize2(input.dirX, input.dirZ);
  if (!direction) {
    return fail('bad_direction', 'Aim direction has no length.');
  }

  return {
    ok: true,
    power: clamp01(input.power),
    dirX: direction.x,
    dirZ: direction.z,
    chargeMs,
  };
}

/**
 * Token bucket limiter. Each socket gets its own instance so one noisy or
 * scripted client cannot flood the match loop.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number = INPUT_RATE_CAPACITY,
    private readonly refillPerSecond: number = INPUT_RATE_REFILL_PER_SEC,
    now: number = Date.now(),
  ) {
    this.tokens = capacity;
    this.lastRefill = now;
  }

  /** Consumes one token. Returns false when the caller is over budget. */
  tryConsume(now: number = Date.now()): boolean {
    this.refill(now);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  available(now: number = Date.now()): number {
    this.refill(now);
    return this.tokens;
  }

  private refill(now: number): void {
    const elapsedSeconds = Math.max(0, now - this.lastRefill) / 1000;
    if (elapsedSeconds <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.lastRefill = now;
  }
}

/** Clamps an arena id to one the server actually knows about. */
export function resolveArenaId(raw: unknown, known: readonly string[], fallback: string): string {
  if (typeof raw === 'string' && known.includes(raw)) return raw;
  return fallback;
}
