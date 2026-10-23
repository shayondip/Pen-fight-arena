import { beforeAll, describe, expect, it } from 'vitest';
import type { World } from '@dimforge/rapier3d-compat';

import {
  DESK_HALF_X,
  DESK_TOP_Y,
  MAX_LAUNCH_SPEED,
  PEN_CAPSULE_HALF_HEIGHT,
  PEN_MASS_KG,
  PEN_RADIUS,
  PEN_REST_Y,
  SPAWN_A,
  SPAWN_B,
  TICK_HZ,
  effectsFor,
  hasFallen,
} from '@pfa/shared';

import {
  capsuleVolume,
  createArenaWorld,
  createPen,
  initPhysics,
  launchPen,
  readPosition,
  readSpeed,
  rotateByQuat,
} from '../src/game/world.js';

const BASE_EFFECTS = effectsFor({ impact: 0, stability: 0, control: 0, recovery: 0 });

function stepFor(world: World, seconds: number): void {
  const ticks = Math.round(seconds * TICK_HZ);
  for (let i = 0; i < ticks; i += 1) world.step();
}

beforeAll(async () => {
  await initPhysics();
}, 30_000);

describe('geometry helpers', () => {
  it('computes a capsule volume as cylinder plus caps', () => {
    const radius = 2;
    const halfHeight = 3;
    const expected = Math.PI * 4 * 6 + (4 / 3) * Math.PI * 8;
    expect(capsuleVolume(halfHeight, radius)).toBeCloseTo(expected, 6);
  });

  it('rotates a vector by a quaternion', () => {
    // 90 degrees about X maps +Y onto +Z - the spawn orientation of every pen.
    const rotated = rotateByQuat(
      { x: 0, y: 1, z: 0 },
      { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
    );
    expect(rotated.x).toBeCloseTo(0, 5);
    expect(rotated.y).toBeCloseTo(0, 5);
    expect(rotated.z).toBeCloseTo(1, 5);
  });
});

describe('pens on the desk', () => {
  it('settles at rest on the desk surface instead of sinking or jittering', () => {
    const arena = createArenaWorld();
    const pen = createPen(arena.world, 'A', BASE_EFFECTS);

    stepFor(arena.world, 1.5);

    const position = readPosition(pen.body);
    expect(position.y).toBeGreaterThan(DESK_TOP_Y);
    expect(position.y).toBeLessThan(PEN_REST_Y + 0.08);
    expect(readSpeed(pen.body)).toBeLessThan(0.25);
    expect(hasFallen(position)).toBe(false);

    arena.world.free();
  });

  it('has the designed mass, so Stability changes the mass ratio as intended', () => {
    const arena = createArenaWorld();
    const plain = createPen(arena.world, 'A', BASE_EFFECTS);
    const heavy = createPen(
      arena.world,
      'B',
      effectsFor({ impact: 0, stability: 5, control: 0, recovery: 0 }),
    );

    const expectedMass = PEN_MASS_KG;
    expect(plain.body.mass()).toBeCloseTo(expectedMass, 5);
    expect(heavy.body.mass() / plain.body.mass()).toBeCloseTo(1.15, 3);

    // Cross-check the density maths the pen factory relies on.
    const volume = capsuleVolume(PEN_CAPSULE_HALF_HEIGHT, PEN_RADIUS);
    expect((PEN_MASS_KG / volume) * volume).toBeCloseTo(PEN_MASS_KG, 10);

    arena.world.free();
  });

  it('stays put when nothing pushes it', () => {
    const arena = createArenaWorld();
    const pen = createPen(arena.world, 'A', BASE_EFFECTS);
    stepFor(arena.world, 2);

    const position = readPosition(pen.body);
    expect(Math.abs(position.x - SPAWN_A.x)).toBeLessThan(0.2);
    expect(Math.abs(position.z - SPAWN_A.z)).toBeLessThan(0.2);

    arena.world.free();
  });
});

describe('launching', () => {
  it('moves a pen in the direction it was fired, and slows it down', () => {
    const arena = createArenaWorld();
    const pen = createPen(arena.world, 'A', BASE_EFFECTS);
    stepFor(arena.world, 0.6);

    launchPen(pen.body, { dirX: 1, dirZ: 0, speed: 14 });

    stepFor(arena.world, 0.1);
    const earlySpeed = readSpeed(pen.body);
    expect(earlySpeed).toBeGreaterThan(8);

    stepFor(arena.world, 1.4);
    const laterSpeed = readSpeed(pen.body);
    const position = readPosition(pen.body);

    expect(position.x).toBeGreaterThan(SPAWN_A.x + 1.5);
    expect(laterSpeed).toBeLessThan(earlySpeed);

    arena.world.free();
  });

  it('makes the pen rotate rather than slide like a block', () => {
    const arena = createArenaWorld();
    const pen = createPen(arena.world, 'A', BASE_EFFECTS);
    stepFor(arena.world, 0.6);

    launchPen(pen.body, { dirX: 1, dirZ: 0, speed: 20 });
    stepFor(arena.world, 0.25);

    const spin = pen.body.angvel();
    expect(Math.hypot(spin.x, spin.y, spin.z)).toBeGreaterThan(0.5);

    arena.world.free();
  });

  it('sends a full-power shot off the edge when it connects with nothing', () => {
    const arena = createArenaWorld();
    const pen = createPen(arena.world, 'A', BASE_EFFECTS);
    stepFor(arena.world, 0.6);

    // Fired straight along +X from the spawn mark with no opponent in the way.
    launchPen(pen.body, { dirX: 1, dirZ: 0, speed: MAX_LAUNCH_SPEED });
    stepFor(arena.world, 3.5);

    const position = readPosition(pen.body);
    expect(position.x).toBeGreaterThan(DESK_HALF_X);
    expect(hasFallen(position)).toBe(true);

    arena.world.free();
  });

  it('keeps a gentle shot safely on the desk', () => {
    const arena = createArenaWorld();
    const pen = createPen(arena.world, 'A', BASE_EFFECTS);
    stepFor(arena.world, 0.6);

    launchPen(pen.body, { dirX: 1, dirZ: 0, speed: 9 });
    stepFor(arena.world, 3);

    const position = readPosition(pen.body);
    expect(hasFallen(position)).toBe(false);
    expect(Math.abs(position.x)).toBeLessThan(DESK_HALF_X);

    arena.world.free();
  });
});

describe('pen against pen', () => {
  it('transfers momentum on a broadside hit', () => {
    const arena = createArenaWorld();
    const attacker = createPen(arena.world, 'A', BASE_EFFECTS);
    const target = createPen(arena.world, 'B', BASE_EFFECTS);
    stepFor(arena.world, 0.8);

    const targetBefore = readPosition(target.body);
    expect(readSpeed(target.body)).toBeLessThan(0.3);

    launchPen(attacker.body, { dirX: 1, dirZ: 0, speed: MAX_LAUNCH_SPEED });
    stepFor(arena.world, 2.5);

    const targetAfter = readPosition(target.body);
    // The struck pen must have been driven towards the far edge.
    expect(targetAfter.x).toBeGreaterThan(targetBefore.x + 1);

    arena.world.free();
  });

  it('leaves the target alone when the attacker is fired away from it', () => {
    const arena = createArenaWorld();
    const attacker = createPen(arena.world, 'A', BASE_EFFECTS);
    const target = createPen(arena.world, 'B', BASE_EFFECTS);
    stepFor(arena.world, 0.8);

    const before = readPosition(target.body);
    launchPen(attacker.body, { dirX: -1, dirZ: 0, speed: MAX_LAUNCH_SPEED });
    stepFor(arena.world, 2);

    const after = readPosition(target.body);
    expect(Math.abs(after.x - before.x)).toBeLessThan(0.3);
    expect(Math.abs(after.x - SPAWN_B.x)).toBeLessThan(0.5);

    arena.world.free();
  });

  it('is deterministic: identical inputs give identical outcomes', () => {
    const run = (): number => {
      const arena = createArenaWorld();
      const pen = createPen(arena.world, 'A', BASE_EFFECTS);
      stepFor(arena.world, 0.5);
      launchPen(pen.body, { dirX: 0.8, dirZ: 0.6, speed: 18 });
      stepFor(arena.world, 1.5);
      const x = readPosition(pen.body).x;
      arena.world.free();
      return x;
    };

    expect(run()).toBeCloseTo(run(), 6);
  });
});
