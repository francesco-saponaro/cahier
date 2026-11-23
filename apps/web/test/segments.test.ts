import { describe, expect, test } from "vitest";
import { segmentsOf } from "../src/screens/documents/segments";

/*
 * The viewer renders the page as segments cut at every chunk start and at the cited span, so a
 * chunk's first character can carry its ordinal in the margin and the span can be one `mark`.
 */

const body = "# Leave\n\nEveryone earns 25 days. Days are earned monthly.\n\n## Sick leave\n\nTell your manager.";
const chunks = [
  { ordinal: 0, startChar: 0, endChar: 55 },
  { ordinal: 1, startChar: 40, endChar: 55 },
  { ordinal: 2, startChar: 57, endChar: body.length },
];

describe("segmentsOf", () => {
  test("cuts at every chunk start and at the span, and the pieces rebuild the page", () => {
    const segments = segmentsOf(body, chunks, { from: 9, to: 32 });
    expect(segments.map((s) => s.text).join("")).toBe(body);
    expect(segments.map((s) => [s.start, s.end, s.chunkStarts, s.highlighted])).toEqual([
      [0, 9, [0], false],
      [9, 32, [], true],
      [32, 40, [], false],
      [40, 57, [1], false],
      [57, body.length, [2], false],
    ]);
  });

  test("with no span nothing is highlighted; a span outside the page is ignored; two chunks may start together", () => {
    expect(segmentsOf(body, chunks, null).every((s) => !s.highlighted)).toBe(true);
    expect(segmentsOf(body, chunks, { from: 500, to: 600 }).every((s) => !s.highlighted)).toBe(true);
    const twice = segmentsOf("abc", [{ ordinal: 0, startChar: 0, endChar: 3 }, { ordinal: 1, startChar: 0, endChar: 3 }], null);
    expect(twice).toEqual([{ start: 0, end: 3, text: "abc", chunkStarts: [0, 1], highlighted: false }]);
  });
});
