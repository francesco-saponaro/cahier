# 4. Lists page by keyset cursor, not by offset

Date: 2026-11-21

## Context

Every list in Cahier can grow while someone is reading it: conversations get new messages, the audit log gets a row on every change, documents are uploaded. The usual `?page=3` reads rows 41 to 60 by skipping 40, which the database does by fetching and discarding them, and when a row is inserted ahead of the reader, page 4 repeats the last row of page 3.

## Options considered

1. **Offset and page size**, with a total count. Simple to build a pager from; costs grow with the offset; pages shift under inserts.
2. **A keyset cursor**: the client sends the sort key and id of the last row it saw, and the query asks for the rows after it with one row comparison, `(key, id) > ($1, $2)`, which an index on `(key, id)` walks directly. No total.
3. **Keyset with a separate count query** for the total.

## Decision

Option 2. A cursor is an opaque base64url string encoding `[key, id]`; `pageQuery` clamps the limit to 1 to 50 (20 by default); every list answers `{ items, nextCursor }` and the client passes `nextCursor` back for the next page, until it is null. The sort key is whatever the list is ordered by (a time, a lower-cased name, an ordinal), always tied by id so the order is total. Text keys compare in plain code-point order (`collate "C"` in SQL, `<` in memory), so the two adapters paginate identically; the contract test walks the same lists through both.

The totals the screens want ("12 members", "3 pending requests") come from the rows on the page or from a count the screen asks for separately; no list carries a total.

## Consequences

No "jump to page 7", which none of these screens needs; "load more" and infinite scroll are what they do. Changing the sort invalidates the cursor, so a cursor is only valid with the filters and sort it was made with. The query plans are index walks whatever the depth. The code is one helper per adapter (`keysetPage` in memory, `keyset` in Drizzle) rather than a limit and an offset on every query.
