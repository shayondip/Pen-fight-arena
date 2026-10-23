import {
  BASE_COOLDOWN_MS,
  MIN_COOLDOWN_MS,
} from './constants.js';
import { clamp } from './math.js';
import type { AttributeKey, PenAttributes } from './types.js';

export const MAX_ATTRIBUTE_LEVEL = 5;

export const ATTRIBUTE_KEYS: AttributeKey[] = ['impact', 'stability', 'control', 'recovery'];

export interface AttributeMeta {
  key: AttributeKey;
  label: string;
  description: string;
  /** Coin cost to go from level i to level i + 1. */
  costs: number[];
}

export const ATTRIBUTE_META: Record<AttributeKey, AttributeMeta> = {
  impact: {
    key: 'impact',
    label: 'Impact Power',
    description: 'Raises the launch speed of every shot, so hits carry further.',
    costs: [60, 110, 180, 280, 420],
  },
  stability: {
    key: 'stability',
    label: 'Stability',
    description: 'Adds mass and grip, making your pen harder to shove off the desk.',
    costs: [60, 110, 180, 280, 420],
  },
  control: {
    key: 'control',
    label: 'Control',
    description: 'Tightens aim scatter, so hard shots go where you pointed them.',
    costs: [70, 120, 190, 300, 440],
  },
  recovery: {
    key: 'recovery',
    label: 'Recovery',
    description: 'Shortens the cooldown between shots.',
    costs: [70, 120, 190, 300, 440],
  },
};

export const DEFAULT_ATTRIBUTES: PenAttributes = {
  impact: 0,
  stability: 0,
  control: 0,
  recovery: 0,
};

/** Cost of the next level, or null when the attribute is already maxed. */
export function upgradeCost(key: AttributeKey, currentLevel: number): number | null {
  if (currentLevel >= MAX_ATTRIBUTE_LEVEL) return null;
  const cost = ATTRIBUTE_META[key].costs[currentLevel];
  return cost ?? null;
}

export function sanitizeAttributes(input: Partial<PenAttributes> | null | undefined): PenAttributes {
  const out: PenAttributes = { ...DEFAULT_ATTRIBUTES };
  if (!input) return out;
  for (const key of ATTRIBUTE_KEYS) {
    const raw = input[key];
    const level = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0;
    out[key] = clamp(level, 0, MAX_ATTRIBUTE_LEVEL);
  }
  return out;
}

export interface PenEffects {
  /** Multiplier applied to launch speed. */
  launchSpeedMult: number;
  /** Multiplier applied to the pen's mass. */
  massMult: number;
  /** Extra angular damping, which calms wild spinning. */
  angularDampingBonus: number;
  /** Extra surface friction, which shortens slides. */
  frictionBonus: number;
  /** Maximum random aim scatter, in degrees, at full power. */
  aimSpreadDeg: number;
  /** Cooldown between shots, in milliseconds. */
  cooldownMs: number;
}

/**
 * Turns attribute levels into the concrete numbers the simulation uses.
 * Every curve is linear in the level so the Workshop UI can state the exact
 * effect of the next point without re-deriving anything.
 */
export function effectsFor(levels: PenAttributes): PenEffects {
  const safe = sanitizeAttributes(levels);
  const recoveryRatio = safe.recovery / MAX_ATTRIBUTE_LEVEL;
  return {
    launchSpeedMult: 1 + 0.04 * safe.impact,
    massMult: 1 + 0.03 * safe.stability,
    angularDampingBonus: 0.06 * safe.stability,
    frictionBonus: 0.02 * safe.stability,
    aimSpreadDeg: Math.max(0.6, 3.0 - 0.48 * safe.control),
    cooldownMs: Math.round(
      BASE_COOLDOWN_MS - (BASE_COOLDOWN_MS - MIN_COOLDOWN_MS) * recoveryRatio,
    ),
  };
}

/** Total coins required to take a fresh pen to the given levels. */
export function totalInvested(levels: PenAttributes): number {
  const safe = sanitizeAttributes(levels);
  let total = 0;
  for (const key of ATTRIBUTE_KEYS) {
    const target = safe[key];
    for (let level = 0; level < target; level += 1) {
      total += ATTRIBUTE_META[key].costs[level] ?? 0;
    }
  }
  return total;
}
