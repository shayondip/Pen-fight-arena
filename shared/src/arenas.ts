import type { ArenaPreset } from './types.js';

/**
 * Eight arena backdrops. Every one of them is procedural: sky, fog, grass,
 * trees, desk tint and lighting are numbers, so the game ships with no image
 * downloads, no HDRI files and nothing that can 404.
 */
export const ARENAS: ArenaPreset[] = [
  {
    id: 'classroom-morning',
    name: 'Classroom Morning',
    description: 'Clear blue sky, fresh light, the classic lunch-break desk match.',
    sky: { turbidity: 6, rayleigh: 1.4, mieCoefficient: 0.005, mieDirectionalG: 0.8, sunPosition: [28, 34, 18] },
    fog: { color: '#cfe4f7', near: 60, far: 240 },
    grass: { base: '#5c9a3f', accent: '#79b857' },
    trees: { trunk: '#5a4330', canopy: '#3f7f38', count: 46 },
    desk: { wood: '#b07a46', grain: '#8a5a30', metal: '#9aa3ab' },
    lights: {
      ambient: { color: '#dceaff', intensity: 0.55 },
      hemisphere: { sky: '#bddcff', ground: '#6d8a4e', intensity: 0.75 },
      sun: { color: '#fff3dd', intensity: 2.4, position: [28, 34, 18] },
    },
  },
  {
    id: 'sunset-yard',
    name: 'Sunset Yard',
    description: 'Low orange sun raking across the desk, long shadows.',
    sky: { turbidity: 9, rayleigh: 2.6, mieCoefficient: 0.009, mieDirectionalG: 0.86, sunPosition: [-36, 7, -14] },
    fog: { color: '#f0c49a', near: 50, far: 210 },
    grass: { base: '#5d7f3a', accent: '#86a04a' },
    trees: { trunk: '#4a3626', canopy: '#4d6b32', count: 52 },
    desk: { wood: '#b9793f', grain: '#804f28', metal: '#8c8378' },
    lights: {
      ambient: { color: '#ffd9b0', intensity: 0.45 },
      hemisphere: { sky: '#ffc38a', ground: '#6b5a3a', intensity: 0.6 },
      sun: { color: '#ffb061', intensity: 2.9, position: [-36, 7, -14] },
    },
  },
  {
    id: 'overcast-study',
    name: 'Overcast Study',
    description: 'Flat grey light, soft shadows, nothing to distract you.',
    sky: { turbidity: 14, rayleigh: 0.5, mieCoefficient: 0.02, mieDirectionalG: 0.6, sunPosition: [12, 26, -30] },
    fog: { color: '#c3c9cf', near: 44, far: 180 },
    grass: { base: '#4f7a46', accent: '#628d56' },
    trees: { trunk: '#4d4034', canopy: '#3d6540', count: 38 },
    desk: { wood: '#a1784f', grain: '#7a5636', metal: '#aeb4ba' },
    lights: {
      ambient: { color: '#dfe5ea', intensity: 0.8 },
      hemisphere: { sky: '#d4dde4', ground: '#58634f', intensity: 0.85 },
      sun: { color: '#e8edf2', intensity: 1.2, position: [12, 26, -30] },
    },
  },
  {
    id: 'golden-field',
    name: 'Golden Hour Field',
    description: 'Warm wheat-coloured meadow with a deep amber sun.',
    sky: { turbidity: 7, rayleigh: 2.0, mieCoefficient: 0.007, mieDirectionalG: 0.82, sunPosition: [30, 12, 26] },
    fog: { color: '#f3d6a6', near: 55, far: 230 },
    grass: { base: '#86903c', accent: '#aaa84c' },
    trees: { trunk: '#5b4227', canopy: '#6b7a33', count: 40 },
    desk: { wood: '#c08a50', grain: '#8d5c2e', metal: '#a59a88' },
    lights: {
      ambient: { color: '#ffeccb', intensity: 0.5 },
      hemisphere: { sky: '#ffdfa8', ground: '#7c7340', intensity: 0.7 },
      sun: { color: '#ffce7a', intensity: 2.7, position: [30, 12, 26] },
    },
  },
  {
    id: 'blue-hour',
    name: 'Blue Hour Dusk',
    description: 'Cool twilight just after the sun drops. Desk lamp does the work.',
    sky: { turbidity: 11, rayleigh: 3.4, mieCoefficient: 0.012, mieDirectionalG: 0.9, sunPosition: [-20, 1.2, -34] },
    fog: { color: '#5d6f91', near: 40, far: 170 },
    grass: { base: '#2f4a38', accent: '#3d5c45' },
    trees: { trunk: '#2c2620', canopy: '#2a4433', count: 56 },
    desk: { wood: '#8e6540', grain: '#5f412a', metal: '#7c848c' },
    lights: {
      ambient: { color: '#9fb4d8', intensity: 0.42 },
      hemisphere: { sky: '#6d86b5', ground: '#2d3a2f', intensity: 0.55 },
      sun: { color: '#ffd9a8', intensity: 1.5, position: [-14, 10, -22] },
    },
  },
  {
    id: 'spring-meadow',
    name: 'Spring Meadow',
    description: 'Bright young green, high sun, very little haze.',
    sky: { turbidity: 4, rayleigh: 1.1, mieCoefficient: 0.004, mieDirectionalG: 0.78, sunPosition: [16, 44, 10] },
    fog: { color: '#d9efff', near: 70, far: 260 },
    grass: { base: '#67b24a', accent: '#8ccd63' },
    trees: { trunk: '#64482f', canopy: '#4c9b42', count: 44 },
    desk: { wood: '#bd8650', grain: '#916035', metal: '#a3abb2' },
    lights: {
      ambient: { color: '#e8f5ff', intensity: 0.6 },
      hemisphere: { sky: '#cdeaff', ground: '#74a152', intensity: 0.8 },
      sun: { color: '#fffaf0', intensity: 2.5, position: [16, 44, 10] },
    },
  },
  {
    id: 'autumn-grove',
    name: 'Autumn Grove',
    description: 'Rust and ochre canopy, dry grass, slanted light.',
    sky: { turbidity: 8, rayleigh: 1.8, mieCoefficient: 0.008, mieDirectionalG: 0.84, sunPosition: [-26, 18, 22] },
    fog: { color: '#e4c49c', near: 50, far: 215 },
    grass: { base: '#7d7b3c', accent: '#99883f' },
    trees: { trunk: '#4f3a26', canopy: '#b4612a', count: 50 },
    desk: { wood: '#a9703c', grain: '#744a26', metal: '#9b9288' },
    lights: {
      ambient: { color: '#ffe3bd', intensity: 0.52 },
      hemisphere: { sky: '#ffd6a0', ground: '#6f6334', intensity: 0.68 },
      sun: { color: '#ffc98a', intensity: 2.3, position: [-26, 18, 22] },
    },
  },
  {
    id: 'night-lamp',
    name: 'Night Lamp',
    description: 'After hours. Dark grounds, a single warm lamp over the desk.',
    sky: { turbidity: 16, rayleigh: 4.2, mieCoefficient: 0.02, mieDirectionalG: 0.94, sunPosition: [0, -3, -40] },
    fog: { color: '#1f2733', near: 30, far: 130 },
    grass: { base: '#1e2d24', accent: '#283a2c' },
    trees: { trunk: '#1b1813', canopy: '#1e3026', count: 60 },
    desk: { wood: '#9a6c43', grain: '#64442a', metal: '#6f7780' },
    lights: {
      ambient: { color: '#6d7f9c', intensity: 0.3 },
      hemisphere: { sky: '#394a63', ground: '#161c16', intensity: 0.4 },
      sun: { color: '#ffd194', intensity: 2.0, position: [2, 16, 6] },
    },
  },
];

export const ARENA_IDS: string[] = ARENAS.map((arena) => arena.id);

export const DEFAULT_ARENA_ID = 'classroom-morning';

export function getArena(id: string | null | undefined): ArenaPreset {
  const found = ARENAS.find((arena) => arena.id === id);
  return found ?? ARENAS[0]!;
}
