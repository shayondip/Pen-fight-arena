/** Small dependency-free math helpers shared by the client and the server. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Normalises a 2D vector. Returns null when the vector has no usable direction. */
export function normalize2(x: number, z: number): { x: number; z: number } | null {
  const lengthSq = x * x + z * z;
  if (!Number.isFinite(lengthSq) || lengthSq < 1e-8) return null;
  const length = Math.sqrt(lengthSq);
  return { x: x / length, z: z / length };
}

/** Rotates a 2D (XZ) direction by an angle in radians. */
export function rotate2(x: number, z: number, radians: number): { x: number; z: number } {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: x * c - z * s, z: x * s + z * c };
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

/** Spherical linear interpolation between two unit quaternions. */
export function slerpQuat(a: Quat, b: Quat, t: number): Quat {
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;

  let cosHalfTheta = a.x * bx + a.y * by + a.z * bz + a.w * bw;

  // Always take the shortest arc.
  if (cosHalfTheta < 0) {
    cosHalfTheta = -cosHalfTheta;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }

  if (cosHalfTheta >= 1.0 - 1e-6) {
    // Quaternions are nearly identical - plain lerp plus a renormalise is stable here.
    return normalizeQuat({
      x: lerp(a.x, bx, t),
      y: lerp(a.y, by, t),
      z: lerp(a.z, bz, t),
      w: lerp(a.w, bw, t),
    });
  }

  const halfTheta = Math.acos(cosHalfTheta);
  const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

  return {
    x: a.x * ratioA + bx * ratioB,
    y: a.y * ratioA + by * ratioB,
    z: a.z * ratioA + bz * ratioB,
    w: a.w * ratioA + bw * ratioB,
  };
}

export function normalizeQuat(q: Quat): Quat {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (length < 1e-8) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

/**
 * Deterministic 32-bit PRNG (mulberry32). Used for scenery placement so that the
 * same arena always renders the same trees, and for reproducible tests.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hashes a short string into a 32-bit seed. */
export function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
