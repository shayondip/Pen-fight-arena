import {
  COUNTDOWN_SECONDS,
  DRAW_WINDOW_MS,
  normalize2,
  MATCH_DURATION_MS,
  MAX_CHARGE_MS,
  MAX_LAUNCH_SPEED,
  MIN_LAUNCH_SPEED,
  SNAPSHOT_EVERY_N_TICKS,
  clamp01,
  decideResult,
  degToRad,
  effectsFor,
  evaluatePen,
  hashSeed,
  mulberry32,
  rotate2,
  timeLeftMs,
  validAreaAt,
  validateFire,
} from '@pfa/shared';
import type {
  AiController,
  AiWorldView,
  EliminationReason,
  GameMode,
  MatchEvent,
  MatchOutcome,
  PenAttributes,
  PenEffects,
  PenState,
  PlayerSlot,
  Snapshot,
  ValidationResult,
} from '@pfa/shared';
import type { FireAccepted } from '@pfa/shared';

import {
  createArenaWorld,
  createPen,
  launchPen,
  readAxis,
  readPosition,
  readRotation,
  readSpeed,
  readVelocity,
  resetPen,
} from './world.js';
import type { ArenaWorld, PenHandles } from './world.js';

export interface MatchPlayerConfig {
  slot: PlayerSlot;
  profileId: string;
  nickname: string;
  /** Attributes already resolved for the mode (normalised in ranked). */
  attributes: PenAttributes;
}

export interface MatchFinish {
  outcome: MatchOutcome;
  reason: EliminationReason | 'time';
  durationMs: number;
  hits: Record<PlayerSlot, number>;
}

export interface MatchCallbacks {
  onSnapshot(snapshot: Snapshot): void;
  onEvent(event: MatchEvent): void;
  onCountdown(secondsLeft: number): void;
  onStart(startedAt: number): void;
  onFinish(result: MatchFinish): void;
}

export interface MatchOptions extends MatchCallbacks {
  code: string;
  mode: GameMode;
  arenaId: string;
  playerA: MatchPlayerConfig;
  playerB: MatchPlayerConfig;
  /** Overrides the RNG seed; tests use it to make aim scatter reproducible. */
  seed?: number;
  /**
   * Optional computer opponent, bound to one slot.
   *
   * The controller never touches the simulation: it returns the same charge
   * and fire intents a human's mouse produces, and they are fed through the
   * identical validated entry points below. That is what guarantees the AI
   * plays by the same rules and cannot move the other pen.
   */
  ai?: { slot: PlayerSlot; controller: AiController };
}

interface PenRuntime {
  slot: PlayerSlot;
  config: MatchPlayerConfig;
  effects: PenEffects;
  handles: PenHandles;
  chargeStartedAt: number | null;
  nextFireAt: number;
  outsideSince: number | null;
  eliminatedAt: number | null;
  eliminationReason: EliminationReason | null;
  graceLeftMs: number | null;
  hits: number;
  inDanger: boolean;
}

export type MatchPhaseInternal = 'waiting' | 'countdown' | 'playing' | 'paused' | 'finished';

/**
 * One authoritative match.
 *
 * Every pen position in the game comes out of this class. Clients send aim and
 * charge intents; the simulation here decides what actually happened, and the
 * snapshots it emits are the only source of truth the clients ever render.
 */
export class Match {
  readonly code: string;
  readonly mode: GameMode;
  readonly arenaId: string;

  private readonly arena: ArenaWorld;
  private readonly pens: Record<PlayerSlot, PenRuntime>;
  private readonly callbacks: MatchCallbacks;
  private readonly random: () => number;
  private readonly ai: { slot: PlayerSlot; controller: AiController } | null;

  private phase: MatchPhaseInternal = 'waiting';
  private tickCount = 0;
  private snapshotSeq = 0;

  private countdownEndsAt = 0;
  private lastCountdownValue = -1;
  private startedAt = 0;
  private pausedAt: number | null = null;
  private pausedTotalMs = 0;
  private finishedAt: number | null = null;

  /** Set when the first pen is eliminated; the result is sealed once it passes. */
  private resultDueAt: number | null = null;
  private forcedOutcome: { outcome: MatchOutcome; reason: EliminationReason } | null = null;

  constructor(options: MatchOptions) {
    this.code = options.code;
    this.mode = options.mode;
    this.arenaId = options.arenaId;
    this.callbacks = options;
    this.random = mulberry32(options.seed ?? hashSeed(options.code));
    this.ai = options.ai ?? null;

    this.arena = createArenaWorld();

    this.pens = {
      A: this.spawn(options.playerA),
      B: this.spawn(options.playerB),
    };
  }

  private spawn(config: MatchPlayerConfig): PenRuntime {
    const effects = effectsFor(config.attributes);
    return {
      slot: config.slot,
      config,
      effects,
      handles: createPen(this.arena.world, config.slot, effects),
      chargeStartedAt: null,
      nextFireAt: 0,
      outsideSince: null,
      eliminatedAt: null,
      eliminationReason: null,
      graceLeftMs: null,
      hits: 0,
      inDanger: false,
    };
  }

  getPhase(): MatchPhaseInternal {
    return this.phase;
  }

  isLive(): boolean {
    return this.phase === 'countdown' || this.phase === 'playing' || this.phase === 'paused';
  }

  /** Milliseconds of actual play, excluding any paused time. */
  elapsedMs(now: number): number {
    if (this.startedAt === 0) return 0;
    const end = this.finishedAt ?? (this.pausedAt ?? now);
    return Math.max(0, end - this.startedAt - this.pausedTotalMs);
  }

  /** Starts (or restarts) the match with a fresh countdown. */
  start(now: number): void {
    this.resetState(now);
    this.phase = 'countdown';
    this.countdownEndsAt = now + COUNTDOWN_SECONDS * 1000;
    this.lastCountdownValue = -1;
  }

  private resetState(now: number): void {
    for (const slot of ['A', 'B'] as PlayerSlot[]) {
      const pen = this.pens[slot];
      resetPen(pen.handles.body, slot);
      pen.chargeStartedAt = null;
      pen.nextFireAt = 0;
      pen.outsideSince = null;
      pen.eliminatedAt = null;
      pen.eliminationReason = null;
      pen.graceLeftMs = null;
      pen.hits = 0;
      pen.inDanger = false;
    }
    this.tickCount = 0;
    this.startedAt = now;
    this.pausedAt = null;
    this.pausedTotalMs = 0;
    this.finishedAt = null;
    this.resultDueAt = null;
    this.forcedOutcome = null;
    this.ai?.controller.reset();
  }

  pause(now: number): void {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    if (this.pausedAt !== null) return;
    this.pausedAt = now;
    this.phase = 'paused';
    this.emitSnapshot(now);
  }

  resume(now: number): void {
    if (this.phase !== 'paused' || this.pausedAt === null) return;
    this.pausedTotalMs += now - this.pausedAt;
    this.pausedAt = null;
    this.phase = 'playing';
  }

  /** Ends the match immediately - used for disconnect forfeits. */
  forfeit(slot: PlayerSlot, now: number, reason: EliminationReason = 'forfeit'): void {
    if (this.phase === 'finished') return;
    if (this.pausedAt !== null) {
      this.pausedTotalMs += now - this.pausedAt;
      this.pausedAt = null;
    }
    this.forcedOutcome = { outcome: slot === 'A' ? 'B' : 'A', reason };
    this.finish(now);
  }

  setCharging(slot: PlayerSlot, down: boolean, now: number): void {
    const pen = this.pens[slot];
    if (!pen || pen.eliminatedAt !== null) return;
    if (this.phase !== 'playing') return;

    if (down) {
      if (pen.chargeStartedAt === null) {
        pen.chargeStartedAt = now;
        this.callbacks.onEvent({ type: 'charge_start', slot, intensity: 0, t: now });
      }
    } else {
      pen.chargeStartedAt = null;
    }
  }

  /** Server-side charge level, derived from how long the button has actually been held. */
  private serverChargePower(pen: PenRuntime, now: number): number {
    if (pen.chargeStartedAt === null) return 0;
    return clamp01((now - pen.chargeStartedAt) / MAX_CHARGE_MS);
  }

  /**
   * Handles a fire request. Returns the validation result so the caller can
   * report a rejection reason back to that one client.
   */
  fire(slot: PlayerSlot, payload: unknown, now: number): ValidationResult<FireAccepted> {
    const pen = this.pens[slot];
    if (!pen) {
      return { ok: false, code: 'not_a_player', message: 'Unknown player slot.' };
    }

    const validated = validateFire(payload, {
      now,
      isPlayer: true,
      phase: this.phase === 'playing' ? 'playing' : 'waiting',
      chargeStartedAt: pen.chargeStartedAt,
      nextFireAt: pen.nextFireAt,
      eliminated: pen.eliminatedAt !== null,
    });

    if (!validated.ok) return validated;

    // The client may ask for less power than it charged (an early release), but
    // never for more than the time it actually held the button.
    const power = Math.min(validated.power, this.serverChargePower(pen, now));
    const speed =
      (MIN_LAUNCH_SPEED + (MAX_LAUNCH_SPEED - MIN_LAUNCH_SPEED) * power) *
      pen.effects.launchSpeedMult;

    // Harder shots scatter more; Control buys that scatter back down.
    const spreadDeg = pen.effects.aimSpreadDeg * power;
    const jitter = degToRad((this.random() - 0.5) * spreadDeg);
    const aimed = rotate2(validated.dirX, validated.dirZ, jitter);

    launchPen(pen.handles.body, { dirX: aimed.x, dirZ: aimed.z, speed });

    pen.chargeStartedAt = null;
    pen.nextFireAt = now + pen.effects.cooldownMs;

    this.callbacks.onEvent({ type: 'fire', slot, intensity: power, t: now });

    return { ...validated, power };
  }

  /** Advances the simulation. Called by the game loop at a fixed rate. */
  step(now: number): void {
    if (this.phase === 'countdown') {
      this.stepCountdown(now);
      return;
    }

    if (this.phase === 'paused') {
      if (this.tickCount % SNAPSHOT_EVERY_N_TICKS === 0) this.emitSnapshot(now);
      this.tickCount += 1;
      return;
    }

    if (this.phase !== 'playing') return;

    this.arena.world.step(this.arena.eventQueue);
    this.drainCollisions(now);
    this.evaluatePens(now);
    this.driveAi(now);
    this.tickCount += 1;

    if (this.tickCount % SNAPSHOT_EVERY_N_TICKS === 0) {
      this.emitSnapshot(now);
    }

    this.checkResult(now);
  }

  private stepCountdown(now: number): void {
    const msLeft = this.countdownEndsAt - now;
    const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000));

    if (secondsLeft !== this.lastCountdownValue) {
      this.lastCountdownValue = secondsLeft;
      this.callbacks.onCountdown(secondsLeft);
    }

    if (this.tickCount % SNAPSHOT_EVERY_N_TICKS === 0) this.emitSnapshot(now);
    this.tickCount += 1;

    if (msLeft <= 0) {
      this.phase = 'playing';
      this.startedAt = now;
      this.pausedTotalMs = 0;
      this.tickCount = 0;
      this.callbacks.onStart(now);
    }
  }

  private slotForCollider(handle: number): PlayerSlot | null {
    if (handle === this.pens.A.handles.collider.handle) return 'A';
    if (handle === this.pens.B.handles.collider.handle) return 'B';
    return null;
  }

  private drainCollisions(now: number): void {
    this.arena.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      if (!started) return;

      const slot1 = this.slotForCollider(handle1);
      const slot2 = this.slotForCollider(handle2);

      if (slot1 && slot2) {
        const speed1 = readSpeed(this.pens[slot1].handles.body);
        const speed2 = readSpeed(this.pens[slot2].handles.body);
        const intensity = clamp01(Math.max(speed1, speed2) / MAX_LAUNCH_SPEED);

        // Credit the hit to whichever pen was actually moving into the other.
        const attacker = speed1 >= speed2 ? slot1 : slot2;
        if (intensity > 0.08) {
          this.pens[attacker].hits += 1;
          this.callbacks.onEvent({ type: 'pen_hit', slot: attacker, intensity, t: now });
        }
        return;
      }

      const penSlot = slot1 ?? slot2;
      if (!penSlot) return;

      const speed = readSpeed(this.pens[penSlot].handles.body);
      const intensity = clamp01(speed / MAX_LAUNCH_SPEED);
      if (intensity > 0.2) {
        this.callbacks.onEvent({ type: 'desk_hit', slot: penSlot, intensity, t: now });
      }
    });
  }

  private evaluatePens(now: number): void {
    const area = validAreaAt(this.elapsedMs(now));

    for (const slot of ['A', 'B'] as PlayerSlot[]) {
      const pen = this.pens[slot];
      if (pen.eliminatedAt !== null) continue;

      const position = readPosition(pen.handles.body);
      const evaluation = evaluatePen({
        position,
        area,
        outsideSince: pen.outsideSince,
        now,
      });

      pen.outsideSince = evaluation.outsideSince;
      pen.graceLeftMs = evaluation.graceLeftMs;

      const nowInDanger = evaluation.graceLeftMs !== null;
      if (nowInDanger !== pen.inDanger) {
        pen.inDanger = nowInDanger;
        this.callbacks.onEvent({
          type: nowInDanger ? 'danger_enter' : 'danger_exit',
          slot,
          intensity: 1,
          t: now,
        });
      }

      if (evaluation.eliminated) {
        pen.eliminatedAt = now;
        pen.eliminationReason = evaluation.reason;
        pen.graceLeftMs = 0;
        this.callbacks.onEvent({ type: 'fell', slot, intensity: 1, t: now });

        // Hold the result open briefly so a genuine mutual knock-out can draw.
        if (this.resultDueAt === null) {
          this.resultDueAt = now + DRAW_WINDOW_MS;
        }
      }
    }
  }

  private checkResult(now: number): void {
    const elapsed = this.elapsedMs(now);
    const timeUp = elapsed >= MATCH_DURATION_MS;

    if (this.resultDueAt !== null && now < this.resultDueAt && !timeUp) {
      // Still inside the simultaneous-elimination window.
      return;
    }

    const decision = decideResult({
      eliminatedAtA: this.pens.A.eliminatedAt,
      eliminatedAtB: this.pens.B.eliminatedAt,
      timeUp,
    });

    if (!decision) return;
    this.finish(now, decision.outcome, decision.reason === 'time' ? 'time' : undefined);
  }

  private finish(now: number, outcome?: MatchOutcome, forcedReason?: 'time'): void {
    if (this.phase === 'finished') return;

    const resolvedOutcome = this.forcedOutcome?.outcome ?? outcome ?? 'draw';
    let reason: EliminationReason | 'time' = forcedReason ?? 'time';

    if (this.forcedOutcome) {
      reason = this.forcedOutcome.reason;
    } else if (!forcedReason) {
      const loser: PlayerSlot | null =
        resolvedOutcome === 'A' ? 'B' : resolvedOutcome === 'B' ? 'A' : null;
      if (loser) {
        reason = this.pens[loser].eliminationReason ?? 'fell';
      } else {
        reason = this.pens.A.eliminationReason ?? this.pens.B.eliminationReason ?? 'time';
      }
    }

    this.finishedAt = now;
    const durationMs = this.elapsedMs(now);
    this.phase = 'finished';

    this.emitSnapshot(now);
    this.callbacks.onFinish({
      outcome: resolvedOutcome,
      reason,
      durationMs,
      hits: { A: this.pens.A.hits, B: this.pens.B.hits },
    });
  }

  /**
   * Gives the computer opponent its turn on this tick.
   *
   * It rides the match's own loop, so there are no AI timers or animation
   * frames to start, stop or leak - disposing the match disposes the AI.
   */
  private driveAi(now: number): void {
    const ai = this.ai;
    if (!ai) return;

    const pen = this.pens[ai.slot];
    if (pen.eliminatedAt !== null) return;

    for (const action of ai.controller.update(this.buildAiView(ai.slot, now))) {
      if (action.type === 'charge') {
        this.setCharging(ai.slot, action.down, now);
      } else {
        // Exactly the path a human shot takes, validation included. A shot the
        // AI gets wrong - too early, on cooldown - is rejected just the same.
        this.fire(ai.slot, { dirX: action.dirX, dirZ: action.dirZ, power: action.power }, now);
      }
    }
  }

  /** Read-only picture of the board for the AI. */
  private buildAiView(slot: PlayerSlot, now: number): AiWorldView {
    const other: PlayerSlot = slot === 'A' ? 'B' : 'A';
    const self = this.pens[slot];
    const opponent = this.pens[other];

    const describe = (pen: PenRuntime) => {
      const position = readPosition(pen.handles.body);
      const velocity = readVelocity(pen.handles.body);
      const axis = readAxis(pen.handles.body);
      const flat = normalize2(axis.x, axis.z) ?? { x: 0, z: 1 };
      return {
        x: position.x,
        z: position.z,
        vx: velocity.x,
        vz: velocity.z,
        speed: Math.hypot(velocity.x, velocity.y, velocity.z),
        axisX: flat.x,
        axisZ: flat.z,
        eliminated: pen.eliminatedAt !== null,
      };
    };

    return {
      now,
      self: {
        ...describe(self),
        nextFireAt: self.nextFireAt,
        charging: self.chargeStartedAt !== null,
        graceLeftMs: self.graceLeftMs,
      },
      opponent: describe(opponent),
      area: validAreaAt(this.elapsedMs(now)),
    };
  }

  buildSnapshot(now: number): Snapshot {
    const elapsed = this.elapsedMs(now);
    const area = validAreaAt(elapsed);

    const pens: PenState[] = (['A', 'B'] as PlayerSlot[]).map((slot) => {
      const pen = this.pens[slot];
      return {
        slot,
        position: readPosition(pen.handles.body),
        rotation: readRotation(pen.handles.body),
        speed: readSpeed(pen.handles.body),
        charging: pen.chargeStartedAt !== null,
        chargePower: this.serverChargePower(pen, now),
        nextFireAt: pen.nextFireAt,
        eliminated: pen.eliminatedAt !== null,
        eliminationReason: pen.eliminationReason,
        graceLeftMs: pen.graceLeftMs,
      };
    });

    this.snapshotSeq += 1;

    return {
      seq: this.snapshotSeq,
      t: now,
      phase: this.phase,
      timeLeftMs: this.phase === 'playing' ? timeLeftMs(elapsed) : MATCH_DURATION_MS,
      area,
      pens,
    };
  }

  private emitSnapshot(now: number): void {
    this.callbacks.onSnapshot(this.buildSnapshot(now));
  }

  /** Frees the Rapier world. Always call this when a room closes. */
  dispose(): void {
    this.arena.eventQueue.free();
    this.arena.world.free();
  }
}
