import { splitSentences, type Span } from "./sentences.js";
import { countTokens } from "./tokens.js";

/**
 * A chunk is a contiguous span of a document small enough to be retrieved and packed into a
 * context. Chunks follow the text: a paragraph that fits the budget is kept whole, a longer one
 * is split at sentence ends, and the next chunk repeats the tail of the previous one (up to the
 * overlap) so a sentence cut at a boundary is still found whole. `document.slice(start, end)`
 * is always exactly `body`, which is what lets a citation point back to the page.
 */
export interface TextChunk {
  ordinal: number;
  start: number;
  end: number;
  body: string;
  tokens: number;
  /** The Markdown headings above the chunk, outermost first. Empty until the heading-aware pass. */
  headingPath: string[];
}

export interface ChunkOptions {
  /** The most tokens a chunk may hold, unless a single sentence holds more. */
  budget: number;
  /** The most tokens of the previous chunk's tail to repeat at the head of the next. */
  overlap: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { budget: 320, overlap: 40 };

interface Unit extends Span {
  tokens: number;
  carried: boolean;
}

const BLANK_LINE = /\n[ \t]*\n/gu;

/** Paragraph spans: the text between blank lines, trimmed. */
function paragraphs(text: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  BLANK_LINE.lastIndex = 0;
  for (const m of text.matchAll(BLANK_LINE)) {
    spans.push({ start, end: m.index });
    start = m.index + m[0].length;
  }
  spans.push({ start, end: text.length });
  return spans.flatMap((s) => {
    const t = trim(text, s);
    return t ? [t] : [];
  });
}

function trim(text: string, span: Span): Span | null {
  let { start, end } = span;
  while (start < end && /\s/u.test(text[start]!)) start++;
  while (end > start && /\s/u.test(text[end - 1]!)) end--;
  return end > start ? { start, end } : null;
}

/** The units the chunker packs: whole paragraphs when they fit, their sentences otherwise. */
function units(text: string, budget: number): Unit[] {
  const out: Unit[] = [];
  for (const p of paragraphs(text)) {
    const tokens = countTokens(text.slice(p.start, p.end));
    if (tokens <= budget) {
      out.push({ ...p, tokens, carried: false });
      continue;
    }
    for (const s of splitSentences(text.slice(p.start, p.end))) {
      const start = p.start + s.start;
      const end = p.start + s.end;
      out.push({ start, end, tokens: countTokens(text.slice(start, end)), carried: false });
    }
  }
  return out;
}

export function chunkText(text: string, options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): TextChunk[] {
  const { budget, overlap } = options;
  const chunks: TextChunk[] = [];
  let current: Unit[] = [];
  let currentTokens = 0;

  const emit = (parts: Unit[]) => {
    if (parts.length === 0 || parts.every((u) => u.carried)) return;
    const start = parts[0]!.start;
    const end = parts[parts.length - 1]!.end;
    const body = text.slice(start, end);
    chunks.push({ ordinal: chunks.length, start, end, body, tokens: countTokens(body), headingPath: [] });
  };

  /** The trailing units of `parts` whose tokens fit in the overlap and leave room for `next`. */
  const tail = (parts: Unit[], next: Unit): Unit[] => {
    const kept: Unit[] = [];
    let tokens = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const u = parts[i]!;
      if (tokens + u.tokens > overlap || tokens + u.tokens + next.tokens > budget) break;
      kept.unshift({ ...u, carried: true });
      tokens += u.tokens;
    }
    return kept;
  };

  for (const unit of units(text, budget)) {
    if (unit.tokens > budget) {
      emit(current);
      emit([unit]);
      current = [];
      currentTokens = 0;
      continue;
    }
    if (currentTokens + unit.tokens > budget) {
      emit(current);
      current = tail(current, unit);
      currentTokens = current.reduce((n, u) => n + u.tokens, 0);
    }
    current.push(unit);
    currentTokens += unit.tokens;
  }
  emit(current);
  return chunks;
}
