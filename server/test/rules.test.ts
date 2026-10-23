import { describe, expect, it } from 'vitest';

import {
  DESK_HALF_X,
  DESK_HALF_Z,
  DESK_TOP_Y,
  DRAW_WINDOW_MS,
  FALL_MARGIN,
  MATCH_DURATION_MS,
  OUT_OF_BOUNDS_GRACE_MS,
  SHRINK_END_MS,
  SHRINK_MIN_SCALE,
  SHRINK_START_MS,
  decideResult,
  evaluatePen,
  hasFallen,
  isOutsideArea,
  timeLeftMs,
  validAreaAt,
} from '@pfa/shared';

const onDesk = { x: 0, y: DESK_TOP_Y + 0.05, z: 0 };

describe('valid playing area', () => {
  it('is the whole desk before the shrink starts', () => {
    expect(validAreaAt(0)).toEqual({ halfX: DESK_HALF_X, halfZ: DESK_HALF_Z });
    expect(validAreaAt(SHRINK_START_MS)).toEqual({ halfX: DESK_HALF_X, halfZ: DESK_HALF_Z });
  });

  it('closes in linearly and then stops', () => {
    const mid = validAreaAt((SHRINK_START_MS + SHRINK_END_MS) / 2);
    expect(mid.halfX).toBeLessThan(DESK_HALF_X);
    expect(mid.halfX).toBeGreaterThan(DESK_HALF_X * SHRINK_MIN_SCALE);

    const end = validAreaAt(SHRINK_END_MS);
    expect(end.halfX).toBeCloseTo(DESK_HALF_X * SHRINK_MIN_SCALE, 6);

    const later = validAreaAt(SHRINK_END_MS + 60_000);
    expect(later.halfX).toBeCloseTo(end.halfX, 6);
  });

  it('keeps the desk aspect ratio as it shrinks', () => {
    const area = validAreaAt(SHRINK_END_MS);
    expect(area.halfX / area.halfZ).toBeCloseTo(DESK_HALF_X / DESK_HALF_Z, 6);
  });
});

describe('falling', () => {
  it('is false for a pen resting on the desk', () => {
    expect(hasFallen(onDesk)).toBe(false);
  });

  it('is true once the pen is clear of the desk top', () => {
    expect(hasFallen({ x: 0, y: DESK_TOP_Y - FALL_MARGIN - 0.01, z: 0 })).toBe(true);
  });

  it('tolerates a pen bouncing slightly below the surface', () => {
    expect(hasFallen({ x: 0, y: DESK_TOP_Y - FALL_MARGIN + 0.2, z: 0 })).toBe(false);
  });
});

describe('area bounds', () => {
  const area = { halfX: DESK_HALF_X, halfZ: DESK_HALF_Z };

  it('accepts the centre', () => {
    expect(isOutsideArea(onDesk, area)).toBe(false);
  });

  it('accepts a pen sitting exactly on the line', () => {
    expect(isOutsideArea({ ...onDesk, x: DESK_HALF_X }, area)).toBe(false);
  });

  it('rejects a pen clear of the line', () => {
    expect(isOutsideArea({ ...onDesk, x: DESK_HALF_X + 0.5 }, area)).toBe(true);
    expect(isOutsideArea({ ...onDesk, z: -DESK_HALF_Z - 0.5 }, area)).toBe(true);
  });
});

describe('pen evaluation', () => {
  const area = { halfX: DESK_HALF_X, halfZ: DESK_HALF_Z };

  it('eliminates a fallen pen at once, with no grace', () => {
    const result = evaluatePen({
      position: { x: 0, y: 0, z: 0 },
      area,
      outsideSince: null,
      now: 1000,
    });
    expect(result.eliminated).toBe(true);
    expect(result.reason).toBe('fell');
  });

  it('starts a grace timer when a pen leaves the area', () => {
    const result = evaluatePen({
      position: { ...onDesk, x: DESK_HALF_X + 1 },
      area,
      outsideSince: null,
      now: 5000,
    });
    expect(result.eliminated).toBe(false);
    expect(result.outsideSince).toBe(5000);
    expect(result.graceLeftMs).toBe(OUT_OF_BOUNDS_GRACE_MS);
  });

  it('counts the grace down and then eliminates', () => {
    const halfway = evaluatePen({
      position: { ...onDesk, x: DESK_HALF_X + 1 },
      area,
      outsideSince: 5000,
      now: 5000 + OUT_OF_BOUNDS_GRACE_MS / 2,
    });
    expect(halfway.eliminated).toBe(false);
    expect(halfway.graceLeftMs).toBeCloseTo(OUT_OF_BOUNDS_GRACE_MS / 2, 6);

    const expired = evaluatePen({
      position: { ...onDesk, x: DESK_HALF_X + 1 },
      area,
      outsideSince: 5000,
      now: 5000 + OUT_OF_BOUNDS_GRACE_MS,
    });
    expect(expired.eliminated).toBe(true);
    expect(expired.reason).toBe('out_of_bounds');
  });

  it('clears the timer when the pen gets back inside', () => {
    const recovered = evaluatePen({ position: onDesk, area, outsideSince: 5000, now: 5500 });
    expect(recovered.eliminated).toBe(false);
    expect(recovered.outsideSince).toBeNull();
    expect(recovered.graceLeftMs).toBeNull();
  });
});

describe('match result', () => {
  it('stays open while both pens are alive', () => {
    expect(decideResult({ eliminatedAtA: null, eliminatedAtB: null, timeUp: false })).toBeNull();
  });

  it('awards the win to whoever is left', () => {
    expect(decideResult({ eliminatedAtA: 5000, eliminatedAtB: null, timeUp: false })).toEqual({
      outcome: 'B',
      reason: 'knockout',
    });
    expect(decideResult({ eliminatedAtA: null, eliminatedAtB: 5000, timeUp: false })).toEqual({
      outcome: 'A',
      reason: 'knockout',
    });
  });

  it('draws a simultaneous knock-out', () => {
    expect(
      decideResult({ eliminatedAtA: 5000, eliminatedAtB: 5000 + DRAW_WINDOW_MS, timeUp: false }),
    ).toEqual({ outcome: 'draw', reason: 'simultaneous' });
  });

  it('does not draw when one pen clearly went first', () => {
    expect(
      decideResult({
        eliminatedAtA: 5000,
        eliminatedAtB: 5000 + DRAW_WINDOW_MS + 1,
        timeUp: false,
      }),
    ).toEqual({ outcome: 'B', reason: 'knockout' });
  });

  it('draws when the clock runs out with both pens up', () => {
    expect(decideResult({ eliminatedAtA: null, eliminatedAtB: null, timeUp: true })).toEqual({
      outcome: 'draw',
      reason: 'time',
    });
  });

  it('still awards a knockout that lands as time expires', () => {
    expect(decideResult({ eliminatedAtA: 119_000, eliminatedAtB: null, timeUp: true })).toEqual({
      outcome: 'B',
      reason: 'knockout',
    });
  });
});

describe('clock', () => {
  it('counts down and never goes negative', () => {
    expect(timeLeftMs(0)).toBe(MATCH_DURATION_MS);
    expect(timeLeftMs(MATCH_DURATION_MS + 10_000)).toBe(0);
  });
});
