import { formatDollars } from "@cahier/domain";

/* Numbers, times and money as the screens print them: separators, a unit, words for recency. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Just now", "9 min", "3 h", "Yesterday", "6 days", then the date. */
export function ago(at: Date, now: Date = new Date()): string {
  const gap = now.getTime() - at.getTime();
  if (gap < MINUTE) return "Just now";
  if (gap < HOUR) return `${Math.floor(gap / MINUTE)} min`;
  if (gap < DAY) return `${Math.floor(gap / HOUR)} h`;
  if (gap < 2 * DAY) return "Yesterday";
  if (gap < 7 * DAY) return `${Math.floor(gap / DAY)} days`;
  const date = `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
  return at.getUTCFullYear() === now.getUTCFullYear() ? date : `${date} ${at.getUTCFullYear()}`;
}

/** "14 Sep 2026, 09:05" in the given zone (the browser's by default). */
export function when(at: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, ...(timeZone ? { timeZone } : {}) }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // en-GB writes "Sept"; every other month is already three letters.
  return `${get("day")} ${get("month").replace(/^Sept$/, "Sep")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

export const count = (n: number): string => n.toLocaleString("en-US");

export const tokens = (n: number): string => `${count(n)} ${n === 1 ? "token" : "tokens"}`;

export const dollars = (micros: number): string => formatDollars(micros);

export const plural = (n: number, one: string, many = `${one}s`): string => `${count(n)} ${n === 1 ? one : many}`;
