import { scryptAsync } from "@noble/hashes/scrypt.js";
import { randomBytes } from "@noble/hashes/utils.js";

/*
 * Passwords are hashed with scrypt in pure TypeScript, so the same function signs people in on
 * the server and in the browser demo. The stored form is `scrypt$N$r$p$salt$hash` (salt and
 * hash in hex), so the parameters can be raised later without breaking old hashes.
 */

const N = 2 ** 14;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function fromHex(text: string): Uint8Array | null {
  if (text.length === 0 || text.length % 2 !== 0 || !/^[0-9a-f]+$/.test(text)) return null;
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Hashes with a random salt, or with the given one (the seed passes a fixed salt to stay deterministic). */
export async function hashPassword(password: string, salt: Uint8Array = randomBytes(16)): Promise<string> {
  const key = await scryptAsync(password, salt, { N, r: R, p: P, dkLen: KEY_LENGTH });
  return `scrypt$${N}$${R}$${P}$${toHex(salt)}$${toHex(key)}`;
}

/** True only for the password behind the hash; a malformed hash is false, never an exception. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, keyHex] = parts as [string, string, string, string, string, string];
  const salt = fromHex(saltHex);
  const expected = fromHex(keyHex);
  if (!salt || !expected) return false;
  const params = { N: Number(n), r: Number(r), p: Number(p), dkLen: expected.length };
  if (![params.N, params.r, params.p].every((v) => Number.isInteger(v) && v > 0)) return false;
  let key: Uint8Array;
  try {
    key = await scryptAsync(password, salt, params);
  } catch {
    return false;
  }
  // Constant time: the loop always runs over the whole key.
  let diff = key.length ^ expected.length;
  for (let i = 0; i < key.length; i++) diff |= (key[i] ?? 0) ^ (expected[i] ?? 0);
  return diff === 0;
}

const COMMON = new Set([
  "password", "password1", "password123", "1234567890", "12345678910", "qwertyuiop", "iloveyou12", "letmein123",
  "abcdefghij", "administrator", "welcome123", "changeme123", "0123456789", "1q2w3e4r5t",
]);

/** The rule a new password must meet. Empty means fine. */
export function passwordProblems(password: string): string[] {
  if (password.length > 0 && password.trim().length === 0) return ["not only spaces"];
  if (password.length < 10) return ["at least 10 characters"];
  if (COMMON.has(password.toLowerCase())) return ["not one of the most common passwords"];
  return [];
}
