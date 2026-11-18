import { describe, expect, test } from "vitest";
import { hashPassword, passwordProblems, verifyPassword } from "../src/password.js";

describe("hashPassword and verifyPassword", () => {
  test("verifies the password it hashed and nothing else", async () => {
    const hash = await hashPassword("a plain long phrase");
    expect(await verifyPassword("a plain long phrase", hash)).toBe(true);
    expect(await verifyPassword("a plain long phrasE", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  test("salts, so the same password hashes differently twice, in the scrypt$ form", async () => {
    const a = await hashPassword("a plain long phrase");
    const b = await hashPassword("a plain long phrase");
    expect(a).not.toBe(b);
    expect(a.split("$")).toHaveLength(6);
    expect(a.startsWith("scrypt$")).toBe(true);
  });

  test("is false, not an exception, on a malformed hash", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$abc")).toBe(false);
    expect(await verifyPassword("x", "scrypt$notanumber$8$1$zz$zz")).toBe(false);
    expect(await verifyPassword("x", "scrypt$16384$8$1$0a$")).toBe(false);
  });

  test("hashes with a fixed salt deterministically when the seed asks for it", async () => {
    const salt = new Uint8Array(16).fill(3);
    expect(await hashPassword("cahier-demo", salt)).toBe(await hashPassword("cahier-demo", salt));
  });
});

describe("passwordProblems", () => {
  test("accepts ten characters that are not a common password", () => {
    expect(passwordProblems("cahier-demo")).toEqual([]);
  });

  test("names the rule a password breaks", () => {
    expect(passwordProblems("short")).toEqual(["at least 10 characters"]);
    expect(passwordProblems("password123")).toEqual(["not one of the most common passwords"]);
    expect(passwordProblems("1234567890")).toEqual(["not one of the most common passwords"]);
    expect(passwordProblems("          ")).toEqual(["not only spaces"]);
  });
});
