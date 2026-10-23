import { ELO_FLOOR } from './constants.js';
import { clamp } from './math.js';

/** Probability that player A beats player B, from the standard Elo curve. */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * K-factor. New accounts move fast so they reach their real level quickly;
 * high-rated accounts move slowly so the top of the ladder stays meaningful.
 */
export function kFactor(rating: number, gamesPlayed: number): number {
  if (gamesPlayed < 10) return 40;
  if (rating >= 2100) return 24;
  return 32;
}

export interface EloInput {
  rating: number;
  gamesPlayed: number;
}

export interface EloSide {
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
}

export interface EloUpdate {
  a: EloSide;
  b: EloSide;
}

/**
 * Applies one Elo update.
 *
 * `scoreA` is 1 for a win, 0.5 for a draw and 0 for a loss. Ratings are
 * rounded to whole points and never fall below ELO_FLOOR.
 */
export function updateElo(a: EloInput, b: EloInput, scoreA: number): EloUpdate {
  const score = clamp(scoreA, 0, 1);
  const expectedA = expectedScore(a.rating, b.rating);
  const expectedB = 1 - expectedA;

  const ka = kFactor(a.rating, a.gamesPlayed);
  const kb = kFactor(b.rating, b.gamesPlayed);

  const rawA = a.rating + ka * (score - expectedA);
  const rawB = b.rating + kb * (1 - score - expectedB);

  const afterA = Math.max(ELO_FLOOR, Math.round(rawA));
  const afterB = Math.max(ELO_FLOOR, Math.round(rawB));

  return {
    a: { ratingBefore: a.rating, ratingAfter: afterA, delta: afterA - a.rating },
    b: { ratingBefore: b.rating, ratingAfter: afterB, delta: afterB - b.rating },
  };
}

/** Converts a match outcome into player A's Elo score. */
export function outcomeToScoreA(outcome: 'A' | 'B' | 'draw'): number {
  if (outcome === 'A') return 1;
  if (outcome === 'B') return 0;
  return 0.5;
}
