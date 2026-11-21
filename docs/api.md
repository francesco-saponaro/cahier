# The API

Cahier's API is a tRPC v11 router (`packages/api`). The server (`apps/server`) serves it at `/trpc` with the Fastify adapter; the browser demo calls the same router in-process. Inputs and outputs travel as JSON through superjson, so dates arrive as `Date`s on both sides. The web app imports the router's type and the zod input schemas, so a form refuses exactly what the API refuses.

## Calling it

Queries are `GET /trpc/<procedure>?input=<superjson>`, mutations `POST /trpc/<procedure>` with the superjson body; the tRPC client does this. A signed-in call carries `Authorization: Bearer <token>`. The token is the one `auth.signIn` or `auth.acceptInvitation` answered; the server keeps only its SHA-256, in `sessions.token_hash`, with an expiry (`SESSION_HOURS`, 72 by default). A session names a workspace; the actor behind every call is the session's user with the role their membership in that workspace gives them, as long as the membership is active. A suspended member's token stops working at once.

Procedures marked **public** need no token. **member** needs an active membership in the session's workspace. **admin** needs that membership's role to be `admin`. A thing the caller may not read answers `NOT_FOUND`, not `FORBIDDEN`, so a colleague's private library or agent cannot be probed by id; a thing they may read but not change answers `FORBIDDEN`.

## Errors

A failed call is a tRPC error with `data.code` and `data.reason`:

| `code` | Meaning | `reason` examples |
| --- | --- | --- |
| `BAD_REQUEST` | The input failed its zod schema, or a value rule in the use case (an empty name, a budget over the model's context, a time zone that does not exist). | – |
| `UNAUTHORIZED` | No token, an unknown or expired token, a suspended membership, or a wrong email or password. | – |
| `FORBIDDEN` | Signed in, but not allowed: a member on an admin procedure, a colleague changing someone else's library. | `no_active_membership` on sign-in |
| `NOT_FOUND` | No such thing, or one the caller may not read. | – |
| `CONFLICT` | A forbidden transition or a duplicate. | `forbidden_transition`, `already_member`, `already_invited`, `already_shared`, `already_requested`, `agent_archived`, `invitation_decided`, `month_closed` |
| `PRECONDITION_FAILED` | A rule of the domain refused the change. | `last_admin`, `past_month`, `invitation_expired`, `tool_off`, `agent_unusable` |

`reason` is `null` when there is nothing more specific than the code.

## Pages

Every list takes `limit` (1 to 50, 20 by default) and `cursor` (the `nextCursor` of the previous page, or nothing for the first) and answers `{ items, nextCursor }`. `nextCursor` is `null` on the last page. A cursor is opaque and names the last row seen; it is only valid for the same list with the same filters and sort.

## Procedures

### `health`

| Procedure | Kind | Auth | Input | Answers |
| --- | --- | --- | --- | --- |
| `health` | query | public | – | `{ ok: true }` |

### `auth`

| Procedure | Kind | Auth | Input | Answers |
| --- | --- | --- | --- | --- |
| `auth.signIn` | mutation | public | `{ email, password }` | `{ token, expiresAt, user, workspace, role }`; the session is opened in the oldest active workspace. `UNAUTHORIZED` for a wrong email or password (the same answer for both); `FORBIDDEN`/`no_active_membership` when every membership is suspended. Rate limited by IP: 20 attempts a minute, then `429`. |
| `auth.signOut` | mutation | member | – | `{ ok: true }`; the session row is deleted. |
| `auth.me` | query | member | – | `{ user, workspace, role, tools, workspaces: [{ id, slug, name, role }] }` |
| `auth.acceptInvitation` | mutation | public | `{ token, name, password }` | Like `signIn`, in the invitation's workspace. A new account is created with the password (10 characters or more, not one of the common ones); an existing account joins with its own password. `NOT_FOUND` for an unknown token, `CONFLICT`/`invitation_decided`, `PRECONDITION_FAILED`/`invitation_expired` (the invitation is marked expired). |
| `auth.switchWorkspace` | mutation | member | `{ workspaceId }` | The `me` of the new workspace; the session is rewritten. `FORBIDDEN` without an active membership there. |

### `conversations` and `messages` (the member's own; nobody else reads them, the admin included)

| Procedure | Kind | Auth | Input | Answers |
| --- | --- | --- | --- | --- |
| `conversations.list` | query | member | `{ status: active \| archived, q?, limit?, cursor? }` | A page of conversations with `agentName`, latest message first. Deleted ones are never listed. |
| `conversations.get` | query | member | `{ id }` | `{ conversation, agentName }` |
| `conversations.create` | mutation | member | `{ agentId }` | The new conversation, titled "New conversation", recording the agent's current version. `PRECONDITION_FAILED`/`agent_unusable` when the agent is archived, unpublished or not the caller's to use. |
| `conversations.rename` | mutation | member | `{ id, title }` | The conversation. 1 to 120 characters. |
| `conversations.archive` | mutation | member | `{ id }` | The conversation, `archived` with `archivedAt`. |
| `conversations.restore` | mutation | member | `{ id }` | The conversation, `active` again. |
| `messages.list` | query | member | `{ conversationId, limit?, cursor? }` | A page of messages by ordinal, each with its `citations` by index. |

`messages.send` (the streamed answer) lands with the grounding pipeline.

### `libraries` and `documents`

| Procedure | Kind | Auth | Input | Answers |
| --- | --- | --- | --- | --- |
| `libraries.list` | query | member | `{ scope: own \| shared \| all, q?, sort: name \| newest \| updated, limit?, cursor? }` | A page of libraries with `ownerName`, `documentCount`, `indexedCount`. `all` is for admins (`FORBIDDEN` otherwise). |
| `libraries.get` | query | member | `{ id }` | `{ library, ownerName, pendingShare }` for a library the caller may read: own, shared with the workspace, or any in the workspace for an admin. |
| `libraries.create` | mutation | member | `{ name, description }` | The new private library; the slug comes from the name and is made unique in the workspace (`handbook`, `handbook-2`). |
| `libraries.update` | mutation | member | `{ id, name?, description? }` | The library. Owner or admin. |
| `libraries.remove` | mutation | member | `{ id }` | `{ ok: true }`. Owner or admin. Its documents and chunks go; past citations keep their quotes. |
| `documents.list` | query | member | `{ libraryId, status?, q?, sort: newest \| title, limit?, cursor? }` | A page of documents without their text, for a library the caller may read. |
| `documents.get` | query | member | `{ id }` | `{ document, library, chunks }`: the text and the chunks by ordinal with their spans and heading paths. |
| `documents.remove` | mutation | member | `{ id }` | `{ ok: true }`. The library's owner or an admin. |

`documents.upload`, `.replace` and `.reindex` land with the ingestion.

### `agents`

| Procedure | Kind | Auth | Input | Answers |
| --- | --- | --- | --- | --- |
| `agents.list` | query | member | `{ scope, q?, sort: name \| newest, limit?, cursor? }` | A page of agents with `ownerName`, `currentVersion`, `versionCount`. |
| `agents.get` | query | member | `{ id }` | `{ agent, ownerName, versions: [...with libraryIds], pendingShare }` |
| `agents.create` | mutation | member | `{ name, description, instructions, modelId, maxContextTokens, libraryIds }` | `{ agent, version }`: a private active agent with version 1 as a draft. The model must exist and be enabled, the budget between 512 and the model's context, every library one the caller may read (`FORBIDDEN` otherwise). |
| `agents.saveDraft` | mutation | member | `{ agentId, ...the fields above }` | The draft: the open one rewritten, or the next version number opened. Owner or admin; `CONFLICT`/`agent_archived`. |
| `agents.publish` | mutation | member | `{ versionId }` | The version, `published`; the previous current one is `retired`; the agent's `currentVersionId` moves. Only a draft publishes (`CONFLICT`/`forbidden_transition` otherwise). |
| `agents.rollBack` | mutation | member | `{ versionId }` | A `retired` version `published` again under its own number; the current one is retired. |
| `agents.archive` | mutation | member | `{ id }` | The agent, `archived`. Final. |

### `shares`

| Procedure | Kind | Auth | Input | Answers |
| --- | --- | --- | --- | --- |
| `shares.request` | mutation | member | `{ kind: library \| agent, id }` | The request, `requested`. Only the owner of a private thing; `CONFLICT`/`already_shared` or `already_requested`. An admin's request on their own thing is `approved` at once and the thing is shared. |
| `shares.withdraw` | mutation | member | `{ id }` | The request, `withdrawn`. The requester only, while `requested`. |
| `shares.listMine` | query | member | `{ limit?, cursor? }` | A page of the caller's requests with `subjectName`, newest first. |
| `shares.unshare` | mutation | member | `{ kind, id }` | `{ ok: true }`: visibility back to `private`. The owner or an admin. |
| `shares.approve` | mutation | admin | `{ id }` | The request, `approved`; the subject's visibility becomes `workspace`. |
| `shares.decline` | mutation | admin | `{ id, reason }` | The request, `declined` with the reason (needed). |
| `admin.shares.inbox` | query | admin | `{ status?, limit?, cursor? }` | A page of requests with `subjectName`, `requesterName` and `exposes`: for an agent, the libraries its current version reads with their visibility, so the admin sees which private ones it would answer from. |

### `schedules`

| Procedure | Kind | Auth | Input | Answers |
| --- | --- | --- | --- | --- |
| `schedules.list` | query | member | `{ limit?, cursor? }` | A page of the caller's schedules with `agentName`, newest first. |
| `schedules.get` | query | member | `{ id }` | `{ schedule, agentName, runs }`, runs latest first. |
| `schedules.create` | mutation | member | `{ agentId, name, prompt, cadence: once \| daily \| weekly \| monthly, atMinute, weekday, dayOfMonth, timezone }` | The schedule, `active`, with `nextRunAt` computed in its time zone. `PRECONDITION_FAILED`/`tool_off` when the workspace has scheduled prompts off; `agent_unusable` as for conversations; `weekday` (0 to 6) for weekly, `dayOfMonth` (1 to 28) for monthly. |
| `schedules.pause` | mutation | member | `{ id }` | The schedule, `paused`, `nextRunAt` null. |
| `schedules.resume` | mutation | member | `{ id }` | The schedule, `active`, `nextRunAt` computed again. |
| `schedules.end` | mutation | member | `{ id }` | The schedule, `ended`. Final. |

`schedules.runNow` and the tick that runs them land with the pipeline.

### `usage`

| Procedure | Kind | Auth | Input | Answers |
| --- | --- | --- | --- | --- |
| `usage.mine` | query | member | `{ month: YYYY-MM }` | `{ month, tokens, costMicros, byKind: { input, cached_input, output } }` for the caller. |
| `admin.usage.report` | query | admin | `{ month }` | `{ month, total: { rows, tokens, costMicros }, byModel, byMember, byAgent, byDay, budget, reconciliation }`. Each group is `{ key, label, tokens, costMicros }`; `budget` is `{ limitMicros, spentMicros, remainingMicros, status }` or null; `reconciliation` gives the cost summed five ways and `agree`, true when they are all equal. Costs are integer micro-dollars. |

### `admin.members`

| Procedure | Kind | Auth | Input | Answers |
| --- | --- | --- | --- | --- |
| `admin.members.list` | query | admin | `{ status?, role?, q?, limit?, cursor? }` | A page of memberships with `user` (never the password hash), by name. `q` matches the name or the email. |
| `admin.members.invitations` | query | admin | `{ status?, limit?, cursor? }` | A page of invitations, newest first. |
| `admin.members.invite` | mutation | admin | `{ email, role }` | `{ invitation, token }`. The token is answered once, for the admin to pass on (there is no email delivery); only its hash is kept. Expires after 7 days. `CONFLICT`/`already_member` or `already_invited`. |
| `admin.members.revokeInvitation` | mutation | admin | `{ id }` | The invitation, `revoked`. |
| `admin.members.suspend` | mutation | admin | `{ membershipId }` | The membership, `suspended`; the person's sessions in the workspace end. `PRECONDITION_FAILED`/`last_admin` for the last active admin. |
| `admin.members.reinstate` | mutation | admin | `{ membershipId }` | The membership, `active`. |
| `admin.members.setRole` | mutation | admin | `{ membershipId, role }` | The membership. Demoting the last active admin is `last_admin`. The same role again changes nothing. |

### `admin.settings`, `admin.budgets`, `admin.audit`

| Procedure | Kind | Auth | Input | Answers |
| --- | --- | --- | --- | --- |
| `admin.settings.get` | query | admin | – | `{ workspace, tools, retentionDays, budgets }`, budgets latest month first. |
| `admin.settings.update` | mutation | admin | `{ tools?: { groundedAnswers?, scheduledPrompts?, uploads? }, retentionDays? }` | The workspace. Retention is 1 to 3650 days. |
| `admin.budgets.set` | mutation | admin | `{ month, limitMicros }` | The budget row, created or raised in place. `PRECONDITION_FAILED`/`past_month` before the current month; `CONFLICT`/`month_closed` on a closed month. |
| `admin.audit.list` | query | admin | `{ entityKind?, entityId?, actorId?, action?, limit?, cursor? }` | A page of audit rows with `actorName` (null when the system acted), latest first. Every change above writes one: `invitation.sent`, `membership.suspended`, `library.created`, `agent_version.published`, `share.approved`, `budget.set`, and so on, with the fields before and after. |

## Headers

Every answer carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and no `X-Powered-By`. CORS allows the one origin in `WEB_ORIGIN` and no other.
