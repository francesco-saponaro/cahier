import Link from "next/link";
import { Fragment } from "react";
import type { Citation } from "@cahier/domain";

/*
 * The citation chips: every `[n]` in an answer becomes a link that opens the document viewer at
 * the cited span. The one hue of the product goes here and on the highlighted passage, nowhere
 * else. A citation whose document was removed keeps its quote and opens nothing.
 */

export function viewerHref(c: { documentId: string; startChar: number; endChar: number; documentVersion: number }): string {
  return `/documents/view?id=${encodeURIComponent(c.documentId)}&from=${c.startChar}&to=${c.endChar}&v=${c.documentVersion}`;
}

export function CitationChip({ citation }: { citation: Citation }) {
  if (!citation.documentId) {
    return (
      <span className="cite gone" title="The document was removed; the quote is kept.">
        [{citation.index}]
      </span>
    );
  }
  return (
    <Link className="cite" href={viewerHref({ ...citation, documentId: citation.documentId })} aria-label={`Citation ${citation.index}: ${citation.documentTitle}`} title={citation.quote}>
      [{citation.index}]
    </Link>
  );
}

const MARK = /\[(\d+)\]/g;

/** The answer's text with its `[n]` marks turned into chips, line by line. */
export function AnswerBody({ text, citations }: { text: string; citations: Citation[] }) {
  const byIndex = new Map(citations.map((c) => [c.index, c]));
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <p key={i}>{withChips(line, byIndex)}</p>
      ))}
    </>
  );
}

function withChips(line: string, byIndex: Map<number, Citation>) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(MARK)) {
    const citation = byIndex.get(Number(m[1]));
    if (!citation) continue;
    const start = m.index ?? 0;
    parts.push(line.slice(last, start).replace(/\s+$/, ""));
    parts.push(<CitationChip key={`${start}`} citation={citation} />);
    last = start + m[0].length;
  }
  parts.push(line.slice(last));
  return parts.map((p, i) => <Fragment key={i}>{p}</Fragment>);
}
