import { describe, expect, test } from "vitest";
import { dailySeries, scaleTicks, shareOf } from "../src/screens/admin/daily";

/*
 * The usage dashboard's daily series: one column per day of the month, zeros where nothing was
 * spent, nothing after today; the y scale in round steps with its top tick above the maximum.
 */

describe("the daily series", () => {
  test("fills every day of the month up to today with the rows' values or zero", () => {
    const rows = [
      { key: "2026-11-03", label: "2026-11-03", tokens: 1200, costMicros: 480 },
      { key: "2026-11-10", label: "2026-11-10", tokens: 300, costMicros: 90 },
    ];
    const series = dailySeries(rows, "2026-11", new Date("2026-11-12T10:00:00Z"));
    expect(series).toHaveLength(12);
    expect(series[0]).toEqual({ day: "2026-11-01", tokens: 0, costMicros: 0 });
    expect(series[2]).toEqual({ day: "2026-11-03", tokens: 1200, costMicros: 480 });
    expect(series[11]).toEqual({ day: "2026-11-12", tokens: 0, costMicros: 0 });
  });

  test("a past month runs to its last day, a future month is empty", () => {
    expect(dailySeries([], "2026-02", new Date("2026-11-12T10:00:00Z"))).toHaveLength(28);
    expect(dailySeries([], "2026-12", new Date("2026-11-12T10:00:00Z"))).toHaveLength(0);
  });
});

describe("the y scale", () => {
  test("gives four round ticks with the top one above the maximum, and zero for nothing", () => {
    expect(scaleTicks(0)).toEqual([0]);
    expect(scaleTicks(7)).toEqual([0, 2.5, 5, 7.5]);
    expect(scaleTicks(480)).toEqual([0, 200, 400, 600]);
    expect(scaleTicks(1_250_000)).toEqual([0, 500_000, 1_000_000, 1_500_000]);
    expect(scaleTicks(600)).toEqual([0, 200, 400, 600]);
  });
});

describe("a group's share", () => {
  test("is its part of the whole as a ratio, and zero of nothing", () => {
    expect(shareOf(250, 1000)).toBe(0.25);
    expect(shareOf(0, 0)).toBe(0);
  });
});
