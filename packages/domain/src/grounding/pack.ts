/*
 * Packing: which of the retrieved chunks go into the context, under a token budget. The budget is
 * the agent version's context minus the question and an answer reserve. Candidates are taken by
 * score, but no document may crowd the others out: the best chunk of each document in the top
 * five goes first, then up to three chunks per document, then whatever still fits. A chunk whose
 * span lies inside one already packed from the same document adds nothing and is dropped. The
 * answer is sorted by score with a fixed tie-break, so the same candidates always pack the same.
 */

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentVersion: number;
  ordinal: number;
  headingPath: string[];
  startChar: number;
  endChar: number;
  tokenCount: number;
  body: string;
  /** Higher is better; the retrieval's rank plus any phrase bonus. */
  score: number;
}

export interface PackOptions {
  budget: number;
  /** Chunks a document may take before the others have had their turn; 3 by default. */
  perDocument?: number;
  /** How many of the best candidates have their document's best chunk reserved first; 5 by default. */
  spread?: number;
}

/** Score descending, then document id, then ordinal: the one order every step here uses. */
export function byRank(a: RetrievedChunk, b: RetrievedChunk): number {
  return b.score - a.score || (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0) || a.ordinal - b.ordinal;
}

const nested = (inner: RetrievedChunk, outer: RetrievedChunk) =>
  inner.documentId === outer.documentId && outer.startChar <= inner.startChar && inner.endChar <= outer.endChar;

export function packContext(candidates: readonly RetrievedChunk[], options: PackOptions): RetrievedChunk[] {
  const { budget, perDocument = 3, spread = 5 } = options;
  const ranked = [...candidates].sort(byRank);
  const packed: RetrievedChunk[] = [];
  const perDoc = new Map<string, number>();
  let used = 0;

  const take = (c: RetrievedChunk): boolean => {
    if (packed.includes(c) || used + c.tokenCount > budget) return false;
    if (packed.some((p) => nested(c, p) || nested(p, c))) return false;
    packed.push(c);
    perDoc.set(c.documentId, (perDoc.get(c.documentId) ?? 0) + 1);
    used += c.tokenCount;
    return true;
  };

  // First the best chunk of each document among the top candidates, so a second source is never crowded out.
  const seen = new Set<string>();
  for (const c of ranked.slice(0, spread)) {
    if (seen.has(c.documentId)) continue;
    seen.add(c.documentId);
    take(c);
  }
  // Then by score with a cap per document.
  for (const c of ranked) {
    if ((perDoc.get(c.documentId) ?? 0) >= perDocument) continue;
    take(c);
  }
  // Then whatever still fits.
  for (const c of ranked) take(c);

  return packed.sort(byRank);
}
