import { describe, expect, test } from "vitest";
import { ago, count, dollars, tokens, when } from "../src/lib/format";

const NOW = new Date("2026-11-23T20:00:00Z");

describe("formats", () => {
  test("a time in words, measured from now", () => {
    expect(ago(new Date("2026-11-23T19:59:30Z"), NOW)).toBe("Just now");
    expect(ago(new Date("2026-11-23T19:51:00Z"), NOW)).toBe("9 min");
    expect(ago(new Date("2026-11-23T17:00:00Z"), NOW)).toBe("3 h");
    expect(ago(new Date("2026-11-22T20:00:00Z"), NOW)).toBe("Yesterday");
    expect(ago(new Date("2026-11-17T20:00:00Z"), NOW)).toBe("6 days");
    expect(ago(new Date("2026-09-14T09:00:00Z"), NOW)).toBe("14 Sep");
    expect(ago(new Date("2025-09-14T09:00:00Z"), NOW)).toBe("14 Sep 2025");
  });

  test("a date and time in full", () => {
    expect(when(new Date("2026-09-14T09:05:00Z"), "UTC")).toBe("14 Sep 2026, 09:05");
    expect(when(new Date("2026-10-31T22:00:00Z"), "UTC")).toBe("31 Oct 2026, 22:00");
    expect(when(new Date("2026-08-01T00:00:00Z"), "UTC")).toBe("1 Aug 2026, 00:00");
  });

  test("counts with separators, tokens with a unit, dollars from micro-dollars", () => {
    expect(count(12600)).toBe("12,600");
    expect(tokens(2126)).toBe("2,126 tokens");
    expect(tokens(1)).toBe("1 token");
    expect(dollars(435)).toBe("$0.0004");
    expect(dollars(29899)).toBe("$0.03");
    expect(dollars(2_000_000)).toBe("$2.00");
  });
});
