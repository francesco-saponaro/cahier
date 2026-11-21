# 3. Opaque bearer sessions, hashed in the table, not cookies and not JWTs

Date: 2026-11-21

## Context

The web app is a static site on Netlify talking to an API on another origin, and in demo mode there is no server at all: the router runs in the browser against PGlite. Sign-in has to work in both. A session must be revocable (suspending a member ends their access at once) and must name the workspace the person is working in, since a user can belong to several.

## Options considered

1. **A session cookie.** The browser handles it, but it needs the API and the app on one site (or `SameSite=None` with CORS credentials and a CSRF defence), and a cookie means nothing when the router runs in-process in the browser.
2. **A signed JWT.** Stateless and easy to send as a bearer header, but not revocable before it expires without a denylist, which is a session table by another name; and the claims (role, workspace) go stale the moment an admin changes them.
3. **An opaque random token sent as `Authorization: Bearer`, with its SHA-256 in a `sessions` row** that carries the user, the workspace and an expiry. Every call reads the row and the membership, so a suspension or a role change applies on the next request.

## Decision

Option 3. `auth.signIn` draws 48 random alphanumerics, stores `sha256(token)`, and answers the token once. The context builder hashes the header's token, finds the live row, then finds the membership in the session's workspace; the actor is that user with that role, and only while the membership is `active`. Switching workspaces rewrites the row. Signing out deletes it. Invitation tokens follow the same shape.

The web app keeps the token in storage, which a cookie would have hidden from scripts; the API refuses cross-origin callers except the one web origin, sends `no-referrer`, and never puts the token in a URL. The sign-in procedures are rate limited by IP.

## Consequences

One database read per call for the session and one for the membership, which an index on `token_hash` and the unique `(workspace_id, user_id)` make cheap. A leaked `sessions` table gives nobody a session, because only hashes are stored. Expired rows are not swept yet (a later cleanup job). The demo shares all of this code: in the browser, the same `authenticate` runs against PGlite, so the demo's sign-in is the real one.
