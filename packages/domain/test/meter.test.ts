import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { ANSWER_RESERVE, costedRows, estimatedCostMicros, roomInBudget } from "../src/grounding/meter.js";
import type { ModelPrice } from "../src/money.js";

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n));
const prices: ModelPrice[] = [
  { modelId: "small-4", kind: "input", microsPer1k: 150, validFrom: day(-100), validTo: null },
  { modelId: "small-4", kind: "cached_input", microsPer1k: 15, validFrom: day(-100), validTo: null },
  { modelId: "small-4", kind: "output", microsPer1k: 600, validFrom: day(-100), validTo: null },
  { modelId: "large-4", kind: "input", microsPer1k: 500, validFrom: day(-100), validTo: day(0) },
  { modelId: "large-4", kind: "input", microsPer1k: 700, validFrom: day(0), validTo: null },
];

describe("costedRows", () => {
  test("one row per kind at the price in force, each rounded half up on its own", () => {
    const rows = costedRows(prices, "small-4", day(10), { input: 42, cached_input: 581, output: 71 });
    expect(rows).toEqual([
      { kind: "input", tokens: 42, microsPer1k: 150, costMicros: 6 },
      { kind: "cached_input", tokens: 581, microsPer1k: 15, costMicros: 9 },
      { kind: "output", tokens: 71, microsPer1k: 600, costMicros: 43 },
    ]);
  });

  test("answers null when any kind has no price in force at that instant", () => {
    expect(costedRows(prices, "large-4", day(10), { input: 1, cached_input: 1, output: 1 })).toBeNull();
    expect(costedRows(prices, "unknown", day(10), { input: 1, cached_input: 1, output: 1 })).toBeNull();
  });

  test("the total of the rows is what the estimate says", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), fc.integer({ min: 0, max: 100_000 }), fc.integer({ min: 0, max: 100_000 }), (a, b, c) => {
        const tokens = { input: a, cached_input: b, output: c };
        const rows = costedRows(prices, "small-4", day(10), tokens)!;
        expect(rows.reduce((n, r) => n + r.costMicros, 0)).toBe(estimatedCostMicros(prices, "small-4", day(10), tokens));
      }),
    );
  });
});

describe("roomInBudget", () => {
  test("no budget row means no cap; otherwise the estimate must fit in what is left", () => {
    expect(roomInBudget(null, 100, 50)).toBe(true);
    expect(roomInBudget(1000, 900, 100)).toBe(true);
    expect(roomInBudget(1000, 901, 100)).toBe(false);
    expect(roomInBudget(0, 0, 1)).toBe(false);
    expect(roomInBudget(0, 0, 0)).toBe(true);
  });

  test("the answer reserve is 256 tokens", () => {
    expect(ANSWER_RESERVE).toBe(256);
  });
});
