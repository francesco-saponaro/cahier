# 1. Three packages, two apps, and the same router at both entry points

Date: 2026-11-18

## Context

Cahier has to run in two places with the same code: as a Fastify server over PostgreSQL under `docker compose`, and inside the browser for the demo on Netlify, where there is no server at all. The web app's forms must refuse what the API refuses. If the rules lived in route handlers or in React components, neither would be possible.

## Options considered

1. **One Next.js app with route handlers.** The simplest to start; Next's route handlers do not exist in a static export, so the demo would need a second implementation of every procedure, and the rules would be tied to the framework.
2. **A framework-free tRPC router in its own package, served by Fastify, and called in-process in the browser.** The router's procedures take a context (the database handle, the session, the clock) and never see a request object. The server mounts it with the Fastify adapter; the demo build creates a tRPC link that calls the router directly on PGlite.
3. **A separate REST API and a hand-written client.** Two sets of types to keep in step, and no end-to-end typing.

## Decision

Option 2. The packages:

- `packages/domain`: text (the tokenizer, sentences, the chunker, later the ranking, packing and composition), money, passwords, access rules and the transition tables. No framework, no database, no I/O.
- `packages/db`: the Drizzle schema, the migrations, the seed generator and the repository adapters over a Drizzle handle, which is node-postgres on the server and PGlite in tests and in the browser.
- `packages/api`: the tRPC router and its zod inputs, which the web app imports for its forms.
- `apps/server`: Fastify, the only place a request or reply object exists.
- `apps/web`: Next.js with `output: "export"`, talking to the server over HTTP when `NEXT_PUBLIC_API_URL` is set and to the in-process router on PGlite otherwise.

## Consequences

Two entry points to keep in step, which the end-to-end tests on the demo build check. The router cannot use anything that only exists on a server (file streams, process signals); it does not need to. In return, every procedure is written once, typed end to end, and runs unchanged on the server and in the browser.
