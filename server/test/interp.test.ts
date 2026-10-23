import { describe, expect, it } from 'vitest';

import { INTERP_DELAY_MS, SnapshotBuffer, normalizeQuat, slerpQuat } from '@pfa/shared';
import type { Snapshot } from '@pfa/shared';

function snapshot(seq: number, t: number, xA: number, xB: number): Snapshot {
  const pen = (slot: 'A' | 'B', x: number) => ({
    slot,
    position: { x, y: 7.55, z: 0 },
    rotation: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
    speed: 0,
    charging: false,
    chargePower: 0,
    nextFireAt: 0,
    eliminated: false,
    eliminationReason: null,
    graceLeftMs: null,
  });

  return {
    seq,
    t,
    phase: 'playing',
    timeLeftMs: 120_000 - t,
    area: { halfX: 6, halfZ: 4 },
    pens: [pen('A', xA), pen('B', xB)],
  };
}

describe('snapshot buffer', () => {
  it('returns nothing before the first snapshot arrives', () => {
    expect(new SnapshotBuffer().sample(1000)).toBeNull();
  });

  it('interpolates halfway between two snapshots', () => {
    const buffer = new SnapshotBuffer(0);
    buffer.push(snapshot(1, 1000, 0, 10));
    buffer.push(snapshot(2, 1100, 2, 8));

    const sample = buffer.sample(1050);
    expect(sample).not.toBeNull();
    expect(sample?.pens.find((pen) => pen.slot === 'A')?.position.x).toBeCloseTo(1, 6);
    expect(sample?.pens.find((pen) => pen.slot === 'B')?.position.x).toBeCloseTo(9, 6);
  });

  it('applies the render delay', () => {
    const buffer = new SnapshotBuffer(INTERP_DELAY_MS);
    buffer.push(snapshot(1, 1000, 0, 10));
    buffer.push(snapshot(2, 1000 + INTERP_DELAY_MS, 10, 0));

    // Sampling at the newest timestamp should show the OLDER state, because the
    // client deliberately renders INTERP_DELAY_MS in the past.
    const sample = buffer.sample(1000 + INTERP_DELAY_MS);
    expect(sample?.pens.find((pen) => pen.slot === 'A')?.position.x).toBeCloseTo(0, 6);
  });

  it('flags extrapolation when it runs past the newest snapshot', () => {
    const buffer = new SnapshotBuffer(0);
    buffer.push(snapshot(1, 1000, 0, 10));
    expect(buffer.sample(9000)?.extrapolated).toBe(true);
  });

  it('drops out-of-order and duplicate deliveries', () => {
    const buffer = new SnapshotBuffer(0);
    buffer.push(snapshot(5, 1000, 0, 10));
    buffer.push(snapshot(4, 900, 99, 99));
    buffer.push(snapshot(5, 1000, 77, 77));

    expect(buffer.size).toBe(1);
    expect(buffer.latest?.pens[0]?.position.x).toBe(0);
  });

  it('keeps the buffer bounded under a long stream', () => {
    const buffer = new SnapshotBuffer(0);
    for (let i = 0; i < 400; i += 1) {
      buffer.push(snapshot(i + 1, 1000 + i * 50, i, -i));
    }
    expect(buffer.size).toBeLessThan(40);
    expect(buffer.latest?.seq).toBe(400);
  });

  it('applies the clock offset when sampling', () => {
    const buffer = new SnapshotBuffer(0);
    buffer.setClockOffset(5000);
    buffer.push(snapshot(1, 6000, 0, 10));
    buffer.push(snapshot(2, 6100, 2, 8));

    // Client time 1050 + offset 5000 = server time 6050, i.e. halfway.
    expect(buffer.sample(1050)?.pens[0]?.position.x).toBeCloseTo(1, 6);
  });

  it('interpolates area shrink alongside position', () => {
    const buffer = new SnapshotBuffer(0);
    const first = snapshot(1, 1000, 0, 0);
    const second = snapshot(2, 1100, 0, 0);
    second.area = { halfX: 4, halfZ: 2 };
    buffer.push(first);
    buffer.push(second);

    expect(buffer.sample(1050)?.area.halfX).toBeCloseTo(5, 6);
  });
});

describe('quaternion blending', () => {
  it('returns the endpoints exactly', () => {
    const a = { x: 0, y: 0, z: 0, w: 1 };
    const b = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
    expect(slerpQuat(a, b, 0).w).toBeCloseTo(1, 6);
    expect(slerpQuat(a, b, 1).w).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('stays a unit quaternion in between', () => {
    // Inputs are normalised first: slerp preserves unit length, it does not
    // manufacture it, so feeding it a slightly-off quaternion would be testing
    // the test rather than the code.
    const a = normalizeQuat({ x: 0.2, y: 0.3, z: 0.1, w: 0.927 });
    const b = normalizeQuat({ x: -0.5, y: 0.5, z: 0.5, w: 0.5 });
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const q = slerpQuat(a, b, t);
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 4);
    }
  });

  it('takes the short way round', () => {
    const a = { x: 0, y: 0, z: 0, w: 1 };
    const b = { x: 0, y: 0, z: 0, w: -1 };
    const mid = slerpQuat(a, b, 0.5);
    expect(Math.abs(mid.w)).toBeCloseTo(1, 4);
  });
});
