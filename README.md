# Cahier

A team assistant that answers from the team's own documents, and the admin console behind it. A member keeps libraries of documents, builds agents that may read some of them, and asks questions: every line of the answer carries a citation that opens the page at the exact passage. Sharing a library or an agent with the workspace is a request an admin approves. The admin runs the place: members, which tools are on, the share inbox, the monthly token budget, usage at the prices in force when each answer was given, the audit log.

The part I care most about is grounding: cutting documents into chunks that follow the text, retrieving with PostgreSQL full-text search under the rights of the person asking, packing a context under a token budget, composing an answer whose citations resolve to exact spans, streaming it, and metering it. The model itself is simulated (the answer is built from the retrieved passages) behind a port where a real client would go; everything around it is real.

![The chat: Léa's question to the Handbook helper, the answer in three cited lines, the sources under it, and the agent in the rail](docs/screenshots/chat.png)

## Live demo

https://cahier.netlify.app

The demo is the whole product with no server behind it. With `NEXT_PUBLIC_API_URL` empty, the static export opens PostgreSQL in the page (PGlite, the database compiled to WebAssembly), applies the same migration docker compose applies, loads the same seed, and calls the same router through a link that runs each procedure in the tab instead of over HTTP. Nothing above that link knows the difference. The database lives in memory: a reload starts from the seed again, with the person still signed in, and whatever they created is gone. Opening it costs the download of about nine megabytes of PostgreSQL and a few seconds of seeding, which start as soon as the page opens.

Sign in as one of the seed's accounts in the workspace Oriel, all with the password `cahier-demo`: `lea@example.com` (a member), `tom@example.com` (a member with a private library and a private agent) or `noor@example.com` (an admin). The sign-in page fills them in on a click. The seed is six months of two workspaces using the assistant, about 13,500 rows generated from a fixed seed, so every visitor sees the same numbers: Noor's usage page says $0.02 of the $2.00 November budget is spent and the Handbook helper is the biggest spender.

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
pnpm build
DATABASE_URL=postgres://cahier:cahier@127.0.0.1:5432/cahier SEED=1 pnpm -C apps/server dev
NEXT_PUBLIC_API_URL=http://localhost:3001 pnpm -C apps/web dev
```

The server needs a PostgreSQL to point at (`docker compose up postgres` gives one); the variables and their defaults are in `.env.example`. With `SEED=1` an empty database comes up with the seed loaded.

On its own, with no server at all, which is what the demo is:

```
pnpm build && pnpm build:web
pnpm -C apps/web exec serve -s out
```

## What it does

For a member: chat with an agent and read the answer line by line, each line ending in a chip that opens the document at the cited span; keep libraries of text and Markdown documents, uploaded as pasted text or a chosen file, chunked and indexed on upload, replaced with a new version or re-indexed; build agents with instructions, a model, a context budget and the libraries they read, versioned so that saving opens a draft, publishing retires the previous version and rolling back republishes an old one under its own number; ask to share a library or an agent with the workspace and read the outcome; schedule a prompt to run on a cadence in your own time zone and read every run.

For an admin: the share inbox, which shows what approving a request would expose (for an agent, the libraries it reads and which of those are still private), with approve, decline with a reason, and unshare; members and invitations, with the invitation's token shown once to pass on, suspend, reinstate and roles; the three tools switched on or off, the retention of archived conversations, and the budget for this month and the next; usage for the month, by day, by model, by member and by agent, with a line that says whether the sums agree with the plain sum of every usage row, to the micro-dollar; the audit log, every change with who made it and the fields before and after.

![The document viewer: the handbook page with the cited passage marked and the chunks in the margin](docs/screenshots/viewer.png)

![The usage dashboard: the spent figure against the budget, the cost per day, the models' shares, members and agents ranked](docs/screenshots/usage.png)

## How a question is answered

A member asks a question in a conversation with an agent. The server writes the question, then checks four things before it retrieves anything: grounded answers are switched on in the workspace, the agent's model has a price in force, the member is under their rate limit (20 questions and 40,000 tokens a minute), and the month's budget leaves room for the estimated cost. Any of those failing is a refusal with its reason, written as a terminal message with no usage.

Retrieval is PostgreSQL full-text search. Each chunk has a generated search vector (heading path and body, GIN-indexed); the query joins the document's title to it with the highest weight, ranks with `ts_rank_cd`, and adds a bonus when the question's phrase appears verbatim. The libraries searched are the agent version's intersected with the ones the member may read, and that intersection is a `where` clause written as the twin of the rule the use cases apply in code; a generated test checks the two agree. The top 24 chunks are packed under the version's context budget: the best chunk of each document first, then up to three per document, then what still fits.

The answer is composed from the packed chunks: the sentences that cover the most terms of the question, in reading order, one line per passage ending in `[n]`. Every quote is exactly `document.slice(start, end)`, which is what the viewer highlights. The answer streams as events over server-sent events (a tRPC subscription), and when it is done the citations, the three usage rows at the prices in force, and the conversation's counts land in one transaction. `docs/domain.md` walks through one question from the seed with the real numbers.

Documents are chunked on upload: a heading opens a chunk, a paragraph that fits 320 tokens stays whole, a longer one is cut at sentence ends, and each chunk repeats up to 40 tokens of the previous one's tail. Replacing a document bumps its version; old citations keep their quote.

Scheduled prompts run on a tick (every minute on the server, once on page load then every minute in the demo): each due schedule opens a conversation as its owner, with the owner's rights at that moment, and asks the prompt through the same pipeline. The tick also closes the budgets of months that have ended and deletes archived conversations past the workspace's retention.

## Stack

TypeScript strict throughout, in a pnpm workspace. Next.js 16 with the App Router as a static export, because the demo has to be plain files on a CDN and the ids a page needs travel in the query string. React 19 and Tailwind 4. tRPC 11 for the API, so the web app gets the router's types and the same zod schemas the server parses with, and a subscription for the streamed answer. TanStack Query for the screens' data. Fastify 5 as the server, with helmet, CORS and a rate limit on sign-in. Drizzle for the schema, the migration and the queries, over node-postgres on the server and over PGlite in the tests and in the browser; the same query runs in all three. superjson so dates stay dates across the wire. Vitest with Testing Library and fast-check for the tests, Playwright for the end-to-end runs.

## Architecture

Three packages and two apps. `packages/domain` is the rules and the use cases and imports nothing from the workspace and no framework; its ports are interfaces, with an in-memory implementation for the tests. `packages/db` implements the ports over Drizzle and holds the schema, the migration and the seed. `packages/api` is the tRPC router; a procedure takes a context and never a request. `apps/server` is the only place Fastify exists, and `apps/web` is the app, whose one transport decision is a function that returns HTTP links when a server URL is set and the in-process link when it is not. Every write a use case makes goes through a unit of work, which is one database transaction. `docs/architecture.md` has the diagrams: the packages and their imports, a question traced through the server and through the demo, the data model, the state machines, the pipeline, and how PGlite gets into the page.

## Layout

```
packages/domain    the rules, the ports, the use cases, the grounding pipeline; no framework and no database
packages/db        schema, migration, seed, the adapters over Drizzle, the search and the permission filter in SQL
packages/api       the tRPC router and the input schemas
apps/server        Fastify
apps/web           Next.js, static export; src/demo is the browser's database and transport; e2e the end-to-end runs
docs/              architecture, domain, API, decision records, screenshots
```

## Tests

```
pnpm test
pnpm build:web && pnpm test:e2e
```

`pnpm test` runs 411 tests across the five workspaces. Unit tests on the text rules, with property-based tests for the tokenizer, the sentence splitter, the chunker with and without headings, the packer, the composer, the meter and the rate limit; on money, passwords and cursors; the use cases on the in-memory ports, with a small world where every expectation is written out in full, the pipeline included (the answer, the citations, the usage rows, every refusal, a failing model, the tick); one contract test that both the in-memory and the Drizzle adapters pass, so a filter, a sort, a page, a search and a usage sum mean the same in both; a generated test that the permission filter in SQL agrees with the rule in code; retrieval tests on the seed; schema tests that prove the database refuses what it should; seed tests that check the invariants the pipeline keeps (chunks that cover their document, citations that quote it at their span, usage that adds up at the price in force, rights that hold); router tests on the middleware, the error mapping and the in-process stream; and integration tests over HTTP on the seed, with a real server on a free port: the access matrix (anonymous, member, admin, suspended, the admin of another workspace), the workflows, upload and ask with the answer streamed over SSE, the budget refusal, `runNow`, the ticker running the seed's due schedule, the forbidden transitions, the last-admin rule, cursor paging, and the rate limit on sign-in.

The web app's tests cover the stored session, the forms (what each refuses before sending, what it sends), the question box, the stream reducer, the message list with its citation chips and refusals, the viewer's segments, a schedule's cadence in words, the usage chart's series and scale, and the audit row's diff. The demo has its own: the in-process link against a small router, the session put back into a fresh database, and the demo database itself under Node.

The four end-to-end runs open the static export in demo mode in a real browser and do what a person would: ask a question and open the cited passage on the page, checking that the marked text is the quote; build an agent, publish it, ask to share it, approve it as the admin, and use it as a colleague; set the budget to nothing, read the refusal, raise it, and get an answer; invite someone, pass the token on, and join with it. They run last in CI, after the build.

## What is real and what is simulated

Real: the database and its constraints, the chunking, the retrieval, the citations, the permissions, the sessions, the metering and the budgets, the scheduler, both ways of running it. Simulated: the model. The answer is extractive, built from the sentences of the passages the retrieval found, so it reads as quoted lines and never paraphrases; the `Answerer` port is where a real client would go, and everything above it would keep its tests. The tokenizer is an approximation (one token per six characters of a word). No request ever leaves the machine.

The demo's one concession to living in a tab: its database is rebuilt from the seed on every load, so the session the browser kept is written back into it, for a user the seed knows, with an active membership, while it is live. On the server a session row outlives any reload and nothing of the kind exists. The sign-in rate limit and the CORS list are the server's and do not exist in the demo; the member rate limit and the budget are the domain's and do.

## Known limits and what comes next

Retrieval is word-based, so it misses synonyms and paraphrase, and the composer's threshold was chosen on the seed. Documents are text and Markdown only; PDF and Office files are out of scope. The member rate limit lives in memory per process, which is fine for one server and one tab and wrong for several server instances. Invitations are a token the admin passes on by hand; nothing sends email, and an expired invitation is only marked expired when someone tries to accept it. Expired sessions are never swept. Renaming a conversation writes no audit row. The tick runs the due schedules one after another, so a slow one delays the rest of that minute. A conversation over fifty messages shows its first fifty and a button for the next. The usage breakdowns show the top five by cost. On a phone, the schedules table and the runs scroll inside their frame instead of folding into a list as the other tables do. In the demo, the tick that runs on page load writes a few audit rows a minute old on every visit, since the schedules that fell due since the seed's date run then.

Next: a real model client behind the `Answerer` port, with the extractive one kept for the tests; embeddings beside the full-text index, so a paraphrased question still finds its passage; PDF ingestion through a text extractor into the same chunker; a sweep in the tick for expired sessions and invitations; email delivery for invitations.

## Licence

MIT.
