import * as THREE from 'three';

import { hashSeed, mulberry32 } from '@pfa/shared';

/**
 * Procedural textures drawn on a 2D canvas at runtime.
 *
 * The brief asked for nothing that can fail to load, so every surface in the
 * game is generated here rather than fetched: no image files, no CDN, no 404s,
 * and the arena tints drive the texture colours directly.
 */

const cache = new Map<string, THREE.CanvasTexture>();

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { canvas, ctx };
}

function finish(canvas: HTMLCanvasElement, repeat: number): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Planed timber: long grain lines, a few darker rings, subtle speckle. */
export function createWoodTexture(wood: string, grain: string): THREE.CanvasTexture {
  const key = `wood:${wood}:${grain}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const size = 512;
  const { canvas, ctx } = makeCanvas(size);
  const random = mulberry32(hashSeed(key));

  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, size, size);

  // Long grain.
  for (let i = 0; i < 230; i += 1) {
    const y = random() * size;
    const thickness = 0.4 + random() * 2.2;
    ctx.globalAlpha = 0.05 + random() * 0.16;
    ctx.strokeStyle = grain;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(0, y);

    let currentY = y;
    for (let x = 0; x <= size; x += 32) {
      currentY += (random() - 0.5) * 5;
      ctx.lineTo(x, currentY);
    }
    ctx.stroke();
  }

  // Occasional knot.
  for (let i = 0; i < 3; i += 1) {
    const cx = random() * size;
    const cy = random() * size;
    for (let r = 2; r < 26; r += 3) {
      ctx.globalAlpha = 0.1 + random() * 0.08;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.7, r * 0.75, random() * Math.PI, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  const texture = finish(canvas, 2);
  cache.set(key, texture);
  return texture;
}

/** Mown grass: base colour with clumps and blade speckle. */
export function createGrassTexture(base: string, accent: string): THREE.CanvasTexture {
  const key = `grass:${base}:${accent}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const size = 512;
  const { canvas, ctx } = makeCanvas(size);
  const random = mulberry32(hashSeed(key));

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 1400; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const length = 3 + random() * 7;
    ctx.globalAlpha = 0.12 + random() * 0.3;
    ctx.strokeStyle = random() > 0.45 ? accent : base;
    ctx.lineWidth = 1 + random();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() - 0.5) * 3, y - length);
    ctx.stroke();
  }

  // Broad patches so the lawn is not uniform at distance.
  for (let i = 0; i < 26; i += 1) {
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = random() > 0.5 ? accent : '#000000';
    ctx.beginPath();
    ctx.ellipse(
      random() * size,
      random() * size,
      20 + random() * 70,
      16 + random() * 50,
      random() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  const texture = finish(canvas, 26);
  cache.set(key, texture);
  return texture;
}

/** Faint ruled-paper sheet that sits on the desk for scale and colour relief. */
export function createPaperTexture(): THREE.CanvasTexture {
  const key = 'paper';
  const cached = cache.get(key);
  if (cached) return cached;

  const size = 256;
  const { canvas, ctx } = makeCanvas(size);

  ctx.fillStyle = '#f4f1e6';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#b9c7d6';
  ctx.lineWidth = 1;
  for (let y = 18; y < size; y += 18) {
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(6, y);
    ctx.lineTo(size - 6, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#e0a0a0';
  ctx.beginPath();
  ctx.moveTo(26, 0);
  ctx.lineTo(26, size);
  ctx.stroke();

  ctx.globalAlpha = 1;
  const texture = finish(canvas, 1);
  cache.set(key, texture);
  return texture;
}

export function disposeTextureCache(): void {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}
