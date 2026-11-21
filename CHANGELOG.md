# Changelog

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
