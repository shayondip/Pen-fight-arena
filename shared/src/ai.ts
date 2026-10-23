import {
  DESK_FRICTION,
  GRAVITY_Y,
  MAX_CHARGE_MS,
  MAX_LAUNCH_SPEED,
  MIN_CHARGE_MS,
  MIN_LAUNCH_SPEED,
  PEN_FRICTION,
  PEN_RADIUS,
} from './constants.js';
import { clamp, clamp01, degToRad, mulberry32, normalize2, rotate2 } from './math.js';
import type { AiDifficulty, PlayerSlot } from './types.js';

/**
 * The computer opponent.
 *
 * Everything here is pure: it takes a read-only view of the match and returns
 * the same charge/fire intents a human's mouse produces. It never touches the
 * simulation directly, which is what guarantees two things - the AI plays by
 * exactly the rules a player does (its shots go through the same server-side
 * validation), and it has no way to move the human's pen.
 */

export const AI_DIFFICULTIES: AiDifficulty[] = ['easy', 'medium', 'hard'];

export interface AiProfile {
  difficulty: AiDifficulty;
  label: string;
  blurb: string;
  /** Delay before the AI responds to a change in the situation. */
  reactionMs: number;
  /** How often it re-evaluates what to do. */
  decisionIntervalMs: number;
  /** Aim error at full power, in degrees. */
  aimErrorDeg: number;
  /** Highest charge it will ever use. */
  maxPower: number;
  /** How far its charge release drifts from the power it intended, 0..1. */
  chargeSlop: number;
  /** 0..1 bias towards attacking rather than playing safe. */
  aggression: number;
  /**
   * Willingness to exceed the charge that would carry its own pen off the
   * desk. 0 keeps a margin under it, 1 ignores the edge entirely. This is the
   * single biggest difference between Easy and Hard in play: Easy regularly
   * flicks itself into the grass, Hard almost never does.
   */
  riskTolerance: number;
  /** 0..1 chance it notices it is out of bounds in time to fire back in. */
  recoveryUrgency: number;
  /** Whether it aims where a moving target is going rather than where it is. */
  leadsTarget: boolean;
  /** Whether it aims through the opponent towards their nearest edge. */
  aimsForEdge: boolean;
  /** Whether it holds fire against a pen that is already sliding out. */
  conservesShots: boolean;
}

export const AI_PROFILES: Record<AiDifficulty, AiProfile> = {
  easy: {
    difficulty: 'easy',
    label: 'Easy',
    blurb: 'Slow to react, loose aim, and swings hard enough to knock itself off.',
    reactionMs: 620,
    decisionIntervalMs: 900,
    aimErrorDeg: 9,
    maxPower: 0.85,
    chargeSlop: 0.18,
    aggression: 0.45,
    riskTolerance: 0.7,
    recoveryUrgency: 0.35,
    leadsTarget: false,
    aimsForEdge: false,
    conservesShots: false,
  },
  medium: {
    difficulty: 'medium',
    label: 'Medium',
    blurb: 'Reads the board, aims straight, and knows when to back off.',
    reactionMs: 320,
    decisionIntervalMs: 520,
    aimErrorDeg: 4,
    maxPower: 0.92,
    chargeSlop: 0.05,
    aggression: 0.65,
    riskTolerance: 0.25,
    recoveryUrgency: 0.75,
    leadsTarget: false,
    aimsForEdge: true,
    conservesShots: true,
  },
  hard: {
    difficulty: 'hard',
    label: 'Hard',
    blurb: 'Fast, accurate, picks its angle, and rarely throws itself off.',
    reactionMs: 140,
    decisionIntervalMs: 300,
    aimErrorDeg: 1.2,
    maxPower: 1,
    chargeSlop: 0.03,
    aggression: 0.8,
    riskTolerance: 0.18,
    recoveryUrgency: 1,
    leadsTarget: true,
    aimsForEdge: true,
    conservesShots: true,
  },
};

export function getAiProfile(difficulty: AiDifficulty | string | null | undefined): AiProfile {
  if (difficulty === 'easy' || difficulty === 'medium' || difficulty === 'hard') {
    return AI_PROFILES[difficulty];
  }
  return AI_PROFILES.medium;
}

export function isAiDifficulty(value: unknown): value is AiDifficulty {
  return value === 'easy' || value === 'medium' || value === 'hard';
}

// ---------------------------------------------------------------------------
// Shot maths
// ---------------------------------------------------------------------------

/**
 * Fraction of the maximum safe charge a fully careful opponent will use. The
 * margin absorbs charge slop and the fact that a real collision adds travel
 * the estimate does not model.
 */
export const SAFETY_MARGIN = 0.9;

/** Below this charge a shot is too weak to be worth the cooldown. */
export const MIN_USEFUL_POWER = 0.28;

/** Combined deceleration from desk and pen friction, in units per second squared. */
export const SLIDE_DECELERATION = ((DESK_FRICTION + PEN_FRICTION) / 2) * Math.abs(GRAVITY_Y);

/** Launch speed for a charge level, ignoring upgrades. */
export function speedForPower(power: number): number {
  return MIN_LAUNCH_SPEED + (MAX_LAUNCH_SPEED - MIN_LAUNCH_SPEED) * clamp01(power);
}

/**
 * Roughly how far a pen coasts at a given charge, from v^2 / 2a.
 *
 * This is the same calculation the launch speeds were designed against, and it
 * is what lets the stronger difficulties work out whether a shot would carry
 * them off the far edge before they take it.
 */
export function estimateTravel(power: number): number {
  const speed = speedForPower(power);
  return (speed * speed) / (2 * SLIDE_DECELERATION);
}

/** The largest charge whose coast stays within `distance`. Never below zero. */
export function maxSafePower(distance: number): number {
  if (distance <= 0) return 0;
  const speedSq = 2 * SLIDE_DECELERATION * distance;
  const speed = Math.sqrt(speedSq);
  if (speed <= MIN_LAUNCH_SPEED) return 0;
  return clamp01((speed - MIN_LAUNCH_SPEED) / (MAX_LAUNCH_SPEED - MIN_LAUNCH_SPEED));
}

// ---------------------------------------------------------------------------
// World view and actions
// ---------------------------------------------------------------------------

export interface AiPenView {
  x: number;
  z: number;
  /** Velocity in the XZ plane, units per second. */
  vx: number;
  vz: number;
  speed: number;
  /** Unit vector of the pen's long axis projected onto XZ. */
  axisX: number;
  axisZ: number;
  eliminated: boolean;
}

export interface AiWorldView {
  /** Server clock in milliseconds. */
  now: number;
  self: AiPenView & {
    /** Earliest time this pen may fire again. */
    nextFireAt: number;
    charging: boolean;
    /** Milliseconds before an out-of-bounds pen is eliminated, or null if safe. */
    graceLeftMs: number | null;
  };
  opponent: AiPenView;
  area: { halfX: number; halfZ: number };
}

export type AiPlan = 'attack' | 'recover' | 'reposition' | 'hold';

export type AiAction =
  | { type: 'charge'; down: boolean }
  | { type: 'fire'; dirX: number; dirZ: number; power: number };

export interface AiDebugState {
  plan: AiPlan;
  targetPower: number;
  dirX: number;
  dirZ: number;
  /** Shots taken so far this match. */
  shots: number;
}

interface PendingShot {
  dirX: number;
  dirZ: number;
  power: number;
  plan: AiPlan;
  /** Charge must be held at least this long before release. */
  releaseAt: number;
}

/**
 * Drives one pen.
 *
 * The controller is bound to a single slot at construction and only ever emits
 * actions for that slot, so there is no code path by which it could act on the
 * human's pen.
 */
export class AiController {
  readonly slot: PlayerSlot;
  readonly profile: AiProfile;

  private readonly random: () => number;
  private nextDecisionAt = 0;
  private reactUntil = 0;
  private pending: PendingShot | null = null;
  private plan: AiPlan = 'hold';
  private shots = 0;
  /** Recent aim angles, used to stop the AI grooving the same shot. */
  private recentAngles: number[] = [];
  private lastOpponentSpeed = 0;

  constructor(slot: PlayerSlot, difficulty: AiDifficulty, seed = 1) {
    this.slot = slot;
    this.profile = getAiProfile(difficulty);
    this.random = mulberry32(seed >>> 0 || 1);
  }

  get debug(): AiDebugState {
    return {
      plan: this.plan,
      targetPower: this.pending?.power ?? 0,
      dirX: this.pending?.dirX ?? 0,
      dirZ: this.pending?.dirZ ?? 0,
      shots: this.shots,
    };
  }

  /** Clears per-match state so one controller can be reused for a rematch. */
  reset(): void {
    this.nextDecisionAt = 0;
    this.reactUntil = 0;
    this.pending = null;
    this.plan = 'hold';
    this.shots = 0;
    this.recentAngles = [];
    this.lastOpponentSpeed = 0;
  }

  /**
   * Advances the AI one tick and returns what it wants to do.
   *
   * Returns an empty array most ticks - the AI deliberately thinks at human
   * speed rather than every frame, and the interval is what makes Easy feel
   * slow and Hard feel sharp.
   */
  update(view: AiWorldView): AiAction[] {
    const { now, self, opponent } = view;

    if (self.eliminated) {
      const actions: AiAction[] = this.pending ? [{ type: 'charge', down: false }] : [];
      this.pending = null;
      this.plan = 'hold';
      return actions;
    }

    // A sudden change in the opponent's speed means they just fired. The AI
    // takes its reaction time to notice, which is the core difficulty dial.
    const opponentAccelerated = opponent.speed - this.lastOpponentSpeed > 4;
    this.lastOpponentSpeed = opponent.speed;
    if (opponentAccelerated) {
      this.reactUntil = Math.max(this.reactUntil, now + this.profile.reactionMs);
    }

    // Release a charge that has finished building.
    if (this.pending) {
      if (now >= this.pending.releaseAt) {
        const shot = this.pending;
        this.pending = null;
        this.shots += 1;
        this.nextDecisionAt = now + this.profile.decisionIntervalMs;
        return [{ type: 'fire', dirX: shot.dirX, dirZ: shot.dirZ, power: shot.power }];
      }
      return [];
    }

    if (now < this.nextDecisionAt) return [];
    if (now < this.reactUntil) return [];
    if (now < self.nextFireAt) {
      // Still recovering; check back as soon as the cooldown lifts.
      this.nextDecisionAt = self.nextFireAt;
      return [];
    }

    const decision = this.decide(view);
    this.nextDecisionAt = now + this.profile.decisionIntervalMs;

    if (!decision) {
      this.plan = 'hold';
      return [];
    }

    this.plan = decision.plan;
    this.pending = {
      ...decision,
      releaseAt: now + this.holdTimeFor(decision.power),
    };

    return [{ type: 'charge', down: true }];
  }

  /** How long to hold the button so the server reads back the intended power. */
  private holdTimeFor(power: number): number {
    return Math.max(MIN_CHARGE_MS + 25, Math.round(clamp01(power) * MAX_CHARGE_MS) + 20);
  }

  private decide(view: AiWorldView): Omit<PendingShot, 'releaseAt'> | null {
    const { self, opponent, area } = view;

    // 1. Out of bounds: fire back towards the middle before the grace expires.
    if (self.graceLeftMs !== null) {
      if (this.random() > this.profile.recoveryUrgency) return null;
      const home = normalize2(-self.x, -self.z) ?? { x: 1, z: 0 };
      const distanceHome = Math.hypot(self.x, self.z);
      const power = clamp01(
        Math.max(0.35, Math.min(this.profile.maxPower, maxSafePower(distanceHome * 1.6))),
      );
      return {
        dirX: home.x,
        dirZ: home.z,
        power: this.jitterPower(power),
        plan: 'recover',
      };
    }

    // 2. The opponent is already sliding out. A better player lets them go.
    if (this.profile.conservesShots && this.opponentIsDoomed(view)) {
      return null;
    }

    const toOpponent = normalize2(opponent.x - self.x, opponent.z - self.z);
    if (!toOpponent) return null;

    const distance = Math.hypot(opponent.x - self.x, opponent.z - self.z);
    const edgeAhead = this.distanceToEdgeAlong(self, toOpponent, area);

    // 3. Sitting too close to the line with nothing to gain: step back in.
    const nearEdge =
      Math.abs(self.x) > area.halfX * 0.78 || Math.abs(self.z) > area.halfZ * 0.78;
    if (nearEdge && this.random() > this.profile.aggression) {
      const home = normalize2(-self.x, -self.z) ?? toOpponent;
      const safe = maxSafePower(Math.hypot(self.x, self.z) * 0.8);
      return {
        dirX: home.x,
        dirZ: home.z,
        power: this.jitterPower(clamp01(Math.min(safe, 0.45))),
        plan: 'reposition',
      };
    }

    // 4. Attack.
    let aim = toOpponent;

    if (this.profile.aimsForEdge) {
      // Aim through the opponent towards whichever edge is closest to them, so
      // a hit pushes them out rather than merely across the desk.
      const blended = this.throughToEdge(opponent, area, toOpponent);
      aim = blended;
    }

    if (this.profile.leadsTarget && opponent.speed > 1.5) {
      const flightSeconds = clamp(distance / Math.max(6, speedForPower(0.8)), 0, 0.45);
      const leadX = opponent.x + opponent.vx * flightSeconds - self.x;
      const leadZ = opponent.z + opponent.vz * flightSeconds - self.z;
      aim = normalize2(leadX, leadZ) ?? aim;
    }

    // A pen presenting its side is a far bigger target than one pointing at you.
    const broadside = this.broadsideFactor(opponent, aim);

    // Power: enough to reach and shove, then capped by the edge behind the
    // target. `safePower` is the most this pen could use and still stop before
    // the line; riskTolerance slides the ceiling between a margin under that
    // and a swing that ignores the edge completely.
    const wantedTravel = distance + 3.5 + 3 * this.profile.aggression;
    const safePower = maxSafePower(Math.max(0, edgeAhead - PEN_RADIUS));
    const cautious = safePower * SAFETY_MARGIN;
    const ceiling = clamp01(cautious + (1 - cautious) * this.profile.riskTolerance);

    let power = clamp01(
      Math.min(this.powerForTravel(wantedTravel), this.profile.maxPower, ceiling),
    );

    // Too little room behind the target to hit it and still stop in time.
    // A careful opponent backs off and resets; a reckless one swings anyway.
    if (power < MIN_USEFUL_POWER) {
      if (this.random() > this.profile.riskTolerance) {
        const home = normalize2(-self.x, -self.z) ?? toOpponent;
        return {
          dirX: home.x,
          dirZ: home.z,
          power: this.jitterPower(clamp01(Math.min(maxSafePower(Math.hypot(self.x, self.z)), 0.4))),
          plan: 'reposition',
        };
      }
      power = clamp01(Math.min(this.profile.maxPower, MIN_USEFUL_POWER + 0.2 * this.random()));
    }

    // Hold fire on a poor angle unless feeling aggressive.
    if (broadside < 0.35 && this.random() > this.profile.aggression) {
      return null;
    }

    const angled = this.applyAimError(aim, power);

    return {
      dirX: angled.x,
      dirZ: angled.z,
      power: this.jitterPower(power),
      plan: 'attack',
    };
  }

  /** Charge needed to coast a given distance. */
  private powerForTravel(distance: number): number {
    const speed = Math.sqrt(Math.max(0, 2 * SLIDE_DECELERATION * distance));
    if (speed <= MIN_LAUNCH_SPEED) return 0.2;
    return clamp01((speed - MIN_LAUNCH_SPEED) / (MAX_LAUNCH_SPEED - MIN_LAUNCH_SPEED));
  }

  /** Distance from a pen to the boundary along a direction. */
  private distanceToEdgeAlong(
    pen: { x: number; z: number },
    dir: { x: number; z: number },
    area: { halfX: number; halfZ: number },
  ): number {
    const limits: number[] = [];
    if (Math.abs(dir.x) > 1e-4) {
      const bound = dir.x > 0 ? area.halfX : -area.halfX;
      limits.push((bound - pen.x) / dir.x);
    }
    if (Math.abs(dir.z) > 1e-4) {
      const bound = dir.z > 0 ? area.halfZ : -area.halfZ;
      limits.push((bound - pen.z) / dir.z);
    }
    const positive = limits.filter((value) => value > 0);
    if (positive.length === 0) return 0;
    return Math.max(0, Math.min(...positive));
  }

  /** Aim that pushes the opponent towards their own nearest edge. */
  private throughToEdge(
    opponent: { x: number; z: number },
    area: { halfX: number; halfZ: number },
    fallback: { x: number; z: number },
  ): { x: number; z: number } {
    const gapRight = area.halfX - opponent.x;
    const gapLeft = area.halfX + opponent.x;
    const gapFar = area.halfZ - opponent.z;
    const gapNear = area.halfZ + opponent.z;

    const options: { gap: number; dir: { x: number; z: number } }[] = [
      { gap: gapRight, dir: { x: 1, z: 0 } },
      { gap: gapLeft, dir: { x: -1, z: 0 } },
      { gap: gapFar, dir: { x: 0, z: 1 } },
      { gap: gapNear, dir: { x: 0, z: -1 } },
    ];

    options.sort((a, b) => a.gap - b.gap);
    const closest = options[0];
    if (!closest) return fallback;

    // Blend the push direction into the line of attack rather than replacing
    // it, so the AI still actually hits the pen it is aiming at.
    const blended = normalize2(
      fallback.x * 0.72 + closest.dir.x * 0.28,
      fallback.z * 0.72 + closest.dir.z * 0.28,
    );
    return blended ?? fallback;
  }

  /** 1 when the target shows its full side, 0 when it points straight at us. */
  private broadsideFactor(
    opponent: { axisX: number; axisZ: number },
    aim: { x: number; z: number },
  ): number {
    const dot = Math.abs(opponent.axisX * aim.x + opponent.axisZ * aim.z);
    return clamp01(1 - dot);
  }

  /**
   * Adds aim error, scaled by power, plus a nudge away from recently used
   * angles so the AI does not groove one repeated shot.
   */
  private applyAimError(aim: { x: number; z: number }, power: number): { x: number; z: number } {
    const spread = this.profile.aimErrorDeg * (0.45 + 0.55 * power);
    let offsetDeg = (this.random() - 0.5) * 2 * spread;

    const angle = Math.atan2(aim.z, aim.x);
    const grooved = this.recentAngles.filter(
      (previous) => Math.abs(previous - angle) < degToRad(6),
    ).length;
    if (grooved >= 2) {
      // Deliberately break the pattern.
      offsetDeg += (this.random() > 0.5 ? 1 : -1) * (6 + 10 * this.random());
    }

    this.recentAngles.push(angle);
    if (this.recentAngles.length > 4) this.recentAngles.shift();

    const rotated = rotate2(aim.x, aim.z, degToRad(offsetDeg));
    return normalize2(rotated.x, rotated.z) ?? aim;
  }

  private jitterPower(power: number): number {
    const slop = (this.random() - 0.5) * 2 * this.profile.chargeSlop;
    return clamp01(power + slop);
  }

  /** True when the opponent is already heading out and will not recover. */
  private opponentIsDoomed(view: AiWorldView): boolean {
    const { opponent, area } = view;
    if (opponent.speed < 3) return false;

    const dir = normalize2(opponent.vx, opponent.vz);
    if (!dir) return false;

    const toEdge = this.distanceToEdgeAlong(opponent, dir, area);
    const remaining = (opponent.speed * opponent.speed) / (2 * SLIDE_DECELERATION);
    return remaining > toEdge + 1.2;
  }
}
