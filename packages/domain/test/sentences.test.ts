import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { splitSentences } from "../src/text/sentences.js";

describe("splitSentences", () => {
  test("splits at sentence ends and keeps the spans", () => {
    const text = "First one. Second one! Third?";
    const units = splitSentences(text);
    expect(units.map((u) => text.slice(u.start, u.end))).toEqual(["First one.", "Second one!", "Third?"]);
    expect(units.map((u) => u.start)).toEqual([0, 11, 23]);
  });

  test("a line break ends a unit, so list items stay apart", () => {
    const text = "- apples\n- pears and plums\nTail";
    expect(splitSentences(text).map((u) => text.slice(u.start, u.end))).toEqual(["- apples", "- pears and plums", "Tail"]);
  });

  test("a closing quote or bracket after the full stop belongs to the sentence", () => {
    const text = 'He said "no." Then left (quietly). Done';
    expect(splitSentences(text).map((u) => text.slice(u.start, u.end))).toEqual(['He said "no."', "Then left (quietly).", "Done"]);
  });

  test("a dot inside a number or an abbreviation does not split", () => {
    const text = "Version 3.5 shipped on 4 Nov. 2026 to e.g. the EU team. Fine.";
    expect(splitSentences(text).map((u) => text.slice(u.start, u.end))).toEqual([
      "Version 3.5 shipped on 4 Nov. 2026 to e.g. the EU team.",
      "Fine.",
    ]);
  });

  test("units are in order, never overlap, and together hold every non-space character", () => {
    fc.assert(
      fc.property(fc.string({ size: "medium" }), (text) => {
        const units = splitSentences(text);
        let last = 0;
        let covered = "";
        for (const u of units) {
          expect(u.start).toBeGreaterThanOrEqual(last);
          expect(u.end).toBeGreaterThan(u.start);
          covered += text.slice(u.start, u.end);
          last = u.end;
        }
        expect(covered.replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
        for (const u of units) {
          const body = text.slice(u.start, u.end);
          expect(body).toBe(body.trim());
        }
      }),
    );
  });
});
