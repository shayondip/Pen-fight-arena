import { describe, expect, it } from 'vitest';

import { ELO_FLOOR, expectedScore, kFactor, outcomeToScoreA, updateElo } from '@pfa/shared';

describe('Elo', () => {
  it('gives even odds to equal ratings', () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5, 6);
  });

  it('favours the higher rating', () => {
    expect(expectedScore(1400, 1000)).toBeGreaterThan(0.9);
    expect(expectedScore(1000, 1400)).toBeLessThan(0.1);
  });

  it('is symmetric', () => {
    expect(expectedScore(1337, 1042) + expectedScore(1042, 1337)).toBeCloseTo(1, 6);
  });

  it('moves new accounts faster and elite accounts slower', () => {
    expect(kFactor(1000, 3)).toBe(40);
    expect(kFactor(1000, 50)).toBe(32);
    expect(kFactor(2200, 50)).toBe(24);
  });

  it('is zero sum when both sides share a K-factor', () => {
    const result = updateElo({ rating: 1000, gamesPlayed: 50 }, { rating: 1200, gamesPlayed: 50 }, 1);
    expect(result.a.delta + result.b.delta).toBe(0);
    expect(result.a.delta).toBeGreaterThan(0);
    expect(result.b.delta).toBeLessThan(0);
  });

  it('rewards beating a stronger opponent more than beating a weaker one', () => {
    const upset = updateElo({ rating: 1000, gamesPlayed: 50 }, { rating: 1600, gamesPlayed: 50 }, 1);
    const expected = updateElo({ rating: 1600, gamesPlayed: 50 }, { rating: 1000, gamesPlayed: 50 }, 1);
    expect(upset.a.delta).toBeGreaterThan(expected.a.delta);
  });

  it('barely moves a rating after an expected win', () => {
    const result = updateElo({ rating: 1800, gamesPlayed: 80 }, { rating: 1000, gamesPlayed: 80 }, 1);
    expect(result.a.delta).toBeLessThanOrEqual(2);
  });

  it('splits a draw towards the weaker player', () => {
    const result = updateElo({ rating: 1000, gamesPlayed: 60 }, { rating: 1400, gamesPlayed: 60 }, 0.5);
    expect(result.a.delta).toBeGreaterThan(0);
    expect(result.b.delta).toBeLessThan(0);
  });

  it('never drops a rating below the floor', () => {
    const result = updateElo(
      { rating: ELO_FLOOR, gamesPlayed: 200 },
      { rating: 2400, gamesPlayed: 200 },
      0,
    );
    expect(result.a.ratingAfter).toBeGreaterThanOrEqual(ELO_FLOOR);
  });

  it('maps outcomes to scores', () => {
    expect(outcomeToScoreA('A')).toBe(1);
    expect(outcomeToScoreA('B')).toBe(0);
    expect(outcomeToScoreA('draw')).toBe(0.5);
  });
});
