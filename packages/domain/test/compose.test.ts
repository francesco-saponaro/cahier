import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { extractiveAnswerer, REFUSALS } from "../src/grounding/compose.js";
import type { RetrievedChunk } from "../src/grounding/pack.js";
import { countTokens } from "../src/text/tokens.js";

const LEAVE = "## Paid leave\n\nEveryone earns 25 working days of paid leave a year. Days are earned at 2.08 per month worked and can be taken as soon as they are earned. Up to five days can be carried into the next period.";
const SICK = "## Sick leave\n\nTell your manager before 10:00 on the first day. Oriel tops up the social security payment to full salary from the first day for up to 90 days a year.";
const EXPENSES = "## Receipts\n\nKeep the receipt for anything over five euros.\n\n- Meals are capped at 25 euros a day.\n- Taxis need a reason on the claim.";

const chunk = (id: string, doc: string, body: string, score: number, offset = 0): RetrievedChunk => ({
  chunkId: id, documentId: doc, documentTitle: doc, documentVersion: 1, ordinal: 0, headingPath: [], startChar: offset, endChar: offset + body.length, tokenCount: countTokens(body), body, score,
});

const answerer = extractiveAnswerer();
const compose = (question: string, chunks: RetrievedChunk[]) => answerer.compose({ question, instructions: "Answer from the documents.", chunks });

describe("the extractive answerer", () => {
  test("quotes the sentences that cover the question's terms, one line each, ending in a citation", async () => {
    const result = await compose("How many days of paid leave do I earn?", [chunk("c1", "Leave", LEAVE, 0.9), chunk("c2", "Sick", SICK, 0.4)]);
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") return;
    const paragraph = LEAVE.slice(LEAVE.indexOf("Everyone"));
    expect(result.text.split("\n")[0]).toBe(`${paragraph} [1]`);
    expect(result.citations[0]).toMatchObject({ index: 1, chunkId: "c1", documentId: "Leave", startChar: LEAVE.indexOf("Everyone"), endChar: LEAVE.length, quote: paragraph });
  });

  test("a citation's quote is the document's text at its span", async () => {
    const result = await compose("What is the rule on sick leave and salary?", [chunk("c1", "Leave", LEAVE, 0.5, 1000), chunk("c2", "Sick", SICK, 0.9, 2000)]);
    if (result.kind !== "answer") throw new Error(result.kind);
    for (const c of result.citations) {
      const source = c.chunkId === "c1" ? { body: LEAVE, offset: 1000 } : { body: SICK, offset: 2000 };
      expect(source.body.slice(c.startChar - source.offset, c.endChar - source.offset)).toBe(c.quote);
      expect(result.text).toContain(`${c.quote} [${c.index}]`);
    }
  });

  test("never quotes a heading line, and a list item is quoted without its marker", async () => {
    const result = await compose("What are meals capped at and do taxis need a reason?", [chunk("c1", "Expenses", EXPENSES, 0.9)]);
    if (result.kind !== "answer") throw new Error(result.kind);
    const lines = result.text.split("\n").map((l) => l.replace(/ \[\d+\]$/, ""));
    expect(lines).toEqual(["Meals are capped at 25 euros a day.", "Taxis need a reason on the claim."]);
    expect(result.citations.map((c) => c.quote)).toEqual(lines);
  });

  test("refuses with no_sources when no sentence covers a term of the question", async () => {
    expect(await compose("Where is the parking?", [chunk("c1", "Leave", LEAVE, 0.9)])).toEqual({ kind: "no_sources" });
    expect(await compose("Is it?", [chunk("c1", "Leave", LEAVE, 0.9)])).toEqual({ kind: "no_sources" });
    expect(await compose("Anything?", [])).toEqual({ kind: "no_sources" });
  });

  test("stops at the answer budget, keeping the sentences that cover the most terms", async () => {
    const small = extractiveAnswerer({ answerTokens: 25 });
    const result = await small.compose({ question: "How are days earned and carried into the next period?", instructions: "", chunks: [chunk("c1", "Leave", LEAVE, 0.9)] });
    if (result.kind !== "answer") throw new Error(result.kind);
    expect(countTokens(result.text)).toBeLessThanOrEqual(25 + 3);
    // "carried" and "period" and "days" are three terms; the sentence covering them wins over the one covering two.
    expect(result.text).toBe("Up to five days can be carried into the next period. [1]");
  });

  test("orders the lines by document rank then position, and numbers citations in that order", async () => {
    const result = await compose("Who do I tell on the first day of sick leave, and how are days of leave earned?", [chunk("c1", "Leave", LEAVE, 0.6), chunk("c2", "Sick", SICK, 0.9)]);
    if (result.kind !== "answer") throw new Error(result.kind);
    const docs = result.citations.map((c) => c.documentId);
    expect(docs.indexOf("Sick")).toBeLessThan(docs.indexOf("Leave"));
    expect(result.citations.map((c) => c.index)).toEqual(result.citations.map((_, i) => i + 1));
  });

  test("the same question over the same chunks gives the same answer", async () => {
    const chunks = [chunk("c1", "Leave", LEAVE, 0.9), chunk("c2", "Sick", SICK, 0.4), chunk("c3", "Expenses", EXPENSES, 0.5)];
    const a = await compose("What should I know about days and receipts?", chunks);
    const b = await compose("What should I know about days and receipts?", [...chunks].reverse());
    expect(a).toEqual(b);
  });

  test("the refusal texts cover every reason", () => {
    expect(Object.keys(REFUSALS).sort()).toEqual(["budget_exhausted", "no_price", "no_sources", "rate_limited", "tool_off"]);
  });

  const word = fc.constantFrom("leave", "days", "salary", "manager", "receipt", "taxi", "hub", "badge", "earned", "carried", "period", "the", "a", "of");
  const sentence = fc.array(word, { minLength: 1, maxLength: 8 }).map((ws) => `${ws.join(" ")}.`);
  const body = fc.array(sentence, { minLength: 1, maxLength: 6 }).map((ss) => ss.join(" "));

  test("every line is a substring of a packed chunk and every citation resolves to its span", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(body, { minLength: 1, maxLength: 4 }), fc.array(word, { minLength: 1, maxLength: 4 }), async (bodies, qs) => {
        const chunks = bodies.map((b, i) => chunk(`c${i}`, `d${i % 2}`, b, 1 - i / 10, i * 10_000));
        const result = await compose(qs.join(" "), chunks);
        if (result.kind !== "answer") return;
        expect(result.citations.length).toBeGreaterThan(0);
        for (const line of result.text.split("\n")) {
          const m = /^(.*) \[(\d+)\]$/.exec(line)!;
          expect(m).not.toBeNull();
          const citation = result.citations.find((c) => c.index === Number(m[2]))!;
          expect(citation.quote).toBe(m[1]);
          const source = chunks.find((c) => c.chunkId === citation.chunkId)!;
          expect(source.body.slice(citation.startChar - source.startChar, citation.endChar - source.startChar)).toBe(citation.quote);
        }
      }),
    );
  });
});
