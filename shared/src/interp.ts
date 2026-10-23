import { INTERP_DELAY_MS, SNAPSHOT_BUFFER_MS } from './constants.js';
import { clamp01, lerpVec3, slerpQuat } from './math.js';
import type { Quat, Vec3 } from './math.js';
import type { PenState, PlayerSlot, Snapshot, ValidArea } from './types.js';

export interface InterpolatedPen {
  slot: PlayerSlot;
  position: Vec3;
  rotation: Quat;
  speed: number;
  charging: boolean;
  chargePower: number;
  eliminated: boolean;
  graceLeftMs: number | null;
}

export interface InterpolatedState {
  pens: InterpolatedPen[];
  area: ValidArea;
  timeLeftMs: number;
  /** True when the buffer had nothing newer to blend towards. */
  extrapolated: boolean;
}

/**
 * Holds recent server snapshots and reconstructs a smooth view of the match.
 *
 * The client is authoritative over nothing. It renders INTERP_DELAY_MS in the
 * past so there is almost always a snapshot on each side of the render clock to
 * blend between, which turns 20 Hz server updates into steady 60 fps motion
 * without ever guessing at physics.
 */
export class SnapshotBuffer {
  private snapshots: Snapshot[] = [];
  /** Estimated offset to add to client time to get server time. */
  private clockOffsetMs = 0;

  constructor(private readonly delayMs: number = INTERP_DELAY_MS) {}

  /** Records the server/client clock difference measured by a ping round-trip. */
  setClockOffset(offsetMs: number): void {
    this.clockOffsetMs = offsetMs;
  }

  get offset(): number {
    return this.clockOffsetMs;
  }

  get size(): number {
    return this.snapshots.length;
  }

  get latest(): Snapshot | null {
    return this.snapshots.length > 0 ? (this.snapshots[this.snapshots.length - 1] ?? null) : null;
  }

  clear(): void {
    this.snapshots = [];
  }

  /** Inserts a snapshot, keeping the buffer ordered and bounded. */
  push(snapshot: Snapshot): void {
    const last = this.snapshots[this.snapshots.length - 1];
    if (last && snapshot.seq <= last.seq) {
      // Out-of-order or duplicate delivery: drop it rather than corrupt the order.
      return;
    }
    this.snapshots.push(snapshot);

    const cutoff = snapshot.t - SNAPSHOT_BUFFER_MS;
    while (this.snapshots.length > 2 && (this.snapshots[0]?.t ?? 0) < cutoff) {
      this.snapshots.shift();
    }
  }

  /**
   * Samples the buffer at the given client time.
   * Returns null until at least one snapshot has arrived.
   */
  sample(clientNow: number): InterpolatedState | null {
    if (this.snapshots.length === 0) return null;

    const renderTime = clientNow + this.clockOffsetMs - this.delayMs;

    const newest = this.snapshots[this.snapshots.length - 1];
    const oldest = this.snapshots[0];
    if (!newest || !oldest) return null;

    if (this.snapshots.length === 1 || renderTime >= newest.t) {
      return toState(newest, newest, 1, true);
    }
    if (renderTime <= oldest.t) {
      return toState(oldest, oldest, 0, false);
    }

    for (let i = this.snapshots.length - 1; i > 0; i -= 1) {
      const to = this.snapshots[i];
      const from = this.snapshots[i - 1];
      if (!to || !from) continue;
      if (renderTime >= from.t && renderTime <= to.t) {
        const span = to.t - from.t;
        const alpha = span <= 0 ? 1 : clamp01((renderTime - from.t) / span);
        return toState(from, to, alpha, false);
      }
    }

    return toState(newest, newest, 1, true);
  }
}

function findPen(snapshot: Snapshot, slot: PlayerSlot): PenState | undefined {
  return snapshot.pens.find((pen) => pen.slot === slot);
}

function toState(from: Snapshot, to: Snapshot, alpha: number, extrapolated: boolean): InterpolatedState {
  const pens: InterpolatedPen[] = to.pens.map((target) => {
    const previous = findPen(from, target.slot) ?? target;
    return {
      slot: target.slot,
      position: lerpVec3(previous.position, target.position, alpha),
      rotation: slerpQuat(previous.rotation, target.rotation, alpha),
      speed: previous.speed + (target.speed - previous.speed) * alpha,
      charging: target.charging,
      chargePower: target.chargePower,
      eliminated: target.eliminated,
      graceLeftMs: target.graceLeftMs,
    };
  });

  return {
    pens,
    area: {
      halfX: from.area.halfX + (to.area.halfX - from.area.halfX) * alpha,
      halfZ: from.area.halfZ + (to.area.halfZ - from.area.halfZ) * alpha,
    },
    timeLeftMs: Math.round(from.timeLeftMs + (to.timeLeftMs - from.timeLeftMs) * alpha),
    extrapolated,
  };
}
