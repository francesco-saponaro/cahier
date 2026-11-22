# 6. Retrieval is PostgreSQL full-text search under the member's rights, not a vector index

Date: 2026-11-22

## Context

The answer can only quote what retrieval found, so retrieval decides the quality of the product. It also decides what a member can be shown: an agent reads the libraries its version names, a member reads their own and the shared ones, and the chunks that reach the context must come from the intersection, computed at question time. The demo runs on PGlite in the browser, so whatever retrieval is, it must run there too, on the same migration.

## Options considered

1. **Vector embeddings with a nearest-neighbour index.** The usual choice, and better at paraphrase. It needs a model to embed the documents and the question: a paid API, which is out, or a bundled embedding model, which is tens of megabytes in the browser and a second simulated component to explain. The ranking is also hard to explain to a person reading the citations.
2. **A hand-written inverted index in code.** Runs anywhere, but duplicates what the database already does well, and the permission filter would have to be re-implemented in code on top of it.
3. **PostgreSQL full-text search.** `to_tsvector('english', …)` as a generated column on `chunks`, a GIN index, the question as an OR of its words each stemmed by the database, `ts_rank_cd` with the title weighted A, the heading path B and the body D, and a bonus when the question's phrase appears verbatim. The permission filter is a `where` on the same query, and PGlite runs all of it unchanged.

## Decision

Option 3. `chunks.search` in `packages/db/src/adapters.ts` is the query; `libraries.readableIds` is the SQL twin of `canReadLibrary`, and `packages/db/test/access-twin.test.ts` generates libraries and actors and checks the two agree on every one. The retrieval step intersects the agent version's libraries with the ids the twin answers, searches only indexed documents, and takes the top 24 with a fixed tie-break, so the same question always retrieves the same chunks. The in-memory adapter approximates the same ranking for the use-case tests; the contract test keeps the two honest on the cases that matter (what matches, what does not, the title counting, the limit).

## Consequences

Retrieval is explainable: a chunk is in the answer because it holds the words of the question, and the viewer shows them. It misses paraphrase and synonyms, which the README says. The stemmer in code (`terms.ts`) is an approximation of Snowball used only to score sentences inside a retrieved chunk; the database does the real stemming for retrieval. If embeddings are added later they can be a second score folded into the same query, and the permission filter does not move.
