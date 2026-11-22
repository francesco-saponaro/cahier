import type { Clock } from "../ports.js";

/*
 * The member's rate limit: two token buckets per key (requests and tokens), each filling
 * continuously back to its minute's allowance. A question takes one request and the tokens it
 * is expected to cost; the tokens it did cost are spent afterwards, which can leave the bucket
 * in debt until the refill catches up. Pure over the clock, kept in memory: the server has one
 * process, and the browser demo has one tab.
 */

export interface RateLimit {
  requestsPerMinute: number;
  tokensPerMinute: number;
}

export const DEFAULT_RATE_LIMIT: RateLimit = { requestsPerMinute: 20, tokensPerMinute: 40_000 };

interface Bucket {
  requests: number;
  tokens: number;
  at: number;
}

export interface RateLimiter {
  /** One request and `tokens` tokens, if both fit; nothing is taken otherwise. */
  take(key: string, tokens: number): boolean;
  /** Tokens already used, after the fact; may go negative. */
  spend(key: string, tokens: number): void;
  /** What the key has left right now. */
  peek(key: string): { requests: number; tokens: number };
}

export function rateLimiterCreator(clock: Clock, limit: RateLimit = DEFAULT_RATE_LIMIT): RateLimiter {
  const buckets = new Map<string, Bucket>();

  /** The bucket refilled to now: `elapsed / minute` of each allowance, capped at the allowance. */
  const current = (key: string): Bucket => {
    const now = clock.now().getTime();
    const b = buckets.get(key) ?? { requests: limit.requestsPerMinute, tokens: limit.tokensPerMinute, at: now };
    const fraction = Math.max(0, now - b.at) / 60_000;
    const refilled: Bucket = {
      requests: Math.min(limit.requestsPerMinute, b.requests + fraction * limit.requestsPerMinute),
      tokens: Math.min(limit.tokensPerMinute, b.tokens + fraction * limit.tokensPerMinute),
      at: now,
    };
    buckets.set(key, refilled);
    return refilled;
  };

  return {
    take(key, tokens) {
      const b = current(key);
      if (b.requests < 1 || b.tokens < tokens) return false;
      b.requests -= 1;
      b.tokens -= tokens;
      return true;
    },
    spend(key, tokens) {
      current(key).tokens -= tokens;
    },
    peek(key) {
      const b = current(key);
      return { requests: b.requests, tokens: b.tokens };
    },
  };
}
