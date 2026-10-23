import { describe, expect, it } from 'vitest';

import {
  ATTRIBUTE_KEYS,
  MAX_ATTRIBUTE_LEVEL,
  RANKED_MAX_LEVEL,
  attributesForMode,
  effectsFor,
  normalizeForRanked,
  sanitizeAttributes,
  totalInvested,
  upgradeCost,
} from '@pfa/shared';

const MAXED = { impact: 5, stability: 5, control: 5, recovery: 5 };
const FRESH = { impact: 0, stability: 0, control: 0, recovery: 0 };

describe('attribute sanitising', () => {
  it('clamps and floors anything out of range', () => {
    expect(sanitizeAttributes({ impact: 99, stability: -4, control: 2.9, recovery: Number.NaN }))
      .toEqual({ impact: 5, stability: 0, control: 2, recovery: 0 });
  });

  it('defaults a missing object to zero', () => {
    expect(sanitizeAttributes(null)).toEqual(FRESH);
  });
});

describe('ranked normalisation', () => {
  it('compresses a fully upgraded pen to the ranked cap', () => {
    expect(normalizeForRanked(MAXED)).toEqual({
      impact: RANKED_MAX_LEVEL,
      stability: RANKED_MAX_LEVEL,
      control: RANKED_MAX_LEVEL,
      recovery: RANKED_MAX_LEVEL,
    });
  });

  it('maps levels exactly as documented: 0-2 to 0, 3-4 to 1, 5 to 2', () => {
    expect(normalizeForRanked({ ...FRESH, impact: 0 }).impact).toBe(0);
    expect(normalizeForRanked({ ...FRESH, impact: 1 }).impact).toBe(0);
    expect(normalizeForRanked({ ...FRESH, impact: 2 }).impact).toBe(0);
    expect(normalizeForRanked({ ...FRESH, impact: 3 }).impact).toBe(1);
    expect(normalizeForRanked({ ...FRESH, impact: 4 }).impact).toBe(1);
    expect(normalizeForRanked({ ...FRESH, impact: 5 }).impact).toBe(2);
  });

  it('only lets a fully maxed attribute reach the ranked cap', () => {
    expect(normalizeForRanked({ ...FRESH, control: 4 }).control).toBeLessThan(RANKED_MAX_LEVEL);
    expect(normalizeForRanked({ ...FRESH, control: 5 }).control).toBe(RANKED_MAX_LEVEL);
  });

  it('never raises a level', () => {
    for (let level = 0; level <= MAX_ATTRIBUTE_LEVEL; level += 1) {
      const normalised = normalizeForRanked({ ...FRESH, impact: level });
      expect(normalised.impact).toBeLessThanOrEqual(level);
    }
  });

  it('leaves casual attributes untouched', () => {
    expect(attributesForMode(MAXED, 'casual')).toEqual(MAXED);
    expect(attributesForMode(MAXED, 'ranked')).toEqual(normalizeForRanked(MAXED));
  });

  it('cuts the paid advantage to roughly a third', () => {
    const casualEdge = effectsFor(MAXED).launchSpeedMult - effectsFor(FRESH).launchSpeedMult;
    const rankedEdge =
      effectsFor(normalizeForRanked(MAXED)).launchSpeedMult -
      effectsFor(normalizeForRanked(FRESH)).launchSpeedMult;

    expect(casualEdge).toBeCloseTo(0.2, 6);
    expect(rankedEdge).toBeCloseTo(0.08, 6);
    expect(rankedEdge).toBeLessThan(casualEdge);
  });
});

describe('upgrade effects', () => {
  it('leaves a fresh pen on the baseline', () => {
    const effects = effectsFor(FRESH);
    expect(effects.launchSpeedMult).toBe(1);
    expect(effects.massMult).toBe(1);
    expect(effects.angularDampingBonus).toBe(0);
  });

  it('moves every curve in the right direction', () => {
    const fresh = effectsFor(FRESH);
    const maxed = effectsFor(MAXED);

    expect(maxed.launchSpeedMult).toBeGreaterThan(fresh.launchSpeedMult);
    expect(maxed.massMult).toBeGreaterThan(fresh.massMult);
    expect(maxed.aimSpreadDeg).toBeLessThan(fresh.aimSpreadDeg);
    expect(maxed.cooldownMs).toBeLessThan(fresh.cooldownMs);
  });

  it('keeps aim scatter positive even at max Control', () => {
    expect(effectsFor(MAXED).aimSpreadDeg).toBeGreaterThan(0);
  });
});

describe('upgrade costs', () => {
  it('gets more expensive each level and stops at the cap', () => {
    for (const key of ATTRIBUTE_KEYS) {
      let previous = 0;
      for (let level = 0; level < MAX_ATTRIBUTE_LEVEL; level += 1) {
        const cost = upgradeCost(key, level);
        expect(cost).not.toBeNull();
        expect(cost as number).toBeGreaterThan(previous);
        previous = cost as number;
      }
      expect(upgradeCost(key, MAX_ATTRIBUTE_LEVEL)).toBeNull();
    }
  });

  it('totals the investment for a maxed pen', () => {
    expect(totalInvested(FRESH)).toBe(0);
    expect(totalInvested(MAXED)).toBe(2 * (60 + 110 + 180 + 280 + 420) + 2 * (70 + 120 + 190 + 300 + 440));
  });
});
