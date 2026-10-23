import type { PenSkin } from './types.js';

/**
 * Cosmetic pen finishes. Purely procedural materials - colours, metalness and
 * roughness - so no texture files are needed and nothing can fail to load.
 * The two starter skins are free; the rest cost Pen Coins.
 */
export const PEN_SKINS: PenSkin[] = [
  {
    id: 'classic-blue',
    name: 'Classic Blue',
    cost: 0,
    barrel: '#2f62c9',
    grip: '#1b3f8f',
    cap: '#24509f',
    accent: '#cfe0ff',
    metalness: 0.15,
    roughness: 0.42,
    stripes: false,
  },
  {
    id: 'crimson-red',
    name: 'Crimson Red',
    cost: 0,
    barrel: '#c6342f',
    grip: '#8d1f1c',
    cap: '#a82723',
    accent: '#ffd9d4',
    metalness: 0.15,
    roughness: 0.42,
    stripes: false,
  },
  {
    id: 'graphite',
    name: 'Graphite',
    cost: 120,
    barrel: '#3b3f45',
    grip: '#24272b',
    cap: '#2e3238',
    accent: '#9aa3ad',
    metalness: 0.55,
    roughness: 0.3,
    stripes: false,
  },
  {
    id: 'mint-gel',
    name: 'Mint Gel',
    cost: 160,
    barrel: '#4fc3a1',
    grip: '#2f8e74',
    cap: '#3aa988',
    accent: '#e5fff6',
    metalness: 0.1,
    roughness: 0.25,
    stripes: true,
  },
  {
    id: 'copper-works',
    name: 'Copper Works',
    cost: 240,
    barrel: '#b9733f',
    grip: '#7d4725',
    cap: '#a05f32',
    accent: '#ffd9a8',
    metalness: 0.85,
    roughness: 0.22,
    stripes: false,
  },
  {
    id: 'midnight-ink',
    name: 'Midnight Ink',
    cost: 300,
    barrel: '#1d2440',
    grip: '#11162a',
    cap: '#171d36',
    accent: '#6f8fff',
    metalness: 0.45,
    roughness: 0.18,
    stripes: true,
  },
  {
    id: 'candy-stripe',
    name: 'Candy Stripe',
    cost: 360,
    barrel: '#f2f2f2',
    grip: '#d9385f',
    cap: '#e84a6f',
    accent: '#ff9bb4',
    metalness: 0.08,
    roughness: 0.35,
    stripes: true,
  },
  {
    id: 'lab-white',
    name: 'Lab White',
    cost: 420,
    barrel: '#eef1f4',
    grip: '#c3ccd4',
    cap: '#dbe2e8',
    accent: '#5fd0ff',
    metalness: 0.3,
    roughness: 0.15,
    stripes: false,
  },
];

export const DEFAULT_SKIN_ID = 'classic-blue';
export const FREE_SKIN_IDS: string[] = PEN_SKINS.filter((skin) => skin.cost === 0).map((s) => s.id);

export function getSkin(id: string | null | undefined): PenSkin {
  return PEN_SKINS.find((skin) => skin.id === id) ?? PEN_SKINS[0]!;
}

export function skinCost(id: string): number | null {
  const skin = PEN_SKINS.find((candidate) => candidate.id === id);
  return skin ? skin.cost : null;
}
