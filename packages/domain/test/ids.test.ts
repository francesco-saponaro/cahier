import { describe, expect, test } from "vitest";
import { cryptoIdGeneratorCreator, systemClock } from "../src/ids.js";

describe("cryptoIdGeneratorCreator", () => {
  test("makes ids with the prefix, an underscore and twenty lower-case alphanumerics, all different", () => {
    const ids = cryptoIdGeneratorCreator();
    const made = Array.from({ length: 200 }, () => ids.id("lib"));
    for (const id of made) expect(id).toMatch(/^lib_[a-z0-9]{20}$/);
    expect(new Set(made).size).toBe(200);
  });

  test("makes tokens of the asked length from the same alphabet", () => {
    const ids = cryptoIdGeneratorCreator();
    expect(ids.token(48)).toMatch(/^[a-z0-9]{48}$/);
    expect(ids.token(1)).toMatch(/^[a-z0-9]$/);
    expect(ids.token(48)).not.toBe(ids.token(48));
  });

  test("the system clock reads the real time", () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
