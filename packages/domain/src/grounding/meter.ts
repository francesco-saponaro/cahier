import { costMicros, priceInForce, type ModelPrice, type PriceKind } from "../money.js";

/*
 * Metering: what a question will cost before it is answered, and what it did cost after. Costs
 * are integer micro-dollars at the price in force at the message's instant, one rounding per
 * usage row, so the month's report adds up exactly. The budget check is a comparison of sums:
 * the month's limit minus what the usage rows already say, against the estimate.
 */

/** Tokens kept free for the answer when the context budget is computed and the cost estimated. */
export const ANSWER_RESERVE = 256;

export type TokenCounts = Record<PriceKind, number>;

export interface CostedRow {
  kind: PriceKind;
  tokens: number;
  microsPer1k: number;
  costMicros: number;
}

const KINDS: PriceKind[] = ["input", "cached_input", "output"];

/** One row per kind at the price in force at `at`; null when the model has no price for one of them. */
export function costedRows(prices: readonly ModelPrice[], modelId: string, at: Date, tokens: TokenCounts): CostedRow[] | null {
  const rows: CostedRow[] = [];
  for (const kind of KINDS) {
    const price = priceInForce(prices, modelId, kind, at);
    if (!price) return null;
    rows.push({ kind, tokens: tokens[kind], microsPer1k: price.microsPer1k, costMicros: costMicros(tokens[kind], price.microsPer1k) });
  }
  return rows;
}

/** The sum of the costed rows, or null when a price is missing. */
export function estimatedCostMicros(prices: readonly ModelPrice[], modelId: string, at: Date, tokens: TokenCounts): number | null {
  const rows = costedRows(prices, modelId, at, tokens);
  return rows ? rows.reduce((n, r) => n + r.costMicros, 0) : null;
}

/** Whether `estimateMicros` fits in what the month's limit leaves; a month with no budget row has no cap. */
export function roomInBudget(limitMicros: number | null, spentMicros: number, estimateMicros: number): boolean {
  if (limitMicros === null) return true;
  return spentMicros + estimateMicros <= limitMicros;
}
