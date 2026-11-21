import type { Cadence } from "./entities.js";

/*
 * When a scheduled prompt fires next: the first instant after a given one whose wall-clock time
 * in the schedule's time zone is the schedule's minute, on its weekday or day of the month. Done
 * with the platform's own time-zone tables (Intl), so summer time is handled where the data is.
 */

export interface ScheduleShape {
  cadence: Cadence;
  /** Minutes after midnight, local. */
  atMinute: number;
  /** 0 = Sunday … 6 = Saturday, for weekly. */
  weekday: number | null;
  /** 1 to 28, for monthly. */
  dayOfMonth: number | null;
  timezone: string;
}

const formats = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formats.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formats.set(timezone, f);
  }
  return f;
}

export function isTimeZone(timezone: string): boolean {
  if (timezone.length === 0) return false;
  try {
    formatter(timezone);
    return true;
  } catch {
    return false;
  }
}

/** The local calendar fields of an instant in the zone. */
function localParts(timezone: string, at: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = formatter(timezone).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Local time minus UTC at the instant, in milliseconds. */
function offsetAt(timezone: string, at: Date): number {
  const l = localParts(timezone, at);
  return Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second) - at.getTime();
}

/** The instant at which the zone's clocks show the local date and minute. */
function localToUtc(timezone: string, year: number, month: number, day: number, minute: number): Date {
  const wall = Date.UTC(year, month - 1, day, 0, minute);
  let utc = wall - offsetAt(timezone, new Date(wall));
  const offset = offsetAt(timezone, new Date(utc));
  if (wall - offset !== utc) utc = wall - offset;
  return new Date(utc);
}

/** The next time the schedule fires strictly after `after`, or null when the cadence never matches (it always does within 62 days). */
export function nextOccurrence(schedule: ScheduleShape, after: Date): Date | null {
  const start = localParts(schedule.timezone, after);
  for (let i = 0; i < 62; i++) {
    const date = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    if (schedule.cadence === "weekly" && date.getUTCDay() !== schedule.weekday) continue;
    if (schedule.cadence === "monthly" && day !== schedule.dayOfMonth) continue;
    const candidate = localToUtc(schedule.timezone, year, month, day, schedule.atMinute);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  return null;
}

