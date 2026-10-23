import { describe, expect, it } from 'vitest';

import {
  AI_DIFFICULTIES,
  AI_PROFILES,
  AiController,
  DESK_HALF_X,
  DESK_HALF_Z,
  MAX_CHARGE_MS,
  MIN_CHARGE_MS,
  SLIDE_DECELERATION,
  estimateTravel,
  getAiProfile,
  isAiDifficulty,
  maxSafePower,
  speedForPower,
} from '@pfa/shared';
import type { AiAction, AiDifficulty, AiWorldView } from '@pfa/shared';

const AREA = { halfX: DESK_HALF_X, halfZ: DESK_HALF_Z };

function pen(overrides: Partial<AiWorldView['opponent']> = {}): AiWorldView['opponent'] {
  return {
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    speed: 0,
    // Pens spawn lying along Z, which is the full broadside.
    axisX: 0,
    axisZ: 1,
    eliminated: false,
    ...overrides,
  };
}

function view(overrides: Partial<AiWorldView> = {}): AiWorldView {
  return {
    now: 10_000,
    self: {
      ...pen({ x: 3.2 }),
      nextFireAt: 0,
      charging: false,
      graceLeftMs: null,
    },
    opponent: pen({ x: -3.2 }),
    area: AREA,
    ...overrides,
  };
}

/**
 * Drives a controller over simulated time against a static board and collects
 * everything it decided to do. The board does not move, which isolates the
 * decision-making from the physics.
 */
function run(
  controller: AiController,
  options: {
    ticks?: number;
    stepMs?: number;
    start?: number;
    mutate?: (view: AiWorldView, tick: number) => AiWorldView;
  } = {},
): { actions: AiAction[]; fires: Extract<AiAction, { type: 'fire' }>[]; firstActionAt: number | null } {
  const ticks = options.ticks ?? 400;
  const stepMs = options.stepMs ?? 16;
  const start = options.start ?? 10_000;

  const actions: AiAction[] = [];
  let firstActionAt: number | null = null;

  for (let tick = 0; tick < ticks; tick += 1) {
    const now = start + tick * stepMs;
    let current = view({ now });
    if (options.mutate) current = options.mutate(current, tick);
    current.now = now;

    const produced = controller.update(current);
    if (produced.length > 0 && firstActionAt === null) firstActionAt = now - start;
    actions.push(...produced);
  }

  return {
    actions,
    fires: actions.filter((action): action is Extract<AiAction, { type: 'fire' }> =>
      action.type === 'fire',
    ),
    firstActionAt,
  };
}

describe('difficulty profiles', () => {
  it('exposes exactly three difficulties', () => {
    expect(AI_DIFFICULTIES).toEqual(['easy', 'medium', 'hard']);
  });

  it('resolves names and rejects anything else', () => {
    expect(getAiProfile('hard').difficulty).toBe('hard');
    expect(getAiProfile('nightmare').difficulty).toBe('medium');
    expect(getAiProfile(null).difficulty).toBe('medium');
    expect(isAiDifficulty('easy')).toBe(true);
    expect(isAiDifficulty('insane')).toBe(false);
  });

  it('orders every behavioural dial monotonically from easy to hard', () => {
    const { easy, medium, hard } = AI_PROFILES;

    // Reactions get faster.
    expect(easy.reactionMs).toBeGreaterThan(medium.reactionMs);
    expect(medium.reactionMs).toBeGreaterThan(hard.reactionMs);

    // Thinking gets more frequent.
    expect(easy.decisionIntervalMs).toBeGreaterThan(medium.decisionIntervalMs);
    expect(medium.decisionIntervalMs).toBeGreaterThan(hard.decisionIntervalMs);

    // Aim gets tighter.
    expect(easy.aimErrorDeg).toBeGreaterThan(medium.aimErrorDeg);
    expect(medium.aimErrorDeg).toBeGreaterThan(hard.aimErrorDeg);

    // Shots get stronger.
    expect(easy.maxPower).toBeLessThan(medium.maxPower);
    expect(medium.maxPower).toBeLessThan(hard.maxPower);

    // And recklessness drops: Easy throws itself off, Hard does not.
    expect(easy.riskTolerance).toBeGreaterThan(medium.riskTolerance);
    expect(medium.riskTolerance).toBeGreaterThan(hard.riskTolerance);
  });

  it('only gives the smarter tiers the smarter tactics', () => {
    expect(AI_PROFILES.easy.leadsTarget).toBe(false);
    expect(AI_PROFILES.hard.leadsTarget).toBe(true);
    expect(AI_PROFILES.easy.aimsForEdge).toBe(false);
    expect(AI_PROFILES.hard.aimsForEdge).toBe(true);
    expect(AI_PROFILES.easy.conservesShots).toBe(false);
    expect(AI_PROFILES.hard.conservesShots).toBe(true);
  });
});

describe('shot maths', () => {
  it('derives travel from the same v^2/2a the launch speeds were designed against', () => {
    const power = 0.5;
    const speed = speedForPower(power);
    expect(estimateTravel(power)).toBeCloseTo((speed * speed) / (2 * SLIDE_DECELERATION), 6);
  });

  it('travels further with more power', () => {
    expect(estimateTravel(1)).toBeGreaterThan(estimateTravel(0.5));
    expect(estimateTravel(0.5)).toBeGreaterThan(estimateTravel(0));
  });

  it('confirms a full-power shot outruns the desk, which is the game design', () => {
    // Spawn mark to far edge is 9.2 units; a maximum shot must overrun it.
    expect(estimateTravel(1)).toBeGreaterThan(9.2);
  });

  it('inverts travel back into a safe charge', () => {
    const distance = 6;
    const safe = maxSafePower(distance);
    expect(estimateTravel(safe)).toBeLessThanOrEqual(distance + 1e-6);
  });

  it('returns no power at all when there is no room to slide', () => {
    expect(maxSafePower(0)).toBe(0);
    expect(maxSafePower(-5)).toBe(0);
  });
});

describe('basic behaviour', () => {
  it('charges before it fires, never the other way round', () => {
    const ai = new AiController('B', 'medium', 7);
    const { actions } = run(ai, { ticks: 300 });

    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0]).toMatchObject({ type: 'charge', down: true });

    let charged = false;
    for (const action of actions) {
      if (action.type === 'charge' && action.down) charged = true;
      if (action.type === 'fire') {
        expect(charged).toBe(true);
        charged = false;
      }
    }
  });

  it('holds the charge long enough for the server to accept the shot', () => {
    const ai = new AiController('B', 'hard', 11);
    let chargedAt: number | null = null;
    const holds: number[] = [];

    for (let tick = 0; tick < 600; tick += 1) {
      const now = 10_000 + tick * 16;
      for (const action of ai.update(view({ now }))) {
        if (action.type === 'charge' && action.down) chargedAt = now;
        if (action.type === 'fire' && chargedAt !== null) {
          holds.push(now - chargedAt);
          chargedAt = null;
        }
      }
    }

    expect(holds.length).toBeGreaterThan(0);
    for (const hold of holds) {
      expect(hold).toBeGreaterThanOrEqual(MIN_CHARGE_MS);
      expect(hold).toBeLessThanOrEqual(MAX_CHARGE_MS + 200);
    }
  });

  it('fires roughly towards the opponent', () => {
    const ai = new AiController('B', 'hard', 3);
    const { fires } = run(ai, { ticks: 400 });

    expect(fires.length).toBeGreaterThan(0);
    // Self sits at +3.2, opponent at -3.2, so shots should carry -X.
    for (const shot of fires) {
      expect(shot.dirX).toBeLessThan(0);
    }
  });

  it('always sends a unit aim vector and a legal power', () => {
    const ai = new AiController('B', 'easy', 5);
    const { fires } = run(ai, { ticks: 800 });

    expect(fires.length).toBeGreaterThan(0);
    for (const shot of fires) {
      expect(Math.hypot(shot.dirX, shot.dirZ)).toBeCloseTo(1, 4);
      expect(shot.power).toBeGreaterThanOrEqual(0);
      expect(shot.power).toBeLessThanOrEqual(1);
    }
  });

  it('respects its cooldown', () => {
    const ai = new AiController('B', 'hard', 9);
    const cooldownUntil = 10_000 + 5_000;

    const { actions } = run(ai, {
      ticks: 200,
      mutate: (current) => {
        current.self.nextFireAt = cooldownUntil;
        return current;
      },
    });

    expect(actions.filter((action) => action.type === 'fire')).toHaveLength(0);
  });

  it('goes quiet once its own pen is out', () => {
    const ai = new AiController('B', 'hard', 2);
    const { fires } = run(ai, {
      ticks: 300,
      mutate: (current) => {
        current.self.eliminated = true;
        return current;
      },
    });
    expect(fires).toHaveLength(0);
  });

  it('only ever acts for the slot it was built for', () => {
    const ai = new AiController('B', 'hard', 4);
    expect(ai.slot).toBe('B');
    // The action shape carries no slot at all, so there is no way for a
    // controller to address the other pen.
    const { actions } = run(ai, { ticks: 120 });
    for (const action of actions) {
      expect(Object.keys(action)).not.toContain('slot');
    }
  });

  it('forgets everything on reset, so a rematch starts fresh', () => {
    const ai = new AiController('B', 'medium', 8);
    run(ai, { ticks: 400 });
    expect(ai.debug.shots).toBeGreaterThan(0);

    ai.reset();
    expect(ai.debug.shots).toBe(0);
    expect(ai.debug.plan).toBe('hold');
  });
});

describe('reacting to the board', () => {
  it('fires back towards the middle when it is over the line', () => {
    const ai = new AiController('B', 'hard', 6);
    const { fires } = run(ai, {
      ticks: 200,
      mutate: (current) => {
        current.self.x = DESK_HALF_X + 0.4;
        current.self.z = 0;
        current.self.graceLeftMs = 1200;
        return current;
      },
    });

    expect(fires.length).toBeGreaterThan(0);
    // Pushed off the +X edge, it must shove itself back towards -X.
    for (const shot of fires) {
      expect(shot.dirX).toBeLessThan(0);
    }
  });

  it('reacts to being out of bounds far more reliably on Hard than on Easy', () => {
    const outOfBounds = (current: AiWorldView): AiWorldView => {
      current.self.x = DESK_HALF_X + 0.4;
      current.self.graceLeftMs = 1200;
      return current;
    };

    const easyShots = new Array(12).fill(0).map((_unused, seed) => {
      const ai = new AiController('B', 'easy', seed + 1);
      return run(ai, { ticks: 120, mutate: outOfBounds }).fires.length;
    });
    const hardShots = new Array(12).fill(0).map((_unused, seed) => {
      const ai = new AiController('B', 'hard', seed + 1);
      return run(ai, { ticks: 120, mutate: outOfBounds }).fires.length;
    });

    const easyTotal = easyShots.reduce((sum, value) => sum + value, 0);
    const hardTotal = hardShots.reduce((sum, value) => sum + value, 0);
    expect(hardTotal).toBeGreaterThan(easyTotal);
  });

  it('holds fire when the opponent is already sliding out, if it is smart enough', () => {
    // Opponent at the edge, moving fast enough to overshoot it by a long way.
    const doomed = (current: AiWorldView): AiWorldView => {
      current.opponent.x = -DESK_HALF_X + 0.5;
      current.opponent.vx = -24;
      current.opponent.speed = 24;
      return current;
    };

    const hard = new AiController('B', 'hard', 5);
    const smart = run(hard, { ticks: 300, mutate: doomed });

    const easy = new AiController('B', 'easy', 5);
    const careless = run(easy, { ticks: 300, mutate: doomed });

    expect(smart.fires).toHaveLength(0);
    expect(careless.fires.length).toBeGreaterThan(0);
  });

  it('takes the shot when the opponent is merely near the edge but stable', () => {
    const ai = new AiController('B', 'hard', 5);
    const { fires } = run(ai, {
      ticks: 300,
      mutate: (current) => {
        current.opponent.x = -DESK_HALF_X + 0.5;
        current.opponent.vx = 0;
        current.opponent.speed = 0;
        return current;
      },
    });
    expect(fires.length).toBeGreaterThan(0);
  });
});

describe('difficulty produces different play, not just a different label', () => {
  function sample(difficulty: AiDifficulty, seeds = 10) {
    let totalShots = 0;
    let totalPower = 0;
    let unsafeShots = 0;
    const latencies: number[] = [];

    for (let seed = 1; seed <= seeds; seed += 1) {
      const ai = new AiController('B', difficulty, seed);
      const result = run(ai, { ticks: 500 });
      totalShots += result.fires.length;
      for (const shot of result.fires) {
        totalPower += shot.power;
        // Self sits 3.2 from centre, so 9.2 units of desk lie ahead of it.
        if (estimateTravel(shot.power) > 9.2) unsafeShots += 1;
      }
      if (result.firstActionAt !== null) latencies.push(result.firstActionAt);
    }

    return {
      shots: totalShots,
      averagePower: totalShots > 0 ? totalPower / totalShots : 0,
      unsafeRate: totalShots > 0 ? unsafeShots / totalShots : 0,
      averageLatency:
        latencies.length > 0
          ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
          : Number.POSITIVE_INFINITY,
    };
  }

  it('makes harder opponents act more often', () => {
    const easy = sample('easy');
    const medium = sample('medium');
    const hard = sample('hard');

    expect(hard.shots).toBeGreaterThan(medium.shots);
    expect(medium.shots).toBeGreaterThan(easy.shots);
  });

  it('makes harder opponents aim straighter', () => {
    // Self at +3.2, opponent at -3.2, so the true bearing is exactly -X.
    //
    // Only the opening shot of each match counts. Later shots are deliberately
    // scattered by the anti-grooving rule, and since the harder tiers fire far
    // more often they trigger that rule more - averaging over a whole match
    // would measure variety rather than accuracy.
    //
    // The error is a dot product, not a difference of atan2 results, which
    // would wrap at +/-pi and report a near-perfect shot as a terrible one.
    const meanAimError = (difficulty: AiDifficulty): number => {
      const errors: number[] = [];
      for (let seed = 1; seed <= 24; seed += 1) {
        const ai = new AiController('B', difficulty, seed);
        const first = run(ai, { ticks: 500 }).fires[0];
        if (!first) continue;
        const dot = first.dirX * -1 + first.dirZ * 0;
        errors.push(Math.acos(Math.max(-1, Math.min(1, dot))));
      }
      return errors.reduce((sum, value) => sum + value, 0) / Math.max(1, errors.length);
    };

    const easy = meanAimError('easy');
    const medium = meanAimError('medium');
    const hard = meanAimError('hard');

    expect(easy).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(hard);
  });

  it('answers the opponent faster the harder it is', () => {
    // The opponent opens the match with a fast shot. Measure how long each
    // difficulty takes to get its own shot away in reply.
    const replyTime = (difficulty: AiDifficulty): number => {
      const times: number[] = [];
      for (let seed = 1; seed <= 10; seed += 1) {
        const ai = new AiController('B', difficulty, seed);
        for (let tick = 0; tick < 600; tick += 1) {
          const now = 10_000 + tick * 16;
          const current = view({ now });
          current.opponent.speed = 20;
          current.opponent.vx = 20;
          const fired = ai.update(current).some((action) => action.type === 'fire');
          if (fired) {
            times.push(tick * 16);
            break;
          }
        }
      }
      return times.reduce((sum, value) => sum + value, 0) / Math.max(1, times.length);
    };

    const easy = replyTime('easy');
    const medium = replyTime('medium');
    const hard = replyTime('hard');

    expect(easy).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(hard);
  });

  it('makes Easy throw itself off the desk and Hard refuse to', () => {
    const easy = sample('easy');
    const hard = sample('hard');

    // Easy swings with power that overruns the desk; Hard caps itself.
    expect(easy.unsafeRate).toBeGreaterThan(hard.unsafeRate);
    expect(hard.unsafeRate).toBeLessThan(0.1);
  });

  it('varies its aim instead of grooving one repeated shot', () => {
    const ai = new AiController('B', 'medium', 21);
    const { fires } = run(ai, { ticks: 900 });

    expect(fires.length).toBeGreaterThan(4);
    const angles = fires.map((shot) => Math.atan2(shot.dirZ, shot.dirX));
    const unique = new Set(angles.map((angle) => angle.toFixed(3)));
    expect(unique.size).toBeGreaterThan(1);

    const spread = Math.max(...angles) - Math.min(...angles);
    expect(spread).toBeGreaterThan(0.01);
  });

  it('is deterministic for a given seed, so a match can be replayed', () => {
    const first = run(new AiController('B', 'hard', 99), { ticks: 400 }).fires;
    const second = run(new AiController('B', 'hard', 99), { ticks: 400 }).fires;

    expect(first.length).toBe(second.length);
    for (let i = 0; i < first.length; i += 1) {
      expect(first[i]?.power).toBeCloseTo(second[i]?.power ?? -1, 9);
      expect(first[i]?.dirX).toBeCloseTo(second[i]?.dirX ?? -1, 9);
    }
  });

  it('plays differently from one seed to the next', () => {
    const a = run(new AiController('B', 'medium', 1), { ticks: 400 }).fires;
    const b = run(new AiController('B', 'medium', 2), { ticks: 400 }).fires;

    const sameOpening =
      a[0] !== undefined && b[0] !== undefined && Math.abs(a[0].power - b[0].power) < 1e-9;
    expect(sameOpening).toBe(false);
  });
});
