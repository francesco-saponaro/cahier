# 8. Ids travel in the query string, because a static export cannot enumerate them

Date: 2026-11-23

## Context

The web app is a Next.js static export: the demo on Netlify is files only, and the same build talks to the server when `NEXT_PUBLIC_API_URL` is set. Nearly every screen opens one object by id: a conversation, a document at a cited span, a library, an agent. In the App Router a dynamic segment (`/agents/[id]`) needs `generateStaticParams` at build time, and the ids live in the database, not in the build.

## Options considered

1. **Dynamic segments with a placeholder** (`generateStaticParams` returning one dummy id, the real one read on the client). Works with a rewrite rule on the host, breaks on a plain file server and reads as a trick.
2. **Hash routing** (`/agents#id`). Invisible to the server and to link prefetching, and the back button and `useSearchParams` fight it.
3. **Query strings on fixed routes** (`/agents/edit?id=`, `/documents/view?id=&from=&to=&v=`). Every route is a real file in the export; the id is read on the client with `useSearchParams`.

## Decision

Option 3. Seven routes tonight, thirteen by the end, each a file. A page that reads the query string wraps its screen in a `Suspense` boundary, which the static export requires for `useSearchParams`, and renders nothing until the client has the parameters. A citation's link carries everything the viewer needs to highlight the span without a second lookup: the document, the start and end characters, the version cited.

## Consequences

Links are a little longer and the viewer cannot be pre-rendered per document, which a static site could not do anyway. `public/_redirects` sends unknown paths to `/index.html` so a deep link still boots the app. The same routes work unchanged against the server and in the demo, which is the point: the session-five demo link replaces the transport, not the pages.
