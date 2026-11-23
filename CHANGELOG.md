# Changelog

## 2026-11-23

- `apps/web`: the member's side of the app. The tokens (a paper ground, ink chrome, one hue on the citation), Geist self-hosted, the shell as an icon rail with the person's menu at its foot (workspace switch, sign out), folding into a top bar and a bottom bar on a phone. The tRPC client with the batch link and the SSE link (the token in the connection params), TanStack Query, the session in localStorage dropped on `UNAUTHORIZED` or expiry. Sign-in with the seed's three accounts. Chat: the conversations (active or archived, searched, paged), the open conversation with the agent in a rail, the question box, the answer streamed from the server's events, `[n]` chips that open the viewer at the cited span, the sources under each answer, refusals as their reason, rename, archive and restore. The document viewer with the span highlighted and the chunks in the margin; replace, re-index and remove. Libraries (own, shared, all for an admin; indexed counts) and a library's documents (status, search, sort, paging), the upload form (pasted or a chosen file), the share request and its withdrawal, edit and remove. Agents (list) and the builder (draft, publish, roll back, archive, share request), the model list with prices per million tokens. The person's own share requests with their outcome beside both lists. Component tests for the forms, the question box, the stream state, the message list, the citation chips and the viewer's segments.
- `packages/api`: `agents.models` (the enabled models with the prices in force), and the router allowed outside a server for the forms and the coming demo.
- Decision 0008 (ids in the query string, since a static export cannot enumerate them).

## 2026-11-22

- `packages/domain`: the grounding pipeline. The chunker now opens a chunk at every Markdown heading and carries the heading path. `grounding/`: the question's words and terms as the search sees them, the context packer (best chunk of each document first, then three per document, then what fits), the extractive composer behind the `Answerer` port (the sentences covering the most terms, one line per passage with its citation, a quote that is exactly the document at its span), the meter (costed rows at the price in force, the budget check) and the member's rate limit (a token bucket). Use cases: `documents.upload`, `replace` and `reindex` through the document state machine; `messages.send` as a stream of events, metered, cited and audited, with refusals for the tool off, no price, the rate limit, the budget and nothing found; `schedules.tick` (closing past months, retention, the due schedules run as conversations of their owners) and `schedules.runNow`.
- `packages/db`: `chunks.search` with `ts_rank_cd` over the title, the heading path and the body, the question as an OR of its words stemmed by the database, and a phrase bonus; `libraries.readableIds` as the SQL twin of `canReadLibrary`, with a generated test proving the two agree; the write ports for messages, citations, usage, runs; `archivedBefore`, `openBefore`, `due`.
- `packages/api`: `documents.upload`, `.replace`, `.reindex`; `messages.send` as a subscription (SSE over HTTP, an async iterable in-process) with the token in the connection params; `schedules.runNow`.
- `apps/server`: the tick every minute, the stream paced at 12 ms a piece; tests of the pipeline over HTTP (upload, ask, citations, usage, the budget refusal, `runNow`, the ticker on the seed).
- `docs/domain.md`, `docs/api.md` completed. Decisions 0006 (full-text search, not embeddings) and 0007 (the simulated model behind a port).

## 2026-11-21

- `packages/domain`: the entities, `Result`, the eleven transition tables, the cursor every list pages by, the ports and the unit of work, the in-memory adapters and the contract test, the access rules, and the use cases: auth (opaque sessions hashed in the table, the actor from the session's workspace and membership, joining by invitation), members (invite, revoke, suspend, reinstate, roles, the last-admin rule), libraries and documents (without the ingestion), agents and versions (draft, publish, roll back, archive), share requests (request, withdraw, inbox with what an agent exposes, approve, decline, unshare), conversations (open, rename, archive, restore) and messages, scheduled prompts (create with the next run in its time zone, pause, resume, end), settings and budgets, the usage report with its reconciliation, the audit log.
- `packages/db`: the ports over Drizzle, passing the same contract test on PGlite; the rows checked against the entities type by type.
- `packages/api`: the tRPC router, the context from the bearer header, member and admin procedures, the zod inputs, the error mapping with the rule's reason.
- `apps/server`: the router at `/trpc`, the rate limit on sign-in, integration tests over HTTP on the seed.
- `docs/api.md`. Decisions 0003 (bearer sessions, not cookies or JWTs), 0004 (cursor paging), 0005 (validation shared between the API and the app).

## 2026-11-18

- Workspace: pnpm, TypeScript strict, ESLint, Vitest, the CI workflow, docker compose for PostgreSQL 16, the server and the web app, and the example environment.
- `packages/domain`: the approximate tokenizer, sentence units with spans, the chunker (paragraphs under a budget, cut at sentence ends, with an overlap), scrypt passwords and the password rule, micro-dollar arithmetic and the price in force.
- `packages/db`: twenty-two tables as a Drizzle schema with their constraints, the first migration with the generated search vector and its GIN index, `connect` and `connectPglite`, the seed generator (two workspaces, fourteen hand-written documents and generated notes, agents with versions, cited conversations, usage at the price in force, budgets, schedules, the audit log) and its tests.
- `apps/server`: Fastify with the health check, security headers and CORS. `apps/web`: the Next.js static-export shell.
- Decisions 0001 (packages and the two entry points) and 0002 (tokens and micro-dollars as integers, prices with a validity range).
