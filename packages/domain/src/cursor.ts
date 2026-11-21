/*
 * Lists page by cursor, never by offset: a cursor names the last item seen (its sort key and its
 * id), and the next page is everything after it in (key, id) order. New rows cannot shift a page
 * and the database walks an index instead of counting rows it then throws away. The cursor is an
 * opaque string to the app; both adapters decode it the same way.
 */

export interface Cursor {
  key: string | number;
  id: string;
}

export interface PageQuery {
  limit: number;
  cursor: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;

const bytesToBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function base64UrlToBytes(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function encodeCursor(cursor: Cursor): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify([cursor.key, cursor.id])));
}

/** The cursor behind the string, or null for anything this module did not produce. */
export function decodeCursor(text: string): Cursor | null {
  if (text.length === 0) return null;
  const bytes = base64UrlToBytes(text);
  if (!bytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [key, id] = parsed as [unknown, unknown];
  if ((typeof key !== "string" && typeof key !== "number") || typeof id !== "string") return null;
  return { key, id };
}

/** Clamps a page request to what a list accepts. */
export function pageQuery(query: { limit?: number | undefined; cursor?: string | null | undefined } | undefined): PageQuery {
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query?.limit ?? DEFAULT_PAGE_SIZE)));
  return { limit, cursor: query?.cursor || null };
}

export interface KeysetOrder<T> {
  key: (item: T) => string | number;
  direction: "asc" | "desc";
}

/** Plain code-point order, which is what `collate "C"` gives in PostgreSQL, so both adapters sort alike. */
function compareKeys(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** One page of `items` in (key, id) order after the cursor; the in-memory twin of the SQL row comparison. */
export function keysetPage<T extends { id: string }>(items: readonly T[], order: KeysetOrder<T>, query: PageQuery): Page<T> {
  const sign = order.direction === "asc" ? 1 : -1;
  const sorted = [...items].sort((a, b) => sign * (compareKeys(order.key(a), order.key(b)) || compareKeys(a.id, b.id)));
  const after = query.cursor ? decodeCursor(query.cursor) : null;
  const rest = after
    ? sorted.filter((item) => {
        const c = compareKeys(order.key(item), after.key) || compareKeys(item.id, after.id);
        return sign * c > 0;
      })
    : sorted;
  const page = rest.slice(0, query.limit);
  const last = page[page.length - 1];
  const nextCursor = rest.length > query.limit && last ? encodeCursor({ key: order.key(last), id: last.id }) : null;
  return { items: page, nextCursor };
}
