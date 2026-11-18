# Changelog

## 2026-11-18

- Workspace: pnpm, TypeScript strict, ESLint, Vitest, the CI workflow, docker compose for PostgreSQL 16, the server and the web app, and the example environment.
- `packages/domain`: the approximate tokenizer, sentence units with spans, the chunker (paragraphs under a budget, cut at sentence ends, with an overlap), scrypt passwords and the password rule, micro-dollar arithmetic and the price in force.
- `packages/db`: twenty-two tables as a Drizzle schema with their constraints, the first migration with the generated search vector and its GIN index, `connect` and `connectPglite`, the seed generator (two workspaces, fourteen hand-written documents and generated notes, agents with versions, cited conversations, usage at the price in force, budgets, schedules, the audit log) and its tests.
- `apps/server`: Fastify with the health check, security headers and CORS. `apps/web`: the Next.js static-export shell.
- Decisions 0001 (packages and the two entry points) and 0002 (tokens and micro-dollars as integers, prices with a validity range).
