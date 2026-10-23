import { describe, expect, it } from 'vitest';

import {
  MAX_NICKNAME_LENGTH,
  MIN_CHARGE_MS,
  RateLimiter,
  isValidClientId,
  isValidMode,
  isValidRoomCode,
  normalizeRoomCode,
  resolveArenaId,
  sanitizeNickname,
  validateFire,
} from '@pfa/shared';
import type { FireContext } from '@pfa/shared';

const baseContext: FireContext = {
  now: 10_000,
  isPlayer: true,
  phase: 'playing',
  chargeStartedAt: 10_000 - 400,
  nextFireAt: 0,
  eliminated: false,
};

const goodPayload = { power: 0.8, dirX: 1, dirZ: 0 };

describe('nickname sanitising', () => {
  it('trims and collapses whitespace', () => {
    expect(sanitizeNickname('  Shayondip   Mitra  ')).toBe('Shayondip Mitra');
  });

  it('strips control characters', () => {
    expect(sanitizeNickname('Sha\u0000yon\u001bdip')).toBe('Shayondip');
  });

  it('caps the length', () => {
    const long = 'x'.repeat(80);
    expect(sanitizeNickname(long)?.length).toBe(MAX_NICKNAME_LENGTH);
  });

  it('rejects empty, whitespace-only and non-string input', () => {
    expect(sanitizeNickname('')).toBeNull();
    expect(sanitizeNickname('   ')).toBeNull();
    expect(sanitizeNickname('a')).toBeNull();
    expect(sanitizeNickname(null)).toBeNull();
    expect(sanitizeNickname(42)).toBeNull();
  });
});

describe('identifiers', () => {
  it('accepts well-formed room codes and rejects ambiguous glyphs', () => {
    expect(isValidRoomCode('ABCDE')).toBe(true);
    // I, O, 0 and 1 are deliberately not in the alphabet.
    expect(isValidRoomCode('ABCDI')).toBe(false);
    expect(isValidRoomCode('ABC0E')).toBe(false);
    expect(isValidRoomCode('ABCD')).toBe(false);
    expect(isValidRoomCode(12345)).toBe(false);
  });

  it('normalises case and whitespace', () => {
    expect(normalizeRoomCode('  abcde ')).toBe('ABCDE');
    expect(normalizeRoomCode('nope')).toBeNull();
  });

  it('validates client ids and modes', () => {
    expect(isValidClientId('a'.repeat(32))).toBe(true);
    expect(isValidClientId('short')).toBe(false);
    expect(isValidClientId('has spaces in it')).toBe(false);
    expect(isValidMode('ranked')).toBe(true);
    expect(isValidMode('tournament')).toBe(false);
  });

  it('falls back to a known arena id', () => {
    const known = ['one', 'two'];
    expect(resolveArenaId('two', known, 'one')).toBe('two');
    expect(resolveArenaId('made-up', known, 'one')).toBe('one');
    expect(resolveArenaId(null, known, 'one')).toBe('one');
  });
});

describe('fire validation (anti-cheat)', () => {
  it('accepts a normal shot and re-normalises the direction', () => {
    const result = validateFire({ power: 0.5, dirX: 3, dirZ: 4 }, baseContext);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Math.hypot(result.dirX, result.dirZ)).toBeCloseTo(1, 6);
    expect(result.dirX).toBeCloseTo(0.6, 6);
  });

  it('clamps power into 0..1 rather than trusting the client', () => {
    const over = validateFire({ power: 99, dirX: 1, dirZ: 0 }, baseContext);
    expect(over.ok).toBe(true);
    if (over.ok) expect(over.power).toBe(1);

    const under = validateFire({ power: -5, dirX: 1, dirZ: 0 }, baseContext);
    expect(under.ok).toBe(true);
    if (under.ok) expect(under.power).toBe(0);
  });

  it('rejects a spectator', () => {
    const result = validateFire(goodPayload, { ...baseContext, isPlayer: false });
    expect(result).toMatchObject({ ok: false, code: 'not_a_player' });
  });

  it('rejects shots outside a running match', () => {
    expect(validateFire(goodPayload, { ...baseContext, phase: 'waiting' })).toMatchObject({
      ok: false,
      code: 'wrong_phase',
    });
  });

  it('rejects an eliminated pen', () => {
    expect(validateFire(goodPayload, { ...baseContext, eliminated: true })).toMatchObject({
      ok: false,
      code: 'eliminated',
    });
  });

  it('rejects a shot that was never charged', () => {
    expect(validateFire(goodPayload, { ...baseContext, chargeStartedAt: null })).toMatchObject({
      ok: false,
      code: 'no_charge',
    });
  });

  it('rejects a release faster than a human could manage', () => {
    const result = validateFire(goodPayload, {
      ...baseContext,
      chargeStartedAt: baseContext.now - (MIN_CHARGE_MS - 1),
    });
    expect(result).toMatchObject({ ok: false, code: 'charge_too_short' });
  });

  it('enforces the cooldown', () => {
    const result = validateFire(goodPayload, { ...baseContext, nextFireAt: baseContext.now + 1 });
    expect(result).toMatchObject({ ok: false, code: 'cooldown' });
  });

  it('rejects NaN, Infinity and a zero-length aim', () => {
    expect(validateFire({ power: Number.NaN, dirX: 1, dirZ: 0 }, baseContext)).toMatchObject({
      ok: false,
      code: 'bad_numbers',
    });
    expect(validateFire({ power: 1, dirX: Infinity, dirZ: 0 }, baseContext)).toMatchObject({
      ok: false,
      code: 'bad_numbers',
    });
    expect(validateFire({ power: 1, dirX: 0, dirZ: 0 }, baseContext)).toMatchObject({
      ok: false,
      code: 'bad_direction',
    });
  });

  it('rejects malformed payloads', () => {
    expect(validateFire(null, baseContext)).toMatchObject({ ok: false, code: 'bad_payload' });
    expect(validateFire('fire!', baseContext)).toMatchObject({ ok: false, code: 'bad_payload' });
    expect(validateFire({}, baseContext)).toMatchObject({ ok: false, code: 'bad_numbers' });
  });
});

describe('rate limiting', () => {
  it('allows a burst up to capacity and then refuses', () => {
    const limiter = new RateLimiter(5, 8, 0);
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.tryConsume(0)).toBe(true);
    }
    expect(limiter.tryConsume(0)).toBe(false);
  });

  it('refills over time', () => {
    const limiter = new RateLimiter(5, 10, 0);
    for (let i = 0; i < 5; i += 1) limiter.tryConsume(0);
    expect(limiter.tryConsume(0)).toBe(false);
    // 10 tokens per second: 300 ms buys three more.
    expect(limiter.tryConsume(300)).toBe(true);
  });

  it('never exceeds capacity no matter how long it idles', () => {
    const limiter = new RateLimiter(4, 10, 0);
    expect(limiter.available(600_000)).toBeLessThanOrEqual(4);
  });
});
