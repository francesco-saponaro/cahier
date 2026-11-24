import type { UsageGroup } from "@cahier/domain";

/*
 * The usage dashboard's daily series and its scale. The report answers one row per day that had
 * usage; the chart wants every day of the month up to today, zeros included, so a quiet day is a
 * gap the eye can read and nothing is drawn for days that have not happened.
 */

export interface DayPoint {
  day: string;
  tokens: number;
  costMicros: number;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export function dailySeries(byDay: UsageGroup[], month: string, now: Date): DayPoint[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = dayOf(now);
  const byKey = new Map(byDay.map((g) => [g.key, g]));
  const out: DayPoint[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const day = `${month}-${String(d).padStart(2, "0")}`;
    if (day > today) break;
    const row = byKey.get(day);
    out.push({ day, tokens: row?.tokens ?? 0, costMicros: row?.costMicros ?? 0 });
  }
  return out;
}

/** Four ticks in a round step whose top is at or above the maximum; a lone zero for nothing. */
export function scaleTicks(max: number): number[] {
  if (max <= 0) return [0];
  const rough = max / 3;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((n) => n * power).find((s) => s * 3 >= max) ?? 10 * power;
  return [0, step, step * 2, step * 3];
}

export const shareOf = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);
