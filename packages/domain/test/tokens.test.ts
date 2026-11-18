import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { countTokens, tokenize } from "../src/text/tokens.js";

describe("tokenize", () => {
  test("splits words and punctuation", () => {
    expect(tokenize("Hello, world.")).toEqual(["Hello", ",", "world", "."]);
  });

  test("a long word counts one token per six characters", () => {
    // "extraordinarily" is 15 characters: 15 / 6 rounds up to 3.
    expect(countTokens("extraordinarily")).toBe(3);
    expect(countTokens("sixsix")).toBe(1);
    expect(countTokens("sixsixs")).toBe(2);
  });

  test("whitespace and the empty string count nothing", () => {
    expect(countTokens("")).toBe(0);
    expect(countTokens("   \n\t ")).toBe(0);
  });

  test("apostrophes and hyphens stay inside a word", () => {
    expect(tokenize("don't re-index")).toEqual(["don't", "re-index"]);
  });

  test("numbers and symbols are tokens", () => {
    expect(tokenize("3,5 % of 2026")).toEqual(["3", ",", "5", "%", "of", "2026"]);
  });

  test("counting is additive over concatenation with a space", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        expect(countTokens(`${a} ${b}`)).toBe(countTokens(a) + countTokens(b));
      }),
    );
  });

  test("the count is never more than the characters and never zero for a letter", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const n = countTokens(s);
        expect(n).toBeLessThanOrEqual(s.length);
        if (/\p{L}/u.test(s)) expect(n).toBeGreaterThan(0);
      }),
    );
  });
});
