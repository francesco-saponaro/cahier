# Cahier

A team assistant that answers from the team's own documents, and the admin console behind it. A member keeps libraries of documents, builds agents that may read some of them, and asks questions: every sentence of the answer carries a citation that opens the page at the exact passage. Sharing a library or an agent with the workspace is a request an admin approves. The admin runs the place: members, which tools are on, the share inbox, the monthly token budget, usage at the prices in force when each answer was given, the audit log.

The part I care most about is grounding: cutting documents into chunks that follow the text, retrieving with PostgreSQL full-text search under the rights of the person asking, packing a context under a token budget, composing an answer whose citations resolve to exact spans, streaming it, and metering it. The model itself is simulated (the answer is built from the retrieved passages) behind a port where a real client would go; everything around it is real.

This is day three of a six-day build: the whole backend is there, the web app comes next. The sections below fill in as the pieces land.

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

## How a question is answered

A member asks a question in a conversation with an agent. The server writes the question, then checks four things before it retrieves anything: grounded answers are switched on in the workspace, the agent's model has a price in force, the member is under their rate limit (20 questions and 40,000 tokens a minute), and the month's budget leaves room for the estimated cost. Any of those failing is a refusal with its reason, written as a terminal message with no usage.

Retrieval is PostgreSQL full-text search. Each chunk has a generated search vector (heading path and body, GIN-indexed); the query joins the document's title to it with the highest weight, ranks with `ts_rank_cd`, and adds a bonus when the question's phrase appears verbatim. The libraries searched are the agent version's intersected with the ones the member may read, and that intersection is a `where` clause written as the twin of the rule the use cases apply in code; a generated test checks the two agree. The top 24 chunks are packed under the version's context budget: the best chunk of each document first, then up to three per document, then what still fits.

The answer is composed from the packed chunks: the sentences that cover the most terms of the question, in reading order, one line per passage ending in `[n]`. Every quote is exactly `document.slice(start, end)`, which is what the viewer will highlight. The answer streams as events over server-sent events (a tRPC subscription), and when it is done the citations, the three usage rows at the prices in force, and the conversation's counts land in one transaction. `docs/domain.md` walks through one question from the seed with the real numbers.

Documents go in as text or Markdown and are chunked on upload: a heading opens a chunk, a paragraph that fits 320 tokens stays whole, a longer one is cut at sentence ends, and each chunk repeats up to 40 tokens of the previous one's tail. Replacing a document bumps its version; old citations keep their quote.

Scheduled prompts run on a tick (every minute on the server): each due schedule opens a conversation as its owner, with the owner's rights at that moment, and asks the prompt through the same pipeline. The tick also closes the budgets of months that have ended and deletes archived conversations past the workspace's retention.

## What is there so far

- `packages/domain`: the approximate tokenizer, sentence units with spans, the chunker (headings open chunks and set the heading path, a paragraph that fits the budget stays whole, a longer one is cut at sentence ends, the next chunk repeats the tail of the previous one), scrypt passwords, micro-dollar arithmetic and the price in force at an instant. The entities, the eleven state machines as transition tables, the access rules, the ports the use cases need and their in-memory adapters. The grounding pipeline: the packer, the extractive composer behind the `Answerer` port, the meter and the rate limit. The use cases: sign-in and sessions, invitations and members, libraries and documents with their ingestion, agents and their versions, share requests, conversations and `messages.send`, scheduled prompts with the tick and `runNow`, settings, budgets, the usage report and the audit log.
- `packages/db`: twenty-two tables with their constraints in the database, the migration with the generated search vector, `connect` (node-postgres) and `connectPglite`, the seed generator with a hand-written corpus (a fictional company's handbook, runbooks and price list, and a fictional bakery chain's shop manual), and the ports over Drizzle, which pass the same contract test as the in-memory ones, with the full-text search and the permission filter in SQL.
- `packages/api`: the tRPC router, one procedure per use case, the streamed answer as a subscription, with the zod input schemas the web app will share. `docs/api.md` lists every procedure with its auth rule, input, answer and errors.
- `apps/server`: Fastify serving the router at `/trpc`, with the health check, security headers, CORS, a rate limit on sign-in, and the tick every minute.
- `apps/web`: the Next.js static-export shell.

### Signing in

`auth.signIn` takes an email and a password and answers an opaque token; the server stores only its SHA-256, with the workspace the session is in and an expiry. Every call carries `Authorization: Bearer <token>`, and the person behind it is the session's user with the role their membership gives them in that workspace, for as long as the membership is active. Suspending someone ends their sessions at once. A user can belong to several workspaces and switch between them; the session is rewritten. Invitations are a token the admin passes on (there is no email delivery), accepted with a name and a password, or with the password of an account that already exists.

### What the rules enforce

A member sees their own libraries, agents and conversations and whatever is shared with the workspace. Sharing is a request the owner makes and an admin approves; the admin's inbox shows what an agent would expose, library by library, with which of those are private. An admin reads every library and agent in the workspace, but no conversation of anyone else. Agents are versioned: saving opens a draft, publishing retires the current version, rolling back republishes an old one under its own number, and a conversation records the version that answered it. The last active admin can be neither suspended nor demoted. Every state change goes through a transition table, and every change writes an audit row with the fields before and after.

Lists page by cursor, never by offset: each page answers a `nextCursor` to pass back for the next one, and a row inserted ahead of the reader cannot shift a page.

## Tests

```
pnpm test
```

Unit tests on the text rules (with property-based tests for the tokenizer, the sentence splitter, the chunker with and without headings, the packer, the composer, the meter and the rate limit), on money, passwords and cursors; the use cases on the in-memory ports, with a small world where every expectation is written out in full, the pipeline included (the answer, the citations, the usage rows, every refusal, a failing model, the tick); one contract test that both the in-memory and the Drizzle adapters pass, so a filter, a sort, a page, a search and a usage sum mean the same in both; a generated test that the permission filter in SQL agrees with the rule in code; retrieval tests on the seed; schema tests that prove the database refuses what it should; seed tests that check the invariants the pipeline keeps (chunks that cover their document, citations that quote it at their span, usage that adds up at the price in force, rights that hold); router tests on the middleware, the error mapping and the in-process stream; and integration tests over HTTP on the seed, with a real server on a free port: the access matrix (anonymous, member, admin, suspended, the admin of another workspace), the workflows (build an agent, share it, use it; invite and join; run the workspace; schedule a prompt), upload and ask with the answer streamed over SSE, the budget refusal, `runNow`, the ticker running the seed's due schedule, the forbidden transitions, the last-admin rule, cursor paging through the seed, and the rate limit on sign-in.

## What is real and what is simulated

Real: the database and its constraints, the chunking, the retrieval, the citations, the permissions, the sessions, the metering and the budgets, the scheduler, both ways of running it. Simulated: the model. No request ever leaves the machine; the answer is extractive, built from the sentences of the passages the retrieval found, so it reads as quoted lines and never paraphrases, and the tokenizer is an approximation (one token per six characters of a word). The `Answerer` port is where a real client would go; everything above it would keep its tests. Retrieval is word-based, so it misses synonyms and paraphrase. Documents are text and Markdown only.

## Layout

```
packages/domain    the rules, no framework and no database
packages/db        schema, migrations, seed, adapters
packages/api       the tRPC router and the input schemas
apps/server        Fastify
apps/web           Next.js, static export
docs/api.md        every procedure
docs/domain.md     the glossary, the rules, the state machines, one question worked through
docs/decisions     the decision records, one per choice that cost something
```

## Licence

MIT.
