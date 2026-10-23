import { clamp } from './math.js';
import { MAX_ATTRIBUTE_LEVEL, sanitizeAttributes } from './upgrades.js';
import type { GameMode, PenAttributes } from './types.js';

/**
 * Ranked attribute normalisation.
 *
 * Casual matches use whatever the player bought. Ranked compresses every
 * attribute so the ladder measures aim and timing rather than coin totals: a
 * level is scaled by RANKED_SCALE, floored, and capped at RANKED_MAX_LEVEL.
 *
 *   levels 0, 1, 2 -> 0      levels 3, 4 -> 1      level 5 -> 2
 *
 * Flooring rather than rounding is deliberate. It means the early levels buy
 * nothing on the ladder and only a fully maxed attribute reaches the ranked
 * cap, so the top tier stays worth earning while a half-upgraded wallet
 * confers no ranked advantage at all. With the curves in upgrades.ts a fully
 * upgraded ranked pen ends up about 8% stronger on impact than a brand-new
 * one, against 20% in casual.
 */
export const RANKED_SCALE = 0.4;
export const RANKED_MAX_LEVEL = 2;

export function normalizeForRanked(levels: PenAttributes): PenAttributes {
  const safe = sanitizeAttributes(levels);
  const scale = (value: number): number =>
    clamp(Math.floor(value * RANKED_SCALE), 0, RANKED_MAX_LEVEL);

  return {
    impact: scale(safe.impact),
    stability: scale(safe.stability),
    control: scale(safe.control),
    recovery: scale(safe.recovery),
  };
}

/** Attributes actually in force for a mode. */
export function attributesForMode(levels: PenAttributes, mode: GameMode): PenAttributes {
  return mode === 'ranked' ? normalizeForRanked(levels) : sanitizeAttributes(levels);
}

/** Highest level reachable in ranked play, for UI copy. */
export function rankedCapFor(level: number): number {
  return clamp(Math.floor(clamp(level, 0, MAX_ATTRIBUTE_LEVEL) * RANKED_SCALE), 0, RANKED_MAX_LEVEL);
}
