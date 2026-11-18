# Cahier

A team assistant that answers from the team's own documents, and the admin console behind it. A member keeps libraries of documents, builds agents that may read some of them, and asks questions: every sentence of the answer carries a citation that opens the page at the exact passage. Sharing a library or an agent with the workspace is a request an admin approves. The admin runs the place: members, which tools are on, the share inbox, the monthly token budget, usage at the prices in force when each answer was given, the audit log.

The part I care most about is grounding: cutting documents into chunks that follow the text, retrieving with PostgreSQL full-text search under the rights of the person asking, packing a context under a token budget, composing an answer whose citations resolve to exact spans, streaming it, and metering it. The model itself is simulated (the answer is built from the retrieved passages) behind a port where a real client would go; everything around it is real.

This is day one of a six-day build. The sections below fill in as the pieces land.

## Live demo

Not yet. The demo will be the static build of the web app with the same router, migration and seed running in the browser on PGlite, so what it shows is the real code path with no server behind it.

## Running it

Two ways, same code.

With Docker, which starts PostgreSQL 16, the server on `http://localhost:3001` and the web app on `http://localhost:8080`:

```
cp .env.example .env
docker compose up
```

By hand, with Node 22 and pnpm:

```
pnpm install
pnpm test
pnpm build
DATABASE_URL=postgres://cahier:cahier@127.0.0.1:5432/cahier SEED=1 pnpm -C apps/server dev
NEXT_PUBLIC_API_URL=http://localhost:3001 pnpm -C apps/web dev
```

The server needs a PostgreSQL to point at (`docker compose up postgres` gives one); the variables and their defaults are in `.env.example`. With `SEED=1` an empty database comes up with the seed loaded: about 12,600 rows of six months of two workspaces using the assistant, generated from a fixed seed so every run is the same.

## What is there so far

- `packages/domain`: the approximate tokenizer, sentence units with spans, the chunker (a paragraph that fits the budget stays whole, a longer one is cut at sentence ends, the next chunk repeats the tail of the previous one), scrypt passwords, micro-dollar arithmetic and the price in force at an instant.
- `packages/db`: twenty-two tables with their constraints in the database, the migration with the generated search vector, `connect` (node-postgres) and `connectPglite`, and the seed generator with a hand-written corpus: a fictional company's handbook, runbooks and price list, and a fictional bakery chain's shop manual.
- `apps/server`: Fastify with the health check, security headers and CORS.
- `apps/web`: the Next.js static-export shell.

## Tests

```
pnpm test
```

Unit tests on the text rules (with property-based tests for the tokenizer, the sentence splitter and the chunker), on money and passwords; schema tests that prove the database refuses what it should; seed tests that check the invariants the real use cases will have to keep (chunks that cover their document, citations that quote it at their span, usage that adds up at the price in force, rights that hold).

## What is real and what is simulated

Real: the database and its constraints, the chunking, the retrieval, the citations, the permissions, the sessions, the metering and the budgets, both ways of running it. Simulated: the model. No request ever leaves the machine; the answer is extractive, built from the passages the retrieval found, and the tokenizer is an approximation (one token per six characters of a word). Documents are text and Markdown only.

## Layout

```
packages/domain    the rules, no framework and no database
packages/db        schema, migrations, seed, adapters
apps/server        Fastify
apps/web           Next.js, static export
docs/decisions     the decision records, one per choice that cost something
```

## Licence

MIT.
