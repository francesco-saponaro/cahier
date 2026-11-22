import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { chunkText } from "../src/text/chunk.js";
import { countTokens } from "../src/text/tokens.js";
import { splitSentences } from "../src/text/sentences.js";

const sentence = (i: number) => `Sentence number ${i} says something plain about the policy.`;
const paragraph = (from: number, n: number) => Array.from({ length: n }, (_, i) => sentence(from + i)).join(" ");
const S = countTokens(sentence(1)); // the tokens of one sentence (12 with the six-character rule)

describe("chunkText", () => {
  test("a short document is one chunk whose body is its trimmed text", () => {
    const text = "\n\nOne paragraph. Two sentences.\n";
    const chunks = chunkText(text, { budget: 320, overlap: 40 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ ordinal: 0, start: 2, end: 31, body: "One paragraph. Two sentences." });
    expect(chunks[0]!.tokens).toBe(countTokens("One paragraph. Two sentences."));
  });

  test("paragraphs are appended while the chunk stays under the budget", () => {
    // Three paragraphs of two sentences, 2S tokens each; the budget holds two of them.
    const text = [paragraph(1, 2), paragraph(3, 2), paragraph(5, 2)].join("\n\n");
    const chunks = chunkText(text, { budget: 4 * S + 1, overlap: 0 });
    expect(chunks.map((c) => c.body)).toEqual([`${paragraph(1, 2)}\n\n${paragraph(3, 2)}`, paragraph(5, 2)]);
  });

  test("a paragraph longer than the budget is split at sentence ends", () => {
    const text = paragraph(1, 6); // 6S tokens
    const chunks = chunkText(text, { budget: 2 * S + 1, overlap: 0 });
    expect(chunks.map((c) => c.body)).toEqual([paragraph(1, 2), paragraph(3, 2), paragraph(5, 2)]);
  });

  test("the next chunk starts with the tail of the previous one, up to the overlap", () => {
    const text = paragraph(1, 6);
    const chunks = chunkText(text, { budget: 3 * S, overlap: S });
    // 3S tokens hold three sentences; the overlap of one sentence (S tokens) is repeated.
    expect(chunks.map((c) => c.body)).toEqual([paragraph(1, 3), paragraph(3, 3), paragraph(5, 2)]);
  });

  test("a single sentence over the budget becomes a chunk of its own", () => {
    const long = `${Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ")}.`;
    const text = `Short. ${long} Short again.`;
    const chunks = chunkText(text, { budget: 20, overlap: 5 });
    expect(chunks.map((c) => c.body)).toEqual(["Short.", long, "Short again."]);
  });

  test("every chunk's body is the document's text at its span", () => {
    fc.assert(
      fc.property(fc.string({ size: "large" }), fc.integer({ min: 4, max: 60 }), (text, budget) => {
        const chunks = chunkText(text, { budget, overlap: Math.floor(budget / 4) });
        for (const c of chunks) {
          expect(text.slice(c.start, c.end)).toBe(c.body);
          expect(c.body).toBe(c.body.trim());
          expect(c.tokens).toBe(countTokens(c.body));
        }
      }),
    );
  });

  test("chunks are in order, their ordinals count from zero and they cover every non-space character", () => {
    fc.assert(
      fc.property(fc.string({ size: "large" }), fc.integer({ min: 4, max: 60 }), (text, budget) => {
        const chunks = chunkText(text, { budget, overlap: Math.floor(budget / 4) });
        const covered = new Array<boolean>(text.length).fill(false);
        chunks.forEach((c, i) => {
          expect(c.ordinal).toBe(i);
          if (i > 0) expect(c.start).toBeGreaterThan(chunks[i - 1]!.start);
          for (let k = c.start; k < c.end; k++) covered[k] = true;
        });
        for (let k = 0; k < text.length; k++) {
          if (!/\s/u.test(text[k]!)) expect(covered[k]).toBe(true);
        }
      }),
    );
  });

  test("no chunk exceeds the budget unless one sentence does", () => {
    fc.assert(
      fc.property(fc.string({ size: "large" }), fc.integer({ min: 4, max: 60 }), (text, budget) => {
        for (const c of chunkText(text, { budget, overlap: Math.floor(budget / 4) })) {
          // Then the chunk is one sentence: splitting it again gives one unit.
          if (c.tokens > budget) expect(splitSentences(c.body)).toHaveLength(1);
        }
      }),
    );
  });

  test("chunking is deterministic", () => {
    const text = paragraph(1, 20);
    expect(chunkText(text, { budget: 50, overlap: 10 })).toEqual(chunkText(text, { budget: 50, overlap: 10 }));
  });
});

describe("chunkText with headings", () => {
  const doc = ["# Leave", "", paragraph(1, 2), "", "## Sick leave", "", paragraph(3, 2), "", "## Family leave", "", paragraph(5, 2), ""].join("\n");

  test("a heading opens a new chunk instead of ending the previous one", () => {
    // Without headings, 4S + 2 tokens would hold two paragraphs; the heading cuts before the second.
    const chunks = chunkText(doc, { budget: 4 * S + 6, overlap: S });
    expect(chunks.map((c) => c.body.split("\n")[0])).toEqual(["# Leave", "## Sick leave", "## Family leave"]);
  });

  test("the heading path is the headings above the chunk, outermost first", () => {
    const chunks = chunkText(doc, { budget: 4 * S + 6, overlap: S });
    expect(chunks.map((c) => c.headingPath)).toEqual([["Leave"], ["Leave", "Sick leave"], ["Leave", "Family leave"]]);
  });

  test("a deeper heading extends the path and a shallower one cuts it back", () => {
    const text = "# A\n\nOne.\n\n## B\n\nTwo.\n\n### C\n\nThree.\n\n## D\n\nFour.\n\n# E\n\nFive.";
    const chunks = chunkText(text, { budget: 8, overlap: 0 });
    expect(chunks.map((c) => c.headingPath)).toEqual([["A"], ["A", "B"], ["A", "B", "C"], ["A", "D"], ["E"]]);
  });

  test("a chunk split inside a section keeps the section's path", () => {
    const text = `## Rules\n\n${paragraph(1, 6)}`;
    const chunks = chunkText(text, { budget: 2 * S + 2, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.headingPath).toEqual(["Rules"]);
  });

  test("headings with nothing between them share one chunk", () => {
    const text = "# Title\n\n## Sub\n\nThe only paragraph.";
    const chunks = chunkText(text, { budget: 320, overlap: 40 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ body: text, headingPath: ["Title", "Sub"] });
  });

  test("a heading line inside a paragraph still counts as a heading", () => {
    const text = "Intro line.\n## Next\nBody line.";
    const chunks = chunkText(text, { budget: 320, overlap: 40 });
    expect(chunks.map((c) => c.body)).toEqual(["Intro line.", "## Next\nBody line."]);
    expect(chunks.map((c) => c.headingPath)).toEqual([[], ["Next"]]);
  });

  test("no overlap is carried across a heading, so a heading never ends a chunk", () => {
    const chunks = chunkText(doc, { budget: 4 * S + 6, overlap: 2 * S });
    for (const c of chunks) expect(c.body.split("\n").pop()).not.toMatch(/^#/);
  });

  test("the span invariant and the coverage hold on documents with headings", () => {
    const line = fc.oneof(fc.string({ minLength: 1, maxLength: 40 }), fc.constantFrom("# A", "## B", "### C", "#### D", "#not a heading", "# ", "Plain sentence."));
    const document = fc.array(line, { maxLength: 30 }).map((lines) => lines.join("\n"));
    fc.assert(
      fc.property(document, fc.integer({ min: 4, max: 60 }), (text, budget) => {
        const chunks = chunkText(text, { budget, overlap: Math.floor(budget / 4) });
        const covered = new Array<boolean>(text.length).fill(false);
        chunks.forEach((c, i) => {
          expect(text.slice(c.start, c.end)).toBe(c.body);
          expect(c.ordinal).toBe(i);
          if (i > 0) expect(c.start).toBeGreaterThan(chunks[i - 1]!.start);
          for (let k = c.start; k < c.end; k++) covered[k] = true;
          // The path is what the headings above the chunk's first line of text say (its own leading headings included).
          expect(c.headingPath).toEqual(headingPathAt(text, firstTextOffset(c)));
        });
        for (let k = 0; k < text.length; k++) if (!/\s/u.test(text[k]!)) expect(covered[k]).toBe(true);
      }),
    );
  });
});

/** Where the chunk's first non-heading line starts, or its end when it is headings only. */
function firstTextOffset(c: { start: number; end: number; body: string }): number {
  let offset = c.start;
  for (const line of c.body.split("\n")) {
    if (!/^#{1,6}[ \t]+\S/u.test(line)) return offset;
    offset += line.length + 1;
  }
  return c.end;
}

/** The heading path in force at `offset`, computed the slow way: every heading line that starts before it. */
function headingPathAt(text: string, offset: number): string[] {
  const path: string[] = [];
  let lineStart = 0;
  for (const line of text.split("\n")) {
    if (lineStart >= offset) break;
    const m = /^(#{1,6})[ \t]+(\S.*)$/u.exec(line);
    if (m) {
      const level = m[1]!.length;
      path.splice(level - 1);
      path.push(m[2]!.trim());
    }
    lineStart += line.length + 1;
  }
  return path;
}
