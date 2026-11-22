import { tokenize } from "../text/tokens.js";

/*
 * The question as the search sees it. Retrieval runs in the database with `websearch_to_tsquery`
 * and the `english` configuration; the composition step scores sentences in plain code and needs
 * the same idea of a term, so this file approximates that configuration: the same stop-word list,
 * and a stemmer that strips the common plural and verb endings. It need not match Snowball letter
 * for letter; it has to agree on which words matter, and `compose.ts` matches stems by prefix to
 * forgive the rest.
 */

/** The stop words of PostgreSQL's `english` text-search configuration. */
const STOP_WORDS = new Set(
  (
    "i me my myself we our ours ourselves you your yours yourself yourselves he him his himself she her hers herself it its itself they them their " +
    "theirs themselves what which who whom this that these those am is are was were be been being have has had having do does did doing a an the and " +
    "but if or because as until while of at by for with about against between into through during before after above below to from up down in out on " +
    "off over under again further then once here there when where why how all any both each few more most other some such no nor not only own same so " +
    "than too very s t can will just don should now"
  ).split(" "),
);

export function isStopWord(word: string): boolean {
  return STOP_WORDS.has(word.toLowerCase());
}

/** Lower-case, minus a plural `s`/`es`/`ies` or an `ing`/`ed` ending; words of three letters or fewer are left alone. */
export function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("es") && /(?:ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  return w;
}

const isWord = (piece: string) => /^[\p{L}\p{N}]/u.test(piece);

/** The words of the question that carry meaning, lower-cased, in order of first appearance, without repeats: what the database stems itself. */
export function queryWords(question: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const piece of tokenize(question)) {
    if (!isWord(piece)) continue;
    const lower = piece.toLowerCase();
    if (lower.length < 2 || isStopWord(lower) || seen.has(lower)) continue;
    seen.add(lower);
    words.push(lower);
  }
  return words;
}

/** The same words stemmed, without repeats: what the composer matches sentences against. */
export function queryTerms(question: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const word of queryWords(question)) {
    const s = stem(word);
    if (s.length < 2 || seen.has(s)) continue;
    seen.add(s);
    terms.push(s);
  }
  return terms;
}

/** The phrase to look for verbatim: the longest quoted one, else the three consecutive words with the most letters; null when there is neither. */
export function phraseOf(question: string): string | null {
  const quoted = [...question.matchAll(/["“”]([^"“”]+)["“”]/gu)].map((m) => m[1]!.trim()).filter((q) => q.length > 0);
  if (quoted.length > 0) return quoted.reduce((best, q) => (q.length > best.length ? q : best));
  const words = tokenize(question).filter(isWord);
  if (words.length < 3) return null;
  let best: string[] = [];
  let bestLength = -1;
  for (let i = 0; i + 3 <= words.length; i++) {
    const window = words.slice(i, i + 3);
    const length = window.reduce((n, w) => n + w.length, 0);
    if (length > bestLength) {
      best = window;
      bestLength = length;
    }
  }
  return best.join(" ");
}
