import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { DEFAULT_RATE_LIMIT, rateLimiterCreator } from "../src/grounding/rate.js";
import { fixedClock } from "./harness.js";

describe("the member's rate limit", () => {
  test("allows the requests of a minute, then refuses until the minute has passed", () => {
    const clock = fixedClock();
    const limiter = rateLimiterCreator(clock, { requestsPerMinute: 3, tokensPerMinute: 1000 });
    expect(limiter.take("lea", 10)).toBe(true);
    expect(limiter.take("lea", 10)).toBe(true);
    expect(limiter.take("lea", 10)).toBe(true);
    expect(limiter.take("lea", 10)).toBe(false);
    expect(limiter.take("tom", 10)).toBe(true);
    clock.advance(20_000); // a third of a minute refills one request
    expect(limiter.take("lea", 10)).toBe(true);
    expect(limiter.take("lea", 10)).toBe(false);
    clock.advance(60_000);
    expect(limiter.peek("lea")).toEqual({ requests: 3, tokens: 1000 });
  });

  test("refuses a request whose tokens do not fit, and a later spend can push the bucket into debt", () => {
    const clock = fixedClock();
    const limiter = rateLimiterCreator(clock, { requestsPerMinute: 10, tokensPerMinute: 100 });
    expect(limiter.take("lea", 80)).toBe(true);
    expect(limiter.take("lea", 30)).toBe(false);
    expect(limiter.take("lea", 20)).toBe(true);
    limiter.spend("lea", 50);
    expect(limiter.peek("lea").tokens).toBe(-50);
    clock.advance(30_000); // half a minute refills 50 tokens: back to zero
    expect(limiter.take("lea", 1)).toBe(false);
    clock.advance(30_000);
    expect(limiter.take("lea", 50)).toBe(true);
  });

  test("the defaults are 20 requests and 40,000 tokens a minute", () => {
    expect(DEFAULT_RATE_LIMIT).toEqual({ requestsPerMinute: 20, tokensPerMinute: 40_000 });
  });

  test("within any minute a key never gets more than the limit, whatever the timing", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 5000 }), { minLength: 1, maxLength: 60 }), (gaps) => {
        const clock = fixedClock();
        const limiter = rateLimiterCreator(clock, { requestsPerMinute: 5, tokensPerMinute: 500 });
        const granted: number[] = [];
        for (const gap of gaps) {
          clock.advance(gap);
          if (limiter.take("k", 100)) granted.push(clock.now().getTime());
        }
        for (const t of granted) {
          const inWindow = granted.filter((g) => g >= t && g < t + 60_000).length;
          // Five from a full bucket, plus what a minute of refill allows (five more at most).
          expect(inWindow).toBeLessThanOrEqual(10);
        }
      }),
    );
  });
});
