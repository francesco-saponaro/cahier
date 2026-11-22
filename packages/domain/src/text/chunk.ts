import { splitSentences, type Span } from "./sentences.js";
import { countTokens } from "./tokens.js";

/**
 * A chunk is a contiguous span of a document small enough to be retrieved and packed into a
 * context. Chunks follow the text: a Markdown heading opens a new chunk and sets the heading path,
 * a paragraph that fits the budget is kept whole, a longer one is split at sentence ends, and the
 * next chunk repeats the tail of the previous one (up to the overlap) so a sentence cut at a
 * boundary is still found whole. `document.slice(start, end)` is always exactly `body`, which is
 * what lets a citation point back to the page.
 */
export interface TextChunk {
  ordinal: number;
  start: number;
  end: number;
  body: string;
  tokens: number;
  /** The Markdown headings above the chunk (the one that opens it included), outermost first. */
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
  /** Set on a heading line: its depth, 1 to 6, and its text. */
  heading: { level: number; text: string } | null;
}

/** An ATX heading: one to six `#`, whitespace, then text. `#tag` and a bare `#` are not headings. */
const HEADING = /^(#{1,6})[ \t]+(\S.*)$/u;

function trim(text: string, span: Span): Span | null {
  let { start, end } = span;
  while (start < end && /\s/u.test(text[start]!)) start++;
  while (end > start && /\s/u.test(text[end - 1]!)) end--;
  return end > start ? { start, end } : null;
}

/** Blocks: heading lines on their own, and the runs of other lines between blank lines, trimmed. */
function blocks(text: string): (Span & { heading: Unit["heading"] })[] {
  const out: (Span & { heading: Unit["heading"] })[] = [];
  let paragraph: Span | null = null;
  const close = () => {
    if (paragraph) {
      const t = trim(text, paragraph);
      if (t) out.push({ ...t, heading: null });
    }
    paragraph = null;
  };
  let lineStart = 0;
  for (const line of text.split("\n")) {
    const lineEnd = lineStart + line.length;
    const m = HEADING.exec(line);
    if (m) {
      close();
      const t = trim(text, { start: lineStart, end: lineEnd })!;
      out.push({ ...t, heading: { level: m[1]!.length, text: m[2]!.trim() } });
    } else if (line.trim().length === 0) {
      close();
    } else {
      paragraph = paragraph ? { start: paragraph.start, end: lineEnd } : { start: lineStart, end: lineEnd };
    }
    lineStart = lineEnd + 1;
  }
  close();
  return out;
}

/** The units the chunker packs: headings, whole paragraphs when they fit, their sentences otherwise. */
function units(text: string, budget: number): Unit[] {
  const out: Unit[] = [];
  for (const b of blocks(text)) {
    const tokens = countTokens(text.slice(b.start, b.end));
    if (b.heading || tokens <= budget) {
      out.push({ start: b.start, end: b.end, tokens, carried: false, heading: b.heading });
      continue;
    }
    for (const s of splitSentences(text.slice(b.start, b.end))) {
      const start = b.start + s.start;
      const end = b.start + s.end;
      out.push({ start, end, tokens: countTokens(text.slice(start, end)), carried: false, heading: null });
    }
  }
  return out;
}

export function chunkText(text: string, options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): TextChunk[] {
  const { budget, overlap } = options;
  const chunks: TextChunk[] = [];
  let current: Unit[] = [];
  let currentTokens = 0;
  /** The headings in force, outermost first; `chunkPath` is what it was when the current chunk opened. */
  let path: string[] = [];
  let chunkPath: string[] = [];

  const emit = (parts: Unit[], headingPath: string[]) => {
    if (parts.length === 0 || parts.every((u) => u.carried)) return;
    const start = parts[0]!.start;
    const end = parts[parts.length - 1]!.end;
    const body = text.slice(start, end);
    chunks.push({ ordinal: chunks.length, start, end, body, tokens: countTokens(body), headingPath });
  };

  /** The trailing units of `parts` whose tokens fit in the overlap and leave room for `next`; never a heading. */
  const tail = (parts: Unit[], next: Unit): Unit[] => {
    const kept: Unit[] = [];
    let tokens = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const u = parts[i]!;
      if (u.heading || tokens + u.tokens > overlap || tokens + u.tokens + next.tokens > budget) break;
      kept.unshift({ ...u, carried: true });
      tokens += u.tokens;
    }
    return kept;
  };

  const open = (parts: Unit[], headingPath: string[]) => {
    current = parts;
    currentTokens = parts.reduce((n, u) => n + u.tokens, 0);
    chunkPath = headingPath;
  };

  for (const unit of units(text, budget)) {
    if (unit.heading) {
      path = [...path.slice(0, unit.heading.level - 1), unit.heading.text];
      // A heading opens a new chunk, unless the current one holds nothing but headings.
      if (!current.every((u) => u.heading)) {
        emit(current, chunkPath);
        open([], path);
      }
      current.push(unit);
      currentTokens += unit.tokens;
      chunkPath = path;
      continue;
    }
    if (unit.tokens > budget) {
      emit(current, chunkPath);
      emit([unit], path);
      open([], path);
      continue;
    }
    if (currentTokens + unit.tokens > budget) {
      emit(current, chunkPath);
      open(tail(current, unit), path);
    }
    current.push(unit);
    currentTokens += unit.tokens;
  }
  emit(current, chunkPath);
  return chunks;
}
