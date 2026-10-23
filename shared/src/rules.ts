import {
  DESK_HALF_X,
  DESK_HALF_Z,
  DESK_TOP_Y,
  DRAW_WINDOW_MS,
  FALL_MARGIN,
  MATCH_DURATION_MS,
  OUT_OF_BOUNDS_GRACE_MS,
  PEN_RADIUS,
  SHRINK_END_MS,
  SHRINK_MIN_SCALE,
  SHRINK_START_MS,
} from './constants.js';
import { clamp, clamp01, lerp } from './math.js';
import type { Vec3 } from './math.js';
import type { EliminationReason, MatchOutcome, ValidArea } from './types.js';

/**
 * The valid playing area.
 *
 * The desk itself never moves. What shrinks is the legal region marked on it,
 * which forces a resolution instead of letting two cautious players stall out
 * the clock. The region is full size until SHRINK_START_MS and then closes in
 * linearly to SHRINK_MIN_SCALE by SHRINK_END_MS.
 */
export function validAreaAt(elapsedMs: number): ValidArea {
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed <= SHRINK_START_MS) {
    return { halfX: DESK_HALF_X, halfZ: DESK_HALF_Z };
  }
  const span = SHRINK_END_MS - SHRINK_START_MS;
  const progress = clamp01(span <= 0 ? 1 : (elapsed - SHRINK_START_MS) / span);
  const scale = lerp(1, SHRINK_MIN_SCALE, progress);
  return { halfX: DESK_HALF_X * scale, halfZ: DESK_HALF_Z * scale };
}

/** True once a pen has dropped clear of the desk top. */
export function hasFallen(position: Vec3): boolean {
  return position.y < DESK_TOP_Y - FALL_MARGIN;
}

/**
 * True when the pen's centre is outside the marked region. The pen radius is
 * allowed as slack so a pen resting exactly on the line is still legal.
 */
export function isOutsideArea(position: Vec3, area: ValidArea): boolean {
  return (
    Math.abs(position.x) > area.halfX + PEN_RADIUS ||
    Math.abs(position.z) > area.halfZ + PEN_RADIUS
  );
}

export interface PenEvaluationInput {
  position: Vec3;
  area: ValidArea;
  /** Timestamp when the pen first went outside the area, or null if inside. */
  outsideSince: number | null;
  now: number;
}

export interface PenEvaluation {
  eliminated: boolean;
  reason: EliminationReason | null;
  /** Milliseconds left on the grace timer, or null when the pen is safe. */
  graceLeftMs: number | null;
  /** Updated outsideSince value for the caller to store. */
  outsideSince: number | null;
}

/**
 * Decides whether a pen is out.
 *
 * Falling off the desk is immediate. Sitting outside the marked region is not:
 * the player gets OUT_OF_BOUNDS_GRACE_MS to get back in, which keeps a glancing
 * overshoot recoverable and makes the shrinking region readable.
 */
export function evaluatePen(input: PenEvaluationInput): PenEvaluation {
  const { position, area, now } = input;

  if (hasFallen(position)) {
    return { eliminated: true, reason: 'fell', graceLeftMs: 0, outsideSince: input.outsideSince };
  }

  if (!isOutsideArea(position, area)) {
    return { eliminated: false, reason: null, graceLeftMs: null, outsideSince: null };
  }

  const since = input.outsideSince ?? now;
  const elapsed = now - since;
  if (elapsed >= OUT_OF_BOUNDS_GRACE_MS) {
    return { eliminated: true, reason: 'out_of_bounds', graceLeftMs: 0, outsideSince: since };
  }

  return {
    eliminated: false,
    reason: null,
    graceLeftMs: Math.max(0, OUT_OF_BOUNDS_GRACE_MS - elapsed),
    outsideSince: since,
  };
}

export interface ResultInput {
  /** Timestamp of player A's elimination, or null if still alive. */
  eliminatedAtA: number | null;
  eliminatedAtB: number | null;
  /** True once the match clock has run out. */
  timeUp: boolean;
}

export interface ResultDecision {
  outcome: MatchOutcome;
  reason: 'knockout' | 'simultaneous' | 'time';
}

/**
 * Decides the match result, or returns null while the match is still live.
 *
 * Two eliminations inside DRAW_WINDOW_MS count as simultaneous and draw -
 * without that window, whichever pen happened to touch the floor one physics
 * tick earlier would lose a mutual knock-out.
 */
export function decideResult(input: ResultInput): ResultDecision | null {
  const { eliminatedAtA, eliminatedAtB, timeUp } = input;

  if (eliminatedAtA !== null && eliminatedAtB !== null) {
    if (Math.abs(eliminatedAtA - eliminatedAtB) <= DRAW_WINDOW_MS) {
      return { outcome: 'draw', reason: 'simultaneous' };
    }
    return {
      outcome: eliminatedAtA < eliminatedAtB ? 'B' : 'A',
      reason: 'knockout',
    };
  }

  if (eliminatedAtA !== null) return { outcome: 'B', reason: 'knockout' };
  if (eliminatedAtB !== null) return { outcome: 'A', reason: 'knockout' };
  if (timeUp) return { outcome: 'draw', reason: 'time' };

  return null;
}

/** Milliseconds left on the match clock, floored at zero. */
export function timeLeftMs(elapsedMs: number): number {
  return Math.max(0, MATCH_DURATION_MS - Math.max(0, elapsedMs));
}

/** 0..1 progress of the shrinking region, for HUD warnings. */
export function shrinkProgress(elapsedMs: number): number {
  const span = SHRINK_END_MS - SHRINK_START_MS;
  if (span <= 0) return 1;
  return clamp01((elapsedMs - SHRINK_START_MS) / span);
}

/** Clamps a spawn-adjacent position back onto the desk, used when resetting a round. */
export function clampToDesk(position: Vec3): Vec3 {
  return {
    x: clamp(position.x, -DESK_HALF_X, DESK_HALF_X),
    y: position.y,
    z: clamp(position.z, -DESK_HALF_Z, DESK_HALF_Z),
  };
}
