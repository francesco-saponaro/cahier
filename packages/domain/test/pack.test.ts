import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { packContext, type RetrievedChunk } from "../src/grounding/pack.js";

const chunk = (id: string, doc: string, ordinal: number, tokens: number, score: number, span: [number, number] = [ordinal * 100, ordinal * 100 + 90]): RetrievedChunk => ({
  chunkId: id, documentId: doc, documentTitle: doc, documentVersion: 1, ordinal, headingPath: [], startChar: span[0], endChar: span[1], tokenCount: tokens, body: "x".repeat(span[1] - span[0]), score,
});

describe("packContext", () => {
  test("takes candidates by score until the budget is spent", () => {
    const packed = packContext([chunk("a", "d1", 0, 100, 0.9), chunk("b", "d2", 0, 100, 0.8), chunk("c", "d3", 0, 100, 0.7)], { budget: 250 });
    expect(packed.map((c) => c.chunkId)).toEqual(["a", "b"]);
  });

  test("a candidate too big for what is left is skipped and a smaller one after it still fits", () => {
    const packed = packContext([chunk("a", "d1", 0, 100, 0.9), chunk("b", "d2", 0, 200, 0.8), chunk("c", "d3", 0, 50, 0.7)], { budget: 160 });
    expect(packed.map((c) => c.chunkId)).toEqual(["a", "c"]);
  });

  test("holds a document to three chunks while others wait, then fills the room with the rest", () => {
    const candidates = [
      chunk("a1", "A", 0, 10, 0.9), chunk("a2", "A", 1, 10, 0.89), chunk("a3", "A", 2, 10, 0.88), chunk("a4", "A", 3, 10, 0.87), chunk("a5", "A", 4, 10, 0.86),
      chunk("b1", "B", 0, 10, 0.5),
    ];
    // Room for five: three of A, then B, then the fourth of A.
    expect(packContext(candidates, { budget: 50 }).map((c) => c.chunkId)).toEqual(["a1", "a2", "a3", "a4", "b1"]);
    // Room for four: three of A, B.
    expect(packContext(candidates, { budget: 40 }).map((c) => c.chunkId)).toEqual(["a1", "a2", "a3", "b1"]);
  });

  test("a second document's best chunk is not crowded out by the first document's top three", () => {
    const candidates = [chunk("a1", "A", 0, 100, 0.9), chunk("a2", "A", 1, 100, 0.89), chunk("a3", "A", 2, 100, 0.88), chunk("b1", "B", 0, 100, 0.5)];
    expect(packContext(candidates, { budget: 300 }).map((c) => c.chunkId)).toEqual(["a1", "a2", "b1"]);
  });

  test("drops a chunk whose span sits inside one already packed from the same document", () => {
    const packed = packContext([chunk("big", "d", 0, 100, 0.9, [0, 500]), chunk("inner", "d", 1, 20, 0.85, [100, 200]), chunk("tail", "d", 2, 30, 0.8, [480, 700])], { budget: 1000 });
    expect(packed.map((c) => c.chunkId)).toEqual(["big", "tail"]);
  });

  test("answers the packed chunks by score, ties broken by document and ordinal, whatever the input order", () => {
    const candidates = [chunk("b", "d2", 0, 10, 0.5), chunk("a", "d1", 1, 10, 0.5), chunk("c", "d1", 0, 10, 0.5), chunk("z", "d0", 0, 10, 0.7)];
    expect(packContext(candidates, { budget: 100 }).map((c) => c.chunkId)).toEqual(["z", "c", "a", "b"]);
    expect(packContext([...candidates].reverse(), { budget: 100 }).map((c) => c.chunkId)).toEqual(["z", "c", "a", "b"]);
  });

  test("an empty candidate list or a budget of nothing packs nothing", () => {
    expect(packContext([], { budget: 100 })).toEqual([]);
    expect(packContext([chunk("a", "d", 0, 10, 1)], { budget: 0 })).toEqual([]);
  });

  const arbitrary = fc
    .array(
      fc.record({
        doc: fc.integer({ min: 0, max: 4 }),
        ordinal: fc.integer({ min: 0, max: 9 }),
        tokens: fc.integer({ min: 1, max: 120 }),
        score: fc.float({ min: 0, max: 1, noNaN: true }),
        length: fc.integer({ min: 1, max: 60 }),
      }),
      { maxLength: 30 },
    )
    .map((rows) => {
      // One chunk per (document, ordinal), consecutive spans with the chunker's small overlap.
      const seen = new Set<string>();
      return rows
        .filter((r) => {
          const k = `${r.doc}:${r.ordinal}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .map((r) => chunk(`c${r.doc}_${r.ordinal}`, `d${r.doc}`, r.ordinal, r.tokens, r.score, [r.ordinal * 50, r.ordinal * 50 + 50 + Math.min(r.length, 20)]));
    });

  test("never exceeds the budget, keeps candidates once, and never packs two nested spans of one document", () => {
    fc.assert(
      fc.property(arbitrary, fc.integer({ min: 0, max: 600 }), (candidates, budget) => {
        const packed = packContext(candidates, { budget });
        expect(packed.reduce((n, c) => n + c.tokenCount, 0)).toBeLessThanOrEqual(budget);
        expect(new Set(packed.map((c) => c.chunkId)).size).toBe(packed.length);
        for (const a of packed) {
          expect(candidates).toContainEqual(a);
          for (const b of packed) {
            if (a === b || a.documentId !== b.documentId) continue;
            expect(a.startChar <= b.startChar && b.endChar <= a.endChar).toBe(false);
          }
        }
        for (let i = 1; i < packed.length; i++) {
          const [p, q] = [packed[i - 1]!, packed[i]!];
          expect(p.score > q.score || (p.score === q.score && (p.documentId < q.documentId || (p.documentId === q.documentId && p.ordinal < q.ordinal)))).toBe(true);
        }
      }),
    );
  });

  test("reaches a second document when two distinct documents are in the top five and both fit", () => {
    fc.assert(
      fc.property(arbitrary, fc.integer({ min: 0, max: 600 }), (candidates, budget) => {
        const packed = packContext(candidates, { budget });
        const top = [...candidates].sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId) || a.ordinal - b.ordinal).slice(0, 5);
        const docs = [...new Set(top.map((c) => c.documentId))];
        if (docs.length < 2) return;
        const [first, second] = docs.map((d) => top.find((c) => c.documentId === d)!);
        if (first!.tokenCount + second!.tokenCount > budget) return;
        expect(new Set(packed.map((c) => c.documentId)).size).toBeGreaterThanOrEqual(2);
      }),
    );
  });
});
