# Architecture

How the pieces fit: the packages and what each may import, the path a question takes on the server and in the demo, the data model, the state machines, the grounding pipeline, and how the demo runs PostgreSQL in the page. The rules themselves are in `domain.md`; the procedures are in `api.md`; the reasons behind the choices are in `decisions/`.

## Components

Three packages and two apps in one pnpm workspace. The arrows are the only imports allowed; `packages/domain` imports nothing from the workspace and no framework.

```mermaid
flowchart TB
  subgraph apps
    server["apps/server<br/>Fastify, the router at /trpc"]
    web["apps/web<br/>Next.js static export"]
  end
  subgraph packages
    api["packages/api<br/>tRPC router, context, zod inputs"]
    db["packages/db<br/>Drizzle schema, migration, seed, adapters"]
    domain["packages/domain<br/>entities, rules, ports, use cases, grounding"]
  end
  server --> api
  server --> db
  web --> api
  web -. demo mode .-> db
  api --> domain
  db --> domain
```

`packages/domain` holds the entities, the text rules (the approximate tokenizer, sentence units, the chunker), money as micro-dollars, the twelve transition tables, the access rules, the grounding pipeline (terms, packing, the extractive composer behind the `Answerer` port, the meter, the rate limit), the ports (eighteen repositories, a unit of work, a clock, an id generator) as interfaces, an in-memory implementation of them for the tests, and the use cases as factories that take their ports. A use case returns a `Result`: `ok(value)` or `fail(code, message, reason)`, with six codes that map one to one onto tRPC error codes, so a refusal is a value that can travel to a screen without a server in between. `useCasesCreator` builds every use case once over one set of dependencies; the server and the demo each call it.

`packages/db` is the Drizzle schema (twenty-two tables, eighteen enums, the checks and unique constraints), the generated migration in `drizzle/` with the search vector and its GIN index, the hand-written corpus, the seed generator (about 13,500 coherent rows from a fixed seed), and `drizzlePortsCreator`, which implements the domain's ports over a Drizzle handle. The handle is node-postgres on the server and PGlite in the tests and in the browser; the adapters do not know which. The full-text search and the permission filter are SQL in this package.

`packages/api` is the tRPC v11 router: one procedure per use case, each input a zod schema, three kinds of procedure (public, member, admin), and `createContext`, which turns a bearer token into the actor. A procedure takes the context and never a request, so Fastify can serve the router and the demo can call it in-process. The web app imports the router's type and the input schemas from here.

`apps/server` is the server's composition root: the only folder where a Fastify request or reply exists. It connects to PostgreSQL, applies the migration, loads the seed when `SEED=1`, builds the use cases over the Drizzle adapters, mounts the router at `/trpc` with helmet, CORS from `WEB_ORIGIN` and a rate limit on `/trpc/auth.*`, and runs the tick every minute.

`apps/web` is the app. A screen asks hooks (TanStack Query through the tRPC query-options proxy); the hooks ask one tRPC client; the client's links are chosen in one function, `linksFor(token)`. With `NEXT_PUBLIC_API_URL` set the links are HTTP: the batch link with the bearer header for queries and mutations, the server-sent-events link with the token in the connection params for the streamed answer. With it empty the one link calls the router in-process on PGlite. Nothing above that function knows the difference.

## A question, on the server

`messages.send` from a signed-in member, as the code runs it. It is a tRPC subscription: the answer arrives as events over server-sent events.

```mermaid
sequenceDiagram
  participant S as Chat screen
  participant C as tRPC client
  participant F as Fastify (apps/server)
  participant R as router (packages/api)
  participant U as messages.send (packages/domain)
  participant P as Drizzle adapters (packages/db)
  participant DB as PostgreSQL

  S->>C: subscribe messages.send { conversationId, text }
  C->>F: GET /trpc/messages.send (EventSource, connectionParams.token)
  F->>R: createContext: hash the token, load the session, keep the actor
  R->>R: memberProcedure: signed in, active membership? parse the input
  R->>U: send(actor, conversationId, text)
  U->>P: the conversation, the agent, its current version
  U->>U: own conversation, active, agent usable
  U-->>R: ok(async iterable)
  U->>DB: BEGIN: insert the user message, update the conversation, COMMIT
  U-->>S: started
  U->>U: tool on? model priced? rate limit? budget?
  U->>P: chunks.search in the version's libraries ∩ readableIds(actor)
  P->>DB: ts_rank_cd over the search vector, the top 24
  U->>U: packContext under the context budget, compose the answer
  U->>DB: insert the assistant message as streaming
  loop every piece of the answer
    U-->>S: delta
  end
  U->>DB: BEGIN: message complete, citations, three usage rows, conversation counts, audit, COMMIT
  U-->>S: citations, then done
```

The checks run cheapest first and each one that fails is a refusal: a terminal message with its reason (`tool_off`, `no_price`, `rate_limited`, `budget_exhausted`, `no_sources`), an audit row, and no usage. Everything that lands at the end lands in one database transaction, through `unitOfWork.run`: the completed message, its citations, the three usage rows at the prices in force, the conversation's new counts and the audit row land together or not at all, so a half-written answer never exists. A model that throws marks the message `failed` and still meters the prompt and the context, since those tokens were spent.

The order of refusals for any procedure is fixed by the router: `UNAUTHORIZED` for no or a dead token, `FORBIDDEN` for a member on an admin procedure, both before the input is read; then `BAD_REQUEST` when the zod schema refuses the shape; then whatever the use case returns, `CONFLICT` for a move the state machine forbids or a duplicate, `PRECONDITION_FAILED` for a rule such as the last admin, `NOT_FOUND` for a record that does not exist or that the caller may not read. The error carries the rule's `reason` in its data, so a screen switches on it without parsing the message.

## The same question, in the demo

```mermaid
sequenceDiagram
  participant S as Chat screen
  participant C as tRPC client
  participant L as in-process link (apps/web/src/demo)
  participant R as router
  participant U as the same use cases
  participant P as the same adapters
  participant G as PGlite (in the page)

  S->>C: subscribe messages.send { conversationId, text }
  C->>L: the operation
  L->>L: await the page's database (opened when the page loaded)
  L->>R: createContext with the stored token as a bearer header
  L->>R: callTRPCProcedure(path, input, ctx, "subscription")
  R->>U: send(actor, conversationId, text)
  U->>P: the same calls
  P->>G: the same SQL
  U-->>L: the async iterable
  L-->>C: started, data…, stopped (the envelopes the SSE link gives)
  C-->>S: identical events
```

Everything from the router down is the same code the server runs. The link is the demo's whole transport: per operation it builds the context the server builds, calls the procedure with tRPC's own `callTRPCProcedure`, and puts the answer in the envelope the client expects; a subscription's async iterable becomes `started`, `data` and `stopped`, which is what the SSE link produces, so the chat folds the same events. Nothing is serialised in-process, so a `Date` stays a `Date`; an error goes through the router's own formatter, so `data.code` and `data.reason` are what the server would have sent. What the demo lacks is Fastify's: the sign-in rate limit, CORS and the request log. The member rate limit and the budget are the domain's and work in both.

## The data model

Twenty-two tables. Tokens are integers; money is `bigint` micro-dollars; prices are integer micro-dollars per thousand tokens with a validity range; every state is a PostgreSQL enum; times are `timestamptz`.

```mermaid
erDiagram
  workspaces ||--o{ memberships : "has"
  users ||--o{ memberships : "holds"
  users ||--o{ sessions : "signs in"
  workspaces ||--o{ invitations : "sends"
  models ||--o{ model_prices : "priced by"
  workspaces ||--o{ libraries : "keeps"
  users ||--o{ libraries : "owns"
  libraries ||--o{ documents : "holds"
  documents ||--o{ chunks : "cut into"
  workspaces ||--o{ agents : "keeps"
  users ||--o{ agents : "owns"
  agents ||--o{ agent_versions : "versioned as"
  agent_versions }o--o{ libraries : "reads (agent_version_libraries)"
  models ||--o{ agent_versions : "answers with"
  workspaces ||--o{ share_requests : "decides"
  workspaces ||--o{ conversations : "holds"
  users ||--o{ conversations : "owns"
  agents ||--o{ conversations : "answers"
  conversations ||--o{ messages : "has"
  messages ||--o{ citations : "cites"
  chunks |o--o{ citations : "cited (null after removal)"
  documents ||--o{ citations : "quoted from"
  messages ||--o{ usage_events : "metered as"
  models ||--o{ usage_events : "at the price of"
  workspaces ||--o{ budgets : "limits by month"
  workspaces ||--o{ scheduled_prompts : "runs"
  agents ||--o{ scheduled_prompts : "asked by"
  scheduled_prompts ||--o{ scheduled_runs : "ran as"
  conversations |o--o| scheduled_runs : "written by"
  workspaces ||--o{ audit_log : "records"
  users ||--o{ audit_log : "acts"
```

The relations that carry the product:

- A **membership** is a user in a workspace with a role (`member`, `admin`) and a standing (`active`, `suspended`); a user can hold several, and a **session** names the workspace it is in. The session row keeps only the SHA-256 of the token and an expiry.
- A **library** belongs to a workspace and an owner and is `private` or `workspace`; a **document** in it carries its text, a version number and a status, and its **chunks** carry `[start_char, end_char)` such that `body.slice(start, end)` is exactly the chunk's body, the heading path above it, a token count, and the generated search vector.
- An **agent** has versions; `current_version_id` names the one that answers. An **agent version** has instructions, a model, a context budget and the libraries it reads (the join table). Only the owner's own and the workspace-shared libraries can be chosen.
- A **share request** names a library or an agent and ends `approved`, `declined` or `withdrawn`; one open request per subject. Approval flips the subject's visibility.
- A **conversation** records the agent and the version that answered; a **message** is the user's or the assistant's, with its status, its three token counts and, when refused, the reason. A **citation** keeps the quote, the span and the document version it quoted, so the quote survives a replacement or a removal of the chunk.
- A **usage event** is one kind of token (`input`, `cached_input`, `output`) for one message at the price in force at that instant, with `micros_per_1k` snapshotted and `cost_micros` computed once. A **budget** is one month's limit for a workspace; the month's spend is the sum of its usage rows, never a column.
- A **scheduled prompt** asks an agent a question on a cadence in a time zone; each **run** records the outcome and the conversation it wrote.
- Every transition writes an **audit_log** row: actor, action, entity, before, after, reason.

The constraints the database enforces under the code: foreign keys on every relation above, `unique(email)`, `unique(workspace_id, user_id)` on memberships, `unique(workspace_id, slug)` on libraries and agents, `unique(agent_id, version)`, `unique(document_id, ordinal)` on chunks, `unique(conversation_id, ordinal)` on messages, `unique(message_id, index)` on citations, `unique(workspace_id, month)` on budgets, `unique(token_hash)` on sessions and invitations; `end_char > start_char` on chunks and citations, positive token counts on chunks, non-negative tokens and money everywhere, `valid_to > valid_from` on prices, `version >= 1` on documents and agent versions, retention between 1 and 3,650 days, emails stored lower-case, a refused message carrying a reason and no other message carrying one, a budget's month as `YYYY-MM`, a schedule's minute, weekday and day in range and present only when its cadence needs them. `test/schema.test.ts` proves the refusals.

## The state machines

Twelve, as tables in `packages/domain/src/transitions.ts`; a use case asks `move(table, entity, from, to)` before touching anything, so a forbidden move is a `CONFLICT` with the reason `forbidden_transition` and never a row.

```mermaid
stateDiagram-v2
  direction LR
  state Document {
    state "failed" as d_failed
    [*] --> uploaded
    uploaded --> processing
    processing --> indexed
    processing --> d_failed
    indexed --> processing : replace, re-index
    d_failed --> processing
  }
  state "Agent version" as V {
    [*] --> draft
    draft --> published
    published --> retired : a later version published
    retired --> published : roll-back only
  }
  state Message {
    state "failed" as m_failed
    [*] --> streaming
    [*] --> refused
    streaming --> complete
    streaming --> m_failed
  }
  state Run {
    state "failed" as r_failed
    [*] --> queued
    queued --> running
    running --> succeeded
    running --> r_failed
    queued --> skipped
    queued --> cancelled
  }
```

The others: an agent goes `active → archived`; a share request goes `requested → approved | declined | withdrawn`; a library's or an agent's visibility goes `private ↔ workspace`; an invitation goes `sent → accepted | revoked | expired`; a membership goes `active ↔ suspended`; a conversation goes `active → archived → active | deleted`; a scheduled prompt goes `active ↔ paused` and either `→ ended`; a budget month goes `open → closed`. `domain.md` has each with its rules.

## The grounding pipeline

From a document to a cited answer. The chunker runs at upload; the rest runs at every question.

```mermaid
flowchart LR
  doc["document<br/>(text or Markdown)"] --> chunk["chunk<br/>headings open a chunk, 320 tokens,<br/>sentence ends, a 40-token tail"]
  chunk --> index["index<br/>generated tsvector, GIN"]
  q["question"] --> checks{"tool on? priced?<br/>rate limit? budget?"}
  checks -- no --> refused["refused, with the reason"]
  checks -- yes --> retrieve["retrieve<br/>ts_rank_cd in the version's libraries<br/>∩ what the member may read, top 24"]
  index --> retrieve
  retrieve --> pack["pack<br/>best of each document first,<br/>three per document, then what fits"]
  pack --> compose["compose<br/>the sentences covering the most terms,<br/>one line per passage with [n]"]
  compose -- nothing covers a term --> refused
  compose --> stream["stream<br/>started, delta…, citations, done"]
  stream --> meter["meter<br/>three usage rows at the price in force,<br/>in one transaction with the citations"]
```

Two properties hold it together. Every chunk and every citation is exactly `document.slice(start, end)`, so what the chat quotes is what the viewer highlights. And the permission filter in SQL (`libraries.readableIds`) is the twin of the rule in code (`canReadLibrary`); a generated test proves the two agree, so retrieval can never see a library the member could not open.

## Demo mode

The live demo is the static export of the web app with `NEXT_PUBLIC_API_URL` empty. There is no server behind it.

```mermaid
flowchart TB
  subgraph build ["pnpm build:web"]
    assets["scripts/demo-assets.mjs<br/>copies drizzle/0000_tables.sql into public/demo/"]
    export["next build (output: export)<br/>static HTML per route; PGlite's WebAssembly<br/>and data bundle shipped by the bundler"]
    assets --> export
  end
  subgraph page ["in the browser, as the page opens"]
    fetch["fetch /demo/0000_tables.sql"]
    engine["new PGlite(), waitReady"]
    migrate["exec the committed migration"]
    seed["generateSeed() → seedDatabase()"]
    restore["write the kept session back<br/>so a reload stays signed in"]
    tick["tick now, then every minute"]
    fetch --> engine --> migrate --> seed --> restore --> tick
  end
  export --> page
  tick --> link["inProcessLink over the router,<br/>use cases over drizzlePortsCreator(db)"]
```

PGlite's loader finds its WebAssembly and data bundle with `new URL(…, import.meta.url)`, which the bundler understands and ships as hashed static files, so only the migration is copied. One database per page, as a promise with a status beside it, started by the session provider when the page opens instead of at the first call, so the sign-in page can say "loading" and "ready". The database is rebuilt from the seed on every load; the session the browser kept is written back into it for a user the seed knows with an active membership while the copy is live, which is the one thing the demo does that the server does not. The data lives until the tab is closed.

## Tests, by layer

| Layer | Runner | Against | What |
| --- | --- | --- | --- |
| `packages/domain` | Vitest, fast-check | in-memory ports | the text rules as properties (tokenizer, sentences, chunker, packer, composer, meter, rate limit), money, passwords, cursors, the transition tables, the access rules, every use case including the pipeline and the tick, the ports' contract |
| `packages/db` | Vitest | PGlite | the schema's refusals, the adapters through the same contract test as the in-memory ports, the search on the seed, the SQL permission filter against the rule in code on generated cases, the seed's determinism, coherence and reconciliation |
| `packages/api` | Vitest | in-memory ports | the middleware, the error mapping, the in-process stream |
| `apps/server` | Vitest | PGlite with the seed, over HTTP | the access matrix, the workflows, upload and ask over SSE, the budget refusal, `runNow`, the ticker, forbidden transitions, the last admin, cursor paging, the sign-in rate limit |
| `apps/web` | Vitest, Testing Library, jsdom | in-memory ports and a small router | the forms, the question box, the stream reducer, the message list, the viewer's segments, the cadence, the chart's series, the audit diff; the in-process link, the session restore, the demo database under Node |
| `apps/web/e2e` | Playwright | the demo build in Chromium | ask and cite; build, share, approve, use; the budget refusal and recovery; invite and join |

`pnpm test` runs the first five; `pnpm build:web && pnpm test:e2e` the last.
