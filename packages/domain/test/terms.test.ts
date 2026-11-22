import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { isStopWord, phraseOf, queryTerms, stem } from "../src/grounding/terms.js";

describe("stem", () => {
  test("lower-cases and strips plural and verb endings", () => {
    expect(stem("Days")).toBe("day");
    expect(stem("policies")).toBe("policy");
    expect(stem("earned")).toBe("earn");
    expect(stem("working")).toBe("work");
    expect(stem("expenses")).toBe("expense");
    expect(stem("classes")).toBe("class");
    expect(stem("leaves")).toBe("leave");
  });

  test("leaves short words and words ending in ss alone", () => {
    expect(stem("is")).toBe("is");
    expect(stem("bus")).toBe("bus");
    expect(stem("class")).toBe("class");
    expect(stem("red")).toBe("red");
  });

  test("is idempotent", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{1,12}$/), (w) => {
        expect(stem(stem(w))).toBe(stem(w));
      }),
    );
  });
});

describe("queryTerms", () => {
  test("keeps the words that carry meaning, stemmed and without repeats", () => {
    expect(queryTerms("How many days of paid leave do I earn, and when are days earned?")).toEqual(["many", "day", "paid", "leave", "earn"]);
  });

  test("a question of stop words only has no terms", () => {
    expect(queryTerms("What is it?")).toEqual([]);
    expect(queryTerms("")).toEqual([]);
  });

  test("never answers a stop word or a term shorter than two characters", () => {
    fc.assert(
      fc.property(fc.string({ size: "medium" }), (q) => {
        for (const t of queryTerms(q)) {
          expect(isStopWord(t)).toBe(false);
          expect(t.length).toBeGreaterThanOrEqual(2);
        }
      }),
    );
  });
});

describe("phraseOf", () => {
  test("prefers the longest quoted phrase", () => {
    expect(phraseOf('What does "skeleton team" mean in "the office runs with a skeleton team" here?')).toBe("the office runs with a skeleton team");
  });

  test("otherwise takes the three consecutive words with the most letters", () => {
    expect(phraseOf("How is sick leave paid at full salary")).toBe("sick leave paid");
  });

  test("answers null for a question with fewer than three words and no quote", () => {
    expect(phraseOf("Sick leave?")).toBeNull();
    expect(phraseOf("")).toBeNull();
  });
});
