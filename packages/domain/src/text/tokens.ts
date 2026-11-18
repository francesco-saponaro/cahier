/**
 * An approximate tokenizer. A real model counts tokens with its own vocabulary; nothing here
 * calls a model, so budgets, chunk sizes and usage rows are counted with this rule instead:
 * a word is one token per six characters (rounded up), a punctuation mark is one token,
 * whitespace is nothing. It is deterministic and additive, which is what the chunker, the
 * context packer and the meter need from it. It sits behind the `Tokenizer` port so a real
 * tokenizer is one adapter away.
 */

export interface Tokenizer {
  count(text: string): number;
}

const WORD = /[\p{L}\p{N}]+(?:['’\-_][\p{L}\p{N}]+)*/u;
const PIECE = new RegExp(`${WORD.source}|[^\\s\\p{L}\\p{N}]`, "gu");

/** The pieces the counter sees: words (with inner apostrophes and hyphens) and single marks. */
export function tokenize(text: string): string[] {
  return text.match(PIECE) ?? [];
}

const CHARS_PER_TOKEN = 6;

export function countTokens(text: string): number {
  let n = 0;
  for (const piece of tokenize(text)) {
    n += WORD.test(piece) && /^[\p{L}\p{N}]/u.test(piece) ? Math.ceil(piece.length / CHARS_PER_TOKEN) : 1;
  }
  return n;
}

export const approximateTokenizer: Tokenizer = { count: countTokens };
