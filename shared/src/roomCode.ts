import { ROOM_CODE_LENGTH } from './constants.js';

/**
 * Room-code alphabet with the ambiguous glyphs removed (no I, O, 0 or 1), so a
 * code read aloud or typed from a photo cannot land in the wrong room.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Generates a room code. `random` is injectable so tests stay deterministic. */
export function generateRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    const index = Math.floor(random() * ROOM_CODE_ALPHABET.length) % ROOM_CODE_ALPHABET.length;
    code += ROOM_CODE_ALPHABET[index] ?? 'A';
  }
  return code;
}

/** Generates a code that is not already taken. */
export function generateUniqueRoomCode(
  isTaken: (code: string) => boolean,
  random: () => number = Math.random,
  maxAttempts = 50,
): string {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = generateRoomCode(random);
    if (!isTaken(code)) return code;
  }
  // Astronomically unlikely with a 32^5 space, but never hand back a duplicate.
  throw new Error('Could not allocate a free room code');
}

/** Builds the shareable invite link for a room. */
export function buildInviteUrl(publicBaseUrl: string, code: string): string {
  const base = publicBaseUrl.replace(/\/+$/, '');
  return `${base}/?room=${encodeURIComponent(code)}`;
}
