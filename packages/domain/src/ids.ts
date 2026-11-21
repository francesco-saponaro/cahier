import type { Clock, IdGenerator } from "./ports.js";

/*
 * Random ids and tokens from the platform's secure generator, which exists under the same name
 * in Node and in the browser, so the demo makes its ids the way the server does. Ids follow the
 * seed's shape, `lib_` and then the random part, so a log line says what it names.
 */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 20;

/** Draws bytes and keeps only those below the largest multiple of 36, so every symbol is equally likely. */
function randomAlphanumerics(length: number): string {
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  const buffer = new Uint8Array(length * 2);
  while (out.length < length) {
    globalThis.crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function cryptoIdGeneratorCreator(): IdGenerator {
  return {
    id: (prefix) => `${prefix}_${randomAlphanumerics(ID_LENGTH)}`,
    token: (length) => randomAlphanumerics(length),
  };
}

export const systemClock: Clock = { now: () => new Date() };
