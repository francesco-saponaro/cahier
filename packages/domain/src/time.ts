/*
 * Months are `YYYY-MM` in UTC: a budget, a usage report and a closed month all name one. Days of
 * the usage report are UTC days too, so the server and the browser demo group the same rows.
 */

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const monthOf = (d: Date): string => d.toISOString().slice(0, 7);
export const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

export function isMonth(text: string): boolean {
  return MONTH.test(text);
}

/** The first instant of the month, UTC. */
export function monthStart(month: string): Date {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1));
}

/** `2026-12` → `2027-01`. */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return monthOf(new Date(Date.UTC(y, m, 1)));
}
