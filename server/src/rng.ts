/**
 * Randomness.
 *
 * Everything random in a game happens here, on the server, using the OS CSPRNG.
 * Clients never generate a shuffle or a die roll — they only receive the outcome.
 * That is what makes "the deck order is honest" a property of the system rather than
 * a promise, and it is why refreshing the page cannot re-roll a die.
 */

import { randomBytes, randomInt } from 'node:crypto';

/** Uniform integer in [0, max). Uses rejection sampling internally via node:crypto. */
export function rngInt(max: number): number {
  if (max <= 0) throw new RangeError(`rngInt requires max > 0, got ${max}`);
  if (max === 1) return 0;
  return randomInt(0, max);
}

/** Roll a die with `sides` faces, returning 1..sides. */
export function rollDie(sides: number): number {
  return rngInt(Math.max(1, Math.floor(sides))) + 1;
}

/** Fisher-Yates, unbiased, in place. */
export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rngInt(i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Room codes. Deliberately generated here rather than reusing Colyseus's room id:
 * the bundled nanoid v2 carries a predictable-generation advisory, and a guessable
 * room code would let strangers walk into a private table.
 *
 * Ambiguous glyphs (0/O, 1/I/L) are excluded so codes survive being read aloud.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeRoomCode(length = 6): string {
  const bytes = randomBytes(length * 2);
  let out = '';
  let i = 0;
  while (out.length < length) {
    const b = bytes[i++ % bytes.length];
    // Reject values that would bias the modulo, then retry with the next byte.
    if (b >= 256 - (256 % CODE_ALPHABET.length)) continue;
    out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  return out;
}

/** Short unique id for pieces, stacks and log lines. */
export function makeId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('base64url')}`;
}
