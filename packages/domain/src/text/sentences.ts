/**
 * Sentence units with their spans in the text. A unit ends at a full stop, a question or an
 * exclamation mark (plus any closing quote or bracket) followed by whitespace, or at a line
 * break, so Markdown list items and headings stay apart. A dot inside a number ("3.5"), a short
 * abbreviation ("e.g.", "Nov.") or a single capital ("J. Smith") does not end a unit.
 *
 * Spans are trimmed: `text.slice(start, end)` has no leading or trailing whitespace, units are
 * in order and never overlap, and every non-space character of the text is inside one unit.
 */

export interface Span {
  start: number;
  end: number;
}

const CLOSERS = "\"'’”)\\]";
const END = new RegExp(`[.!?]+[${CLOSERS}]*(?=\\s|$)`, "gu");

function isAbbreviation(text: string, dotIndex: number): boolean {
  // The word before the dot, without its own earlier dots ("e.g" → "g", "Nov" → "Nov").
  let i = dotIndex - 1;
  while (i >= 0 && /[\p{L}\p{N}]/u.test(text[i]!)) i--;
  const word = text.slice(i + 1, dotIndex);
  const before = text[i];
  if (word.length === 0) return false;
  if (/^\p{N}+$/u.test(word)) return false; // "in 2026." ends the sentence
  if (word.length === 1) return true; // "J." or "e."
  if (before === ".") return true; // "e.g." — the previous piece already had a dot
  return ABBREVIATIONS.has(word.toLowerCase());
}

const ABBREVIATIONS = new Set([
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "mr", "mrs", "ms", "dr", "prof", "vs", "etc", "approx", "dept", "fig", "no", "st", "inc", "ltd", "cf",
]);

function trimmed(text: string, start: number, end: number): Span | null {
  while (start < end && /\s/u.test(text[start]!)) start++;
  while (end > start && /\s/u.test(text[end - 1]!)) end--;
  return end > start ? { start, end } : null;
}

export function splitSentences(text: string): Span[] {
  const units: Span[] = [];
  let unitStart = 0;
  const push = (end: number) => {
    const span = trimmed(text, unitStart, end);
    if (span) units.push(span);
    unitStart = end;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\n") {
      push(i);
      continue;
    }
    if (ch === "." || ch === "!" || ch === "?") {
      END.lastIndex = i;
      const m = END.exec(text);
      if (!m || m.index !== i) continue;
      if (ch === "." && m[0].length === 1 && isAbbreviation(text, i)) continue;
      push(i + m[0].length);
      i += m[0].length - 1;
    }
  }
  push(text.length);
  return units;
}
