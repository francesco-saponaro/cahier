/*
 * Money is integer micro-dollars (a millionth of a dollar), because a thousand tokens of a small
 * model cost a fraction of a cent and the usage report has to add up exactly. Prices are integer
 * micro-dollars per thousand tokens: $0.70 per million tokens is 700. Nothing here is a float
 * except inside `costMicros`, where the product of two integers is divided once and rounded.
 */

export type PriceKind = "input" | "cached_input" | "output";

export interface ModelPrice {
  modelId: string;
  kind: PriceKind;
  microsPer1k: number;
  validFrom: Date;
  /** Null means still in force. */
  validTo: Date | null;
}

/** The cost of `tokens` at `microsPer1k`, rounded half up to the micro-dollar. */
export function costMicros(tokens: number, microsPer1k: number): number {
  return Math.floor((tokens * microsPer1k + 500) / 1000);
}

/** "$1.50"; amounts under a cent keep four decimals so a single answer's cost is still readable. */
export function formatDollars(micros: number): string {
  const dollars = micros / 1_000_000;
  const digits = micros !== 0 && Math.abs(micros) < 10_000 ? 4 : 2;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Dollars typed by a person ("25", "$1,250.50", "0.0007") to micro-dollars; null on anything else. */
export function parseDollars(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "").replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(cleaned);
  if (!m) return null;
  const whole = Number(m[1]);
  const fraction = (m[2] ?? "").padEnd(6, "0");
  return whole * 1_000_000 + Number(fraction);
}

/** The price covering `at` for the model and kind: start inclusive, end exclusive; null if none. */
export function priceInForce(prices: readonly ModelPrice[], modelId: string, kind: PriceKind, at: Date): ModelPrice | null {
  const t = at.getTime();
  for (const p of prices) {
    if (p.modelId !== modelId || p.kind !== kind) continue;
    if (p.validFrom.getTime() <= t && (p.validTo === null || t < p.validTo.getTime())) return p;
  }
  return null;
}
