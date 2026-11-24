import { describe, expect, test } from "vitest";
import { cadenceWords, minuteOf, runWords, timeOf } from "../src/screens/schedules/cadence";

/* A schedule's cadence in words, and the time field's two directions. */

describe("the cadence in words", () => {
  test("names the cadence, the day and the time in the schedule's zone", () => {
    expect(cadenceWords({ cadence: "daily", atMinute: 540, weekday: null, dayOfMonth: null, timezone: "Europe/Paris" })).toBe("Every day at 09:00, Europe/Paris");
    expect(cadenceWords({ cadence: "weekly", atMinute: 510, weekday: 1, dayOfMonth: null, timezone: "Europe/Paris" })).toBe("Every Monday at 08:30, Europe/Paris");
    expect(cadenceWords({ cadence: "weekly", atMinute: 0, weekday: 0, dayOfMonth: null, timezone: "UTC" })).toBe("Every Sunday at 00:00, UTC");
    expect(cadenceWords({ cadence: "monthly", atMinute: 1439, weekday: null, dayOfMonth: 1, timezone: "America/New_York" })).toBe("The 1st of every month at 23:59, America/New_York");
    expect(cadenceWords({ cadence: "monthly", atMinute: 600, weekday: null, dayOfMonth: 22, timezone: "Asia/Tokyo" })).toBe("The 22nd of every month at 10:00, Asia/Tokyo");
    expect(cadenceWords({ cadence: "once", atMinute: 720, weekday: null, dayOfMonth: null, timezone: "Europe/Paris" })).toBe("Once, at 12:00, Europe/Paris");
  });
});

describe("the time field", () => {
  test("reads HH:MM as a minute of the day and writes it back", () => {
    expect(minuteOf("09:30")).toBe(570);
    expect(minuteOf("00:00")).toBe(0);
    expect(minuteOf("23:59")).toBe(1439);
    expect(minuteOf("9:5")).toBeNull();
    expect(minuteOf("24:00")).toBeNull();
    expect(minuteOf("")).toBeNull();
    expect(timeOf(570)).toBe("09:30");
    expect(timeOf(0)).toBe("00:00");
  });
});

describe("a run's status in words", () => {
  test("says what happened, with the error when it failed", () => {
    expect(runWords({ status: "succeeded", error: null })).toBe("Ran");
    expect(runWords({ status: "failed", error: "budget_exhausted" })).toBe("Failed: the month's budget was exhausted");
    expect(runWords({ status: "failed", error: "no_sources" })).toBe("Failed: nothing in the sources answered");
    expect(runWords({ status: "failed", error: "The agent's library had no indexed document." })).toBe("Failed: The agent's library had no indexed document.");
    expect(runWords({ status: "skipped", error: null })).toBe("Skipped, the previous run was still going");
    expect(runWords({ status: "queued", error: null })).toBe("Waiting");
    expect(runWords({ status: "running", error: null })).toBe("Running");
    expect(runWords({ status: "cancelled", error: null })).toBe("Cancelled");
  });
});
