import { beforeAll, describe, expect, it } from 'vitest';

import {
  AiController,
  MAX_CHARGE_MS,
  MIN_CHARGE_MS,
  TICK_MS,
  effectsFor,
} from '@pfa/shared';
import type { MatchEvent, Snapshot } from '@pfa/shared';

import { Match } from '../src/game/match.js';
import type { MatchFinish, MatchOptions } from '../src/game/match.js';
import { initPhysics } from '../src/game/world.js';

beforeAll(async () => {
  await initPhysics();
}, 30_000);

interface Harness {
  match: Match;
  snapshots: Snapshot[];
  events: MatchEvent[];
  finishes: MatchFinish[];
  countdowns: number[];
  clock: number;
  advance(ms: number): void;
}

function makeMatch(overrides: Partial<MatchOptions> = {}): Harness {
  const snapshots: Snapshot[] = [];
  const events: MatchEvent[] = [];
  const finishes: MatchFinish[] = [];
  const countdowns: number[] = [];

  const match = new Match({
    code: 'TEST1',
    mode: 'casual',
    arenaId: 'classroom-morning',
    seed: 12345,
    playerA: {
      slot: 'A',
      profileId: 'profile-a',
      nickname: 'A',
      attributes: { impact: 0, stability: 0, control: 5, recovery: 0 },
    },
    playerB: {
      slot: 'B',
      profileId: 'profile-b',
      nickname: 'B',
      attributes: { impact: 0, stability: 0, control: 5, recovery: 0 },
    },
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onEvent: (event) => events.push(event),
    onCountdown: (secondsLeft) => countdowns.push(secondsLeft),
    onStart: () => undefined,
    onFinish: (finish) => finishes.push(finish),
    ...overrides,
  });

  const harness: Harness = {
    match,
    snapshots,
    events,
    finishes,
    countdowns,
    clock: 1_000_000,
    advance(ms: number) {
      const ticks = Math.max(1, Math.round(ms / TICK_MS));
      for (let i = 0; i < ticks; i += 1) {
        harness.clock += TICK_MS;
        match.step(harness.clock);
      }
    },
  };

  return harness;
}

/** Walks a fresh match through its countdown and into live play. */
function startAndPlay(harness: Harness): void {
  harness.match.start(harness.clock);
  harness.advance(3200);
}

describe('match lifecycle', () => {
  it('counts down and then starts', () => {
    const harness = makeMatch();
    harness.match.start(harness.clock);
    expect(harness.match.getPhase()).toBe('countdown');

    harness.advance(3200);
    expect(harness.match.getPhase()).toBe('playing');
    expect(harness.countdowns).toContain(3);
    expect(harness.countdowns).toContain(0);
  });

  it('emits snapshots with both pens once live', () => {
    const harness = makeMatch();
    startAndPlay(harness);
    harness.advance(500);

    const latest = harness.snapshots.at(-1);
    expect(latest).toBeDefined();
    expect(latest?.pens.map((pen) => pen.slot).sort()).toEqual(['A', 'B']);
    expect(latest?.seq).toBeGreaterThan(1);
  });

  it('numbers snapshots monotonically', () => {
    const harness = makeMatch();
    startAndPlay(harness);
    harness.advance(800);

    for (let i = 1; i < harness.snapshots.length; i += 1) {
      expect(harness.snapshots[i]!.seq).toBeGreaterThan(harness.snapshots[i - 1]!.seq);
    }
  });

  it('pauses and resumes without advancing the match clock', () => {
    const harness = makeMatch();
    startAndPlay(harness);
    harness.advance(1000);

    const beforePause = harness.match.elapsedMs(harness.clock);
    harness.match.pause(harness.clock);
    expect(harness.match.getPhase()).toBe('paused');

    harness.advance(2000);
    expect(harness.match.elapsedMs(harness.clock)).toBeCloseTo(beforePause, -2);

    harness.match.resume(harness.clock);
    expect(harness.match.getPhase()).toBe('playing');
  });
});

describe('firing rules', () => {
  it('refuses a shot before the countdown finishes', () => {
    const harness = makeMatch();
    harness.match.start(harness.clock);
    harness.advance(200);

    harness.match.setCharging('A', true, harness.clock);
    const result = harness.match.fire('A', { power: 1, dirX: 1, dirZ: 0 }, harness.clock);
    expect(result).toMatchObject({ ok: false, code: 'wrong_phase' });
  });

  it('refuses a shot that was never charged', () => {
    const harness = makeMatch();
    startAndPlay(harness);

    const result = harness.match.fire('A', { power: 1, dirX: 1, dirZ: 0 }, harness.clock);
    expect(result).toMatchObject({ ok: false, code: 'no_charge' });
  });

  it('caps power at what was actually charged, whatever the client claims', () => {
    const harness = makeMatch();
    startAndPlay(harness);

    harness.match.setCharging('A', true, harness.clock);
    harness.advance(MIN_CHARGE_MS + 40);

    // The client asks for a maximum-power shot after a very short hold.
    const result = harness.match.fire('A', { power: 1, dirX: 1, dirZ: 0 }, harness.clock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const chargedFraction = (MIN_CHARGE_MS + 40) / MAX_CHARGE_MS;
    expect(result.power).toBeLessThanOrEqual(chargedFraction + 0.05);
    expect(result.power).toBeLessThan(1);
  });

  it('enforces the cooldown between shots', () => {
    const harness = makeMatch();
    startAndPlay(harness);

    harness.match.setCharging('A', true, harness.clock);
    harness.advance(400);
    expect(harness.match.fire('A', { power: 0.5, dirX: 1, dirZ: 0 }, harness.clock).ok).toBe(true);

    harness.match.setCharging('A', true, harness.clock);
    harness.advance(400);
    const second = harness.match.fire('A', { power: 0.5, dirX: 1, dirZ: 0 }, harness.clock);
    expect(second).toMatchObject({ ok: false, code: 'cooldown' });

    // After the full cooldown the next shot is allowed.
    harness.advance(effectsFor({ impact: 0, stability: 0, control: 0, recovery: 0 }).cooldownMs);
    harness.match.setCharging('A', true, harness.clock);
    harness.advance(400);
    expect(harness.match.fire('A', { power: 0.5, dirX: 1, dirZ: 0 }, harness.clock).ok).toBe(true);
  });

  it('reports charge progress in snapshots so the opponent can see it building', () => {
    const harness = makeMatch();
    startAndPlay(harness);

    harness.match.setCharging('A', true, harness.clock);
    harness.advance(700);

    const pen = harness.snapshots.at(-1)?.pens.find((candidate) => candidate.slot === 'A');
    expect(pen?.charging).toBe(true);
    expect(pen?.chargePower).toBeGreaterThan(0.3);
    expect(pen?.chargePower).toBeLessThanOrEqual(1);
  });
});

describe('elimination', () => {
  /**
   * Fires A along +Z at full power. The desk is only 4 units deep that way, so
   * the shot runs off the edge on its own - no reliance on a pen-to-pen hit,
   * which keeps the assertion about the rules rather than about collision luck.
   */
  it('ends the match when a pen is driven off the desk', () => {
    const harness = makeMatch();
    startAndPlay(harness);

    harness.match.setCharging('A', true, harness.clock);
    harness.advance(MAX_CHARGE_MS + 100);
    const fired = harness.match.fire('A', { power: 1, dirX: 0, dirZ: 1 }, harness.clock);
    expect(fired.ok).toBe(true);

    harness.advance(6000);

    expect(harness.finishes.length).toBe(1);
    expect(harness.finishes[0]?.outcome).toBe('B');
    expect(harness.finishes[0]?.reason).toBe('fell');
    expect(harness.match.getPhase()).toBe('finished');
    expect(harness.events.some((event) => event.type === 'fell')).toBe(true);
  });

  it('stops simulating once the match is over', () => {
    const harness = makeMatch();
    startAndPlay(harness);

    harness.match.setCharging('A', true, harness.clock);
    harness.advance(MAX_CHARGE_MS + 100);
    harness.match.fire('A', { power: 1, dirX: 0, dirZ: 1 }, harness.clock);
    harness.advance(6000);

    const countAfterFinish = harness.snapshots.length;
    harness.advance(2000);
    expect(harness.snapshots.length).toBe(countAfterFinish);
    expect(harness.finishes.length).toBe(1);
  });

  it('awards a forfeit to the player who stayed', () => {
    const harness = makeMatch();
    startAndPlay(harness);

    harness.match.forfeit('A', harness.clock, 'disconnect');

    expect(harness.finishes.length).toBe(1);
    expect(harness.finishes[0]?.outcome).toBe('B');
    expect(harness.finishes[0]?.reason).toBe('disconnect');
  });

  it('only finishes once, however many times forfeit is called', () => {
    const harness = makeMatch();
    startAndPlay(harness);

    harness.match.forfeit('A', harness.clock, 'forfeit');
    harness.match.forfeit('B', harness.clock, 'forfeit');
    expect(harness.finishes.length).toBe(1);
  });
});


describe('playing against the computer', () => {
  it('runs a whole match with only one human, and ends it', () => {
    const ai = new AiController('B', 'hard', 42);
    const harness = makeMatch({ ai: { slot: 'B', controller: ai } });
    startAndPlay(harness);

    // Long enough that the shrinking area guarantees a result even if the
    // pens somehow never connect.
    harness.advance(130_000);

    expect(harness.finishes).toHaveLength(1);
    expect(ai.debug.shots).toBeGreaterThan(0);
  });

  it('only ever fires the pen the controller was given', () => {
    const ai = new AiController('B', 'hard', 7);
    const harness = makeMatch({ ai: { slot: 'B', controller: ai } });
    startAndPlay(harness);
    harness.advance(25_000);

    const fired = harness.events.filter((event) => event.type === 'fire');
    expect(fired.length).toBeGreaterThan(0);
    // The human never pressed anything, so every shot must be the AI's.
    expect(fired.every((event) => event.slot === 'B')).toBe(true);
  });

  it('leaves the human pen alone until it is actually hit', () => {
    const ai = new AiController('B', 'medium', 13);
    const harness = makeMatch({ ai: { slot: 'B', controller: ai } });
    startAndPlay(harness);

    // One tick in, before the AI has had time to charge and land anything.
    harness.advance(100);
    const penA = harness.snapshots.at(-1)?.pens.find((pen) => pen.slot === 'A');
    expect(penA?.charging).toBe(false);
    expect(penA?.speed ?? 0).toBeLessThan(0.5);
  });

  it('goes through the same validation a human shot does', () => {
    const ai = new AiController('B', 'hard', 3);
    const harness = makeMatch({ ai: { slot: 'B', controller: ai } });
    startAndPlay(harness);
    harness.advance(30_000);

    const fired = harness.events.filter((event) => event.type === 'fire');
    expect(fired.length).toBeGreaterThan(0);

    // Every accepted shot carries a legal normalised power.
    for (const event of fired) {
      expect(event.intensity).toBeGreaterThanOrEqual(0);
      expect(event.intensity).toBeLessThanOrEqual(1);
    }

    // And no two shots landed closer together than the cooldown allows.
    const cooldown = effectsFor({ impact: 0, stability: 0, control: 0, recovery: 0 }).cooldownMs;
    for (let i = 1; i < fired.length; i += 1) {
      expect(fired[i]!.t - fired[i - 1]!.t).toBeGreaterThanOrEqual(cooldown - TICK_MS);
    }
  });

  it('clears the AI down for a rematch', () => {
    const ai = new AiController('B', 'medium', 5);
    const harness = makeMatch({ ai: { slot: 'B', controller: ai } });
    startAndPlay(harness);
    harness.advance(20_000);
    expect(ai.debug.shots).toBeGreaterThan(0);

    // Starting again must hand back a controller with no memory of round one.
    harness.match.start(harness.clock);
    expect(ai.debug.shots).toBe(0);
  });

  it('fires nothing at all when no AI is attached, exactly as before', () => {
    const harness = makeMatch();
    startAndPlay(harness);
    harness.advance(20_000);

    expect(harness.events.filter((event) => event.type === 'fire')).toHaveLength(0);
    expect(harness.finishes).toHaveLength(0);
  });
});
