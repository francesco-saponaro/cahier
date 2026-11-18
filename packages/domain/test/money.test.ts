import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { costMicros, formatDollars, parseDollars, priceInForce, type ModelPrice } from "../src/money.js";

describe("costMicros", () => {
  test("is tokens times the price per thousand, rounded half up to the micro-dollar", () => {
    // Mistral Large 4 input: $0.70 per million tokens = 700 micro-dollars per 1,000 tokens.
    expect(costMicros(1000, 700)).toBe(700);
    expect(costMicros(1, 700)).toBe(1); // 0.7 rounds up
    expect(costMicros(1, 400)).toBe(0); // 0.4 rounds down
    expect(costMicros(5, 100)).toBe(1); // 0.5 rounds up, half up
    expect(costMicros(0, 700)).toBe(0);
    expect(costMicros(1_234_567, 2100)).toBe(2_592_591); // 2,592,590.7
  });

  test("never drifts more than half a micro-dollar from the exact product and is monotonic", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), fc.integer({ min: 0, max: 100_000 }), (tokens, price) => {
        const exact = (tokens * price) / 1000;
        const c = costMicros(tokens, price);
        expect(Math.abs(c - exact)).toBeLessThanOrEqual(0.5);
        expect(costMicros(tokens + 1, price)).toBeGreaterThanOrEqual(c);
      }),
    );
  });
});

describe("formatDollars and parseDollars", () => {
  test("formats micro-dollars as dollars with cents, and small amounts with more digits", () => {
    expect(formatDollars(1_500_000)).toBe("$1.50");
    expect(formatDollars(0)).toBe("$0.00");
    expect(formatDollars(12_345_678_900)).toBe("$12,345.68");
    expect(formatDollars(700)).toBe("$0.0007");
    expect(formatDollars(4_900)).toBe("$0.0049");
  });

  test("parses a dollar amount typed by an admin into micro-dollars, or null", () => {
    expect(parseDollars("25")).toBe(25_000_000);
    expect(parseDollars("$1,250.50")).toBe(1_250_500_000);
    expect(parseDollars("0.0007")).toBe(700);
    expect(parseDollars("-3")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
    expect(parseDollars("1.2345678")).toBeNull(); // more precision than a micro-dollar
  });
});

describe("priceInForce", () => {
  const prices: ModelPrice[] = [
    { modelId: "large", kind: "input", microsPer1k: 500, validFrom: new Date("2026-01-01T00:00:00Z"), validTo: new Date("2026-09-01T00:00:00Z") },
    { modelId: "large", kind: "input", microsPer1k: 700, validFrom: new Date("2026-09-01T00:00:00Z"), validTo: null },
    { modelId: "large", kind: "output", microsPer1k: 2100, validFrom: new Date("2026-09-01T00:00:00Z"), validTo: null },
    { modelId: "small", kind: "input", microsPer1k: 150, validFrom: new Date("2026-01-01T00:00:00Z"), validTo: null },
  ];

  test("picks the price whose range covers the instant, start inclusive and end exclusive", () => {
    expect(priceInForce(prices, "large", "input", new Date("2026-08-31T23:59:59Z"))?.microsPer1k).toBe(500);
    expect(priceInForce(prices, "large", "input", new Date("2026-09-01T00:00:00Z"))?.microsPer1k).toBe(700);
    expect(priceInForce(prices, "large", "output", new Date("2026-11-18T00:00:00Z"))?.microsPer1k).toBe(2100);
  });

  test("is null when nothing covers the instant or the model and kind are unknown", () => {
    expect(priceInForce(prices, "large", "output", new Date("2026-03-01T00:00:00Z"))).toBeNull();
    expect(priceInForce(prices, "large", "input", new Date("2025-12-31T23:59:59Z"))).toBeNull();
    expect(priceInForce(prices, "medium", "input", new Date("2026-11-18T00:00:00Z"))).toBeNull();
    expect(priceInForce(prices, "small", "cached_input", new Date("2026-11-18T00:00:00Z"))).toBeNull();
  });
});
