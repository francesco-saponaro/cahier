# 9. The demo calls the router in-process on PostgreSQL in the page

Date: 2026-11-24

## Context

The live demo is a static site with no server behind it, and decision 0001 promised that it would run the real code path: the same router, the same use cases, the same migrations and seed, on PGlite (PostgreSQL compiled to WebAssembly). The web app was built in session four against a tRPC client whose links are chosen in one function, `linksFor(token)`. What was missing was a transport that reaches a router living in the same tab, and a way to load PostgreSQL under Next's static export.

## Options considered

1. **A fetch handler behind the HTTP links.** Keep `httpBatchLink` and `httpSubscriptionLink` and give them a `fetch` that routes to tRPC's fetch adapter in-process. Queries and mutations would be serialised and parsed as on the wire; the subscription link wants an `EventSource`, which would have to be faked over the same handler, and server-sent events would be produced and parsed in the same tab for nothing.
2. **A mock client.** Hand-written answers per procedure. Not the real code path, which is what the demo is for.
3. **One custom link that calls the router.** For every operation, build the context the server builds (the use cases and the actor behind the bearer token), call the procedure with tRPC's own `callTRPCProcedure`, and put the output in the envelope the client expects. A subscription's async iterable becomes the `started`, `data` and `stopped` envelopes the SSE link produces, so the chat folds the same events. An error goes through the router's error formatter, so `data.code` and `data.reason` are what the server would have sent.

For loading PGlite: copy its WebAssembly module and data bundle into `public/` at build time and pass them in by hand, as planned; or let the bundler handle PGlite's own `new URL("pglite.wasm", import.meta.url)` and ship them as hashed static files. The second was tried first and worked: Turbopack emits the three files under `_next/static/media` and PGlite finds them. Only the migration is copied, by a small script before `next build`, because the SQL is a file of `packages/db` and the app fetches it at runtime rather than bundling it as text.

## Decision

Option 3, in `apps/web/src/demo/`. `link.ts` is the transport; `database.ts` opens PGlite, applies the committed migration, loads the seed and builds the ports and use cases over the result; `store.ts` keeps one database per page with a status the sign-in page can show; `session.ts` puts the stored session back into the fresh database (the row the server would still hold is gone with the old one) for a user the seed knows, with an active membership, while the session is live; `index.ts` ties them together and runs the scheduler's tick once on load and every minute, as the server does. `linksFor` returns these links when `NEXT_PUBLIC_API_URL` is empty. Nothing above that function changed.

## Consequences

Every screen runs unchanged against the server and in the demo; the only code that knows which is which is one function and the sign-in page's line about it. Values cross the link unserialised, so a `Date` stays a `Date`, and the link's test says so. The database lives in memory: a reload starts from the seed again, and the restored session is the one concession to that (what the person created is gone, as the sign-in page says). Opening the demo costs the download of about nine megabytes of PostgreSQL and a few seconds of seeding, which starts when the page opens rather than at the first call. The rate limit on sign-in and the CORS list are the server's and do not exist in the demo; the member rate limit and the budget are the domain's and do.
