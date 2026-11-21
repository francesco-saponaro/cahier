import { describe, expect, test } from "vitest";
import { isTimeZone, nextOccurrence } from "../src/schedule.js";

const at = (iso: string) => new Date(iso);

describe("nextOccurrence", () => {
  test("a weekly schedule fires on its weekday at its minute in its time zone, after the instant given", () => {
    const monday0830 = { cadence: "weekly" as const, atMinute: 8 * 60 + 30, weekday: 1, dayOfMonth: null, timezone: "Europe/Paris" };
    // Saturday evening in Paris: the coming Monday, 08:30 CEST = 06:30 UTC.
    expect(nextOccurrence(monday0830, at("2026-09-19T18:00:00Z"))).toEqual(at("2026-09-21T06:30:00Z"));
    // Exactly at the instant: the one after, a week on.
    expect(nextOccurrence(monday0830, at("2026-09-21T06:30:00Z"))).toEqual(at("2026-09-28T06:30:00Z"));
    // A minute before: that same morning.
    expect(nextOccurrence(monday0830, at("2026-09-21T06:29:00Z"))).toEqual(at("2026-09-21T06:30:00Z"));
  });

  test("a daily schedule crosses the end of summer time without drifting", () => {
    const daily0900 = { cadence: "daily" as const, atMinute: 9 * 60, weekday: null, dayOfMonth: null, timezone: "Europe/Paris" };
    expect(nextOccurrence(daily0900, at("2026-10-24T08:00:00Z"))).toEqual(at("2026-10-25T08:00:00Z")); // CET from 25 Oct: 09:00 is 08:00 UTC
    expect(nextOccurrence(daily0900, at("2026-10-23T08:00:00Z"))).toEqual(at("2026-10-24T07:00:00Z")); // still CEST
  });

  test("a monthly schedule fires on its day of the month; a one-off fires at the next such time", () => {
    const first0900 = { cadence: "monthly" as const, atMinute: 9 * 60, weekday: null, dayOfMonth: 1, timezone: "Europe/Paris" };
    expect(nextOccurrence(first0900, at("2026-09-20T18:00:00Z"))).toEqual(at("2026-10-01T07:00:00Z"));
    expect(nextOccurrence(first0900, at("2026-10-01T07:00:00Z"))).toEqual(at("2026-11-01T08:00:00Z"));
    const once = { cadence: "once" as const, atMinute: 9 * 60, weekday: null, dayOfMonth: null, timezone: "Europe/Paris" };
    expect(nextOccurrence(once, at("2026-09-20T18:00:00Z"))).toEqual(at("2026-09-21T07:00:00Z"));
    expect(nextOccurrence(once, at("2026-09-20T06:00:00Z"))).toEqual(at("2026-09-20T07:00:00Z"));
  });

  test("works in a zone east of the date line and in UTC", () => {
    const tokyo = { cadence: "daily" as const, atMinute: 0, weekday: null, dayOfMonth: null, timezone: "Asia/Tokyo" };
    expect(nextOccurrence(tokyo, at("2026-09-20T18:00:00Z"))).toEqual(at("2026-09-21T15:00:00Z"));
    const utc = { cadence: "weekly" as const, atMinute: 23 * 60 + 59, weekday: 0, dayOfMonth: null, timezone: "UTC" };
    expect(nextOccurrence(utc, at("2026-09-20T23:59:00Z"))).toEqual(at("2026-09-27T23:59:00Z"));
  });

  test("knows a real time zone from a made-up one", () => {
    expect(isTimeZone("Europe/Paris")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});
