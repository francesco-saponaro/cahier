import type { Cadence, RunStatus } from "@cahier/domain";

/* A schedule's cadence in words, the time field's two directions, and a run's status in words. */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface CadenceFields {
  cadence: Cadence;
  atMinute: number;
  weekday: number | null;
  dayOfMonth: number | null;
  timezone: string;
}

const ordinal = (n: number): string => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

export function cadenceWords(s: CadenceFields): string {
  const at = `at ${timeOf(s.atMinute)}, ${s.timezone}`;
  switch (s.cadence) {
    case "daily":
      return `Every day ${at}`;
    case "weekly":
      return `Every ${DAYS[s.weekday ?? 0]} ${at}`;
    case "monthly":
      return `The ${ordinal(s.dayOfMonth ?? 1)} of every month ${at}`;
    case "once":
      return `Once, ${at}`;
  }
}

/** "09:30" → 570; anything that is not HH:MM in range → null. */
export function minuteOf(text: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function timeOf(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** The refusal reasons a run can end with, in words; any other error is the message itself. */
const REASONS: Record<string, string> = {
  budget_exhausted: "the month's budget was exhausted",
  rate_limited: "the rate limit was reached",
  tool_off: "grounded answers were switched off",
  no_sources: "nothing in the sources answered",
  no_price: "the model has no price in force",
};

export function runWords(run: { status: RunStatus; error: string | null }): string {
  switch (run.status) {
    case "succeeded":
      return "Ran";
    case "failed":
      return `Failed: ${REASONS[run.error ?? ""] ?? run.error ?? "unknown error"}`;
    case "skipped":
      return "Skipped, the previous run was still going";
    case "queued":
      return "Waiting";
    case "running":
      return "Running";
    case "cancelled":
      return "Cancelled";
  }
}
