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
