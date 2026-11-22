import type { RefusedReason } from "../entities.js";
import { splitSentences } from "../text/sentences.js";
import { countTokens, tokenize } from "../text/tokens.js";
import { byRank, type RetrievedChunk } from "./pack.js";
import { queryTerms, stem } from "./terms.js";

/*
 * Composition: the answer, built from the packed chunks. It sits behind the `Answerer` port
 * because a real model would go there: given the question, the instructions and the passages,
 * answer with text whose every line ends in a citation. The adapter here is extractive and
 * deterministic: it quotes the sentences that cover the most terms of the question (and none
 * covering less than half of what the best one does), in reading order, each as one line with
 * its `[n]`, and every citation is a span of the document whose
 * quote is exactly `document.slice(start, end)`. Nothing is paraphrased, so nothing is invented.
 */

export interface ComposeRequest {
  question: string;
  instructions: string;
  /** The packed context, best first. */
  chunks: readonly RetrievedChunk[];
}

export interface CitationDraft {
  /** The `[n]` in the text, from 1. */
  index: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentVersion: number;
  startChar: number;
  endChar: number;
  quote: string;
}

export type Composition = { kind: "answer"; text: string; citations: CitationDraft[] } | { kind: "no_sources" };

/** Where a real model client would go. The input is everything the model would see; the output is text with its citations. */
export interface Answerer {
  compose(request: ComposeRequest): Promise<Composition>;
}

export const REFUSALS: Record<RefusedReason, string> = {
  budget_exhausted: "The workspace has used its token budget for the month. An admin can raise it in Settings.",
  rate_limited: "You have sent many questions in the last minute. Wait a moment and try again.",
  tool_off: "Grounded answers are switched off in this workspace. An admin can switch them on in Settings.",
  no_sources: "I could not find anything in the libraries this agent reads about that. Try other words, or add the document to a library.",
  no_price: "This agent's model has no price in force, so it cannot answer until an admin sets one.",
};

export interface ExtractiveOptions {
  /** The most tokens the answer may hold; a single sentence may exceed it. 120 by default. */
  answerTokens?: number;
}

const HEADING = /^#{1,6}[ \t]+\S/u;
const LIST_MARKER = /^(?:[-*+]|\d+[.)])[ \t]+/u;

/** A stem covers a term when they are equal, or one is a prefix of the other and both have four letters or more. */
function covers(wordStem: string, term: string): boolean {
  if (wordStem === term) return true;
  if (wordStem.length < 4 || term.length < 4) return false;
  return wordStem.startsWith(term) || term.startsWith(wordStem);
}

interface Candidate {
  chunk: RetrievedChunk;
  rank: number;
  sentenceIndex: number;
  /** Offsets into the chunk's body. */
  start: number;
  end: number;
  covered: number;
  tokens: number;
}

export function extractiveAnswerer(options: ExtractiveOptions = {}): Answerer {
  const answerTokens = options.answerTokens ?? 120;
  return {
    async compose({ question, chunks }) {
      const terms = queryTerms(question);
      if (terms.length === 0 || chunks.length === 0) return { kind: "no_sources" };

      const ranked = [...chunks].sort(byRank);
      const candidates: Candidate[] = [];
      ranked.forEach((chunk, rank) => {
        splitSentences(chunk.body).forEach((span, sentenceIndex) => {
          let text = chunk.body.slice(span.start, span.end);
          if (HEADING.test(text)) return;
          const marker = LIST_MARKER.exec(text);
          const start = span.start + (marker ? marker[0].length : 0);
          text = chunk.body.slice(start, span.end);
          if (text.length === 0) return;
          const stems = new Set(tokenize(text).filter((p) => /^[\p{L}\p{N}]/u.test(p)).map((w) => stem(w)));
          const covered = terms.filter((t) => [...stems].some((s) => covers(s, t))).length;
          if (covered === 0) return;
          candidates.push({ chunk, rank, sentenceIndex, start, end: span.end, covered, tokens: countTokens(text) });
        });
      });
      if (candidates.length === 0) return { kind: "no_sources" };

      // Greedy by terms covered, then by the chunk's rank, then by position, until the answer budget is spent.
      // A sentence covering less than half of what the best one covers is padding, not an answer.
      candidates.sort((a, b) => b.covered - a.covered || a.rank - b.rank || a.start - b.start);
      const threshold = Math.max(1, Math.ceil(candidates[0]!.covered / 2));
      const chosen: Candidate[] = [];
      let used = 0;
      for (const c of candidates) {
        if (c.covered < threshold) break;
        if (chosen.length > 0 && used + c.tokens > answerTokens) continue;
        chosen.push(c);
        used += c.tokens;
      }

      // Reading order: documents in the order of their best chunk, then chunk rank, then position.
      const documentOrder = new Map<string, number>();
      ranked.forEach((c) => {
        if (!documentOrder.has(c.documentId)) documentOrder.set(c.documentId, documentOrder.size);
      });
      chosen.sort((a, b) => documentOrder.get(a.chunk.documentId)! - documentOrder.get(b.chunk.documentId)! || a.rank - b.rank || a.start - b.start);

      // Consecutive sentences of one paragraph become one line, so the quote stays a single span of the page.
      const lines: { chunk: RetrievedChunk; start: number; end: number }[] = [];
      chosen.forEach((c, i) => {
        const last = lines[lines.length - 1];
        const previous = chosen[i - 1];
        const adjacent = last && previous && last.chunk === c.chunk && previous.chunk === c.chunk && previous.sentenceIndex + 1 === c.sentenceIndex && !c.chunk.body.slice(last.end, c.start).includes("\n");
        if (adjacent) last.end = c.end;
        else lines.push({ chunk: c.chunk, start: c.start, end: c.end });
      });

      const citations: CitationDraft[] = lines.map((l, i) => ({
        index: i + 1,
        chunkId: l.chunk.chunkId,
        documentId: l.chunk.documentId,
        documentTitle: l.chunk.documentTitle,
        documentVersion: l.chunk.documentVersion,
        startChar: l.chunk.startChar + l.start,
        endChar: l.chunk.startChar + l.end,
        quote: l.chunk.body.slice(l.start, l.end),
      }));
      return { kind: "answer", text: citations.map((c) => `${c.quote} [${c.index}]`).join("\n"), citations };
    },
  };
}
