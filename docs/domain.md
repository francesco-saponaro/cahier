# The domain

What Cahier is about, in plain words: the things in it, the rules they follow, the states they move through, and how a question becomes a cited answer. The code that enforces all of this is `packages/domain`; this page is the version a person reads.

## Glossary

- **Workspace.** A team's own space: its members, libraries, agents, conversations, budget and settings. A user can belong to several, with a role in each; a session names the one in use.
- **Member and admin.** The two roles. A member works with their own things and what is shared with the workspace. An admin runs the place: members and invitations, which tools are on, the share inbox, the budget, the usage report, the audit log, retention. An admin reads every library and agent in the workspace, but never the text of anyone else's conversations.
- **Library.** A named set of documents owned by one member. Private at first; shared with the workspace by an approved request.
- **Document.** A text or Markdown page in a library, with a version number that goes up when its text is replaced.
- **Chunk.** A span of a document small enough to retrieve and pack: `document.body.slice(startChar, endChar)` is exactly its body. A chunk knows the headings above it and how many tokens it holds.
- **Agent.** A named assistant owned by a member. What it does lives in a **version**: instructions, model, context budget and the libraries it may read. One version is current; it is the one that answers.
- **Share request.** A member asking for a library or agent of theirs to be visible to the whole workspace. An admin approves or declines.
- **Conversation.** A member's exchange with one agent. Messages alternate user and assistant; each assistant message records the version and model that produced it.
- **Citation.** The `[n]` at the end of a line of an answer. It names a document, a version and a span, and stores the quoted text itself, so it survives the document being replaced or removed.
- **Usage event.** One row per kind of token (input, cached input, output) for each answer, with the price that was in force and the cost in micro-dollars.
- **Budget.** A workspace's cap for one month, in micro-dollars. Open while the month runs, closed after.
- **Scheduled prompt.** A question asked of an agent on a cadence (once, daily, weekly, monthly) at a time in a time zone, with a **run** per occurrence.
- **Audit entry.** Who did what to which thing, the fields before and after, and a reason when there was one. Every change writes one; the tick's changes have no actor.
- **Token.** The unit budgets and prices are counted in. Nothing here calls a model, so the count is an approximation: one token per six characters of a word, one per punctuation mark, none for whitespace. It is deterministic and additive, which is what the chunker, the packer and the meter need from it.
- **Micro-dollar.** A millionth of a dollar. Prices are integer micro-dollars per thousand tokens; costs are integers too, rounded half up once per usage row.

## The rules

**Reading.** A member reads a library or an agent when it is theirs, or shared with the workspace, or when they are an admin of that workspace. A thing the member may not read answers "not found", never "forbidden", so a colleague's private library cannot be probed by id. A member chats with an agent that is active, has a published version, and is theirs or shared; being an admin gives no extra agent.

**Changing.** The owner or an admin changes a library, its documents or an agent. Conversations and schedules are the member's own; nobody else, the admin included, reads or changes them.

**Sharing.** Only the owner of a private thing requests a share, one pending request at a time. Approving sets the visibility to `workspace`; declining needs a reason. An admin requesting a share of their own thing gets it at once. The inbox shows what approving an agent would expose: the libraries its current version reads, and which of those are themselves private. Visibility is checked when a question is asked, never when the share is approved, so a colleague using a shared agent still gets only the chunks they may read.

**Versions.** Saving an agent opens a draft (or rewrites the open one). Publishing retires the current version and makes the draft the one that answers. Rolling back republishes a retired version under its own number. A published version is never edited, so a conversation's record of which version answered stays true.

**Members.** The last active admin can be neither suspended nor demoted. Suspending someone ends their sessions at once. Invitations carry a token shown once to the admin, expire, and are accepted with a name and a password (or the password of an account that already exists).

**Documents.** Only `indexed` documents are retrieved. Replacing a document's text bumps its version and rewrites its chunks; citations made against the old text keep their quote and the version they quoted, and lose their link to the chunk. Removing a document removes its chunks; its citations keep their quotes.

**Metering.** A question is refused before anything is retrieved when the tool is off, when the model has no price in force, when the member is over their rate limit (20 questions and 40,000 tokens a minute, a token bucket per member), or when the month's budget does not leave room for the estimate (the question and instructions as input, the whole context budget as cached input, 256 tokens of answer). A month with no budget row has no cap. A refusal is a terminal message with its reason and writes no usage. After an answer, three usage rows are written at the prices in force at the message's instant; a failure while composing still meters the prompt and the context.

**Reconciliation.** The usage report recomputes everything from the rows: the plain sum, and the sums by model, by member, by agent and by day. The five must agree to the micro-dollar, and the report says whether they do.

## The state machines

Each one is a table in `packages/domain/src/transitions.ts`; a use case asks the table before writing, and a forbidden move is a `CONFLICT` with the reason `forbidden_transition`. Every move writes an audit entry.

| Thing | States and moves |
| --- | --- |
| Document | `uploaded` → `processing` → `indexed` \| `failed`; `indexed` \| `failed` → `processing` (replace or re-index) |
| Agent version | `draft` → `published` → `retired`; `retired` → `published` only through a roll-back |
| Agent | `active` → `archived` (final) |
| Share request | `requested` → `approved` \| `declined` \| `withdrawn` (all final) |
| Visibility | `private` ↔ `workspace` |
| Invitation | `sent` → `accepted` \| `revoked` \| `expired` (all final) |
| Membership | `active` ↔ `suspended` |
| Conversation | `active` → `archived` → `active` (restore) \| `deleted` (retention) |
| Message | `streaming` → `complete` \| `failed`; `refused` is created final |
| Scheduled prompt | `active` ↔ `paused`; `active` \| `paused` → `ended` |
| Run | `queued` → `running` → `succeeded` \| `failed`; `queued` → `skipped` \| `cancelled` |
| Budget month | `open` → `closed` |

## From a question to a cited answer

1. **Count.** Everything below is measured with the approximate tokenizer, so the pieces agree with each other.
2. **Chunk.** When a document is uploaded, replaced or re-indexed it is cut into chunks that follow the text. A Markdown heading opens a new chunk and sets the heading path. A paragraph that fits the budget of 320 tokens stays whole; a longer one is cut at sentence ends. The next chunk repeats the tail of the previous one, up to 40 tokens, so a sentence near a boundary is whole in at least one chunk; the tail never crosses a heading. Every chunk's body is exactly the document at its span, and together they cover every character of it.
3. **Index.** The database keeps a search vector per chunk, generated from the heading path (weight B) and the body (weight D) and indexed with GIN. It can never be out of step with the text.
4. **Retrieve.** The agent version's libraries are intersected with the ones the member may read, in SQL, by the twin of the same rule the use cases apply. The question becomes an OR of its words, each stemmed by the database; the chunks of indexed documents in those libraries that match are ranked with `ts_rank_cd`, the document's title weighted A on top of the stored vector, plus a bonus of 0.5 when the question's phrase (the longest quoted one, else its three longest consecutive words) appears verbatim in the body. The top 24 come back, ties broken by document and ordinal. A question of stop words only retrieves nothing.
5. **Pack.** The context budget is the version's `maxContextTokens` minus the prompt (instructions and question) minus 256 tokens kept for the answer. The best chunk of each document among the top five goes in first, so a second source is never crowded out; then chunks by score with at most three per document; then whatever still fits. A chunk whose span lies inside one already packed from the same document is dropped.
6. **Compose.** The `Answerer` port takes the question, the instructions and the packed chunks and answers text with citations. The adapter here is extractive: each sentence of each chunk is scored by how many of the question's terms it covers (stems compared by prefix); the sentences covering the most are taken first, none covering less than half of what the best one covers, until 120 tokens; they are ordered by document rank and position; consecutive sentences of one paragraph become one line; each line ends in `[n]` and `n` is its citation. If no sentence covers a term, the answer is refused with `no_sources`.
7. **Stream.** The answer is yielded piece by piece as `delta` events after `started`, then `citations`, then `done`; over HTTP as server-sent events, in the browser demo as the same async iterable.
8. **Meter.** The message goes `streaming` → `complete` with its three token counts; the three usage rows are written at the prices in force; the conversation's counts move. All of it in one unit of work with the citations, so a half-written answer never exists.

## Worked example, from the seed

Léa asks the Handbook helper (version 2, model Large 4, context 4,000 tokens, reading the shared Handbook): "How many days of paid leave do I earn a year?".

- The words that matter are `many`, `days`, `paid`, `leave`, `earn`, `year`; the phrase looked for verbatim is "How many days".
- Retrieval over the Handbook answers 24 chunks, 2,126 tokens in all. The best six are the sections of "Leave and time off": Paid leave (193 tokens, score 0.787), Family leave (95, 0.767), Sick leave (101, 0.714), Other absences (68, 0.667), the page's introduction (77, 0.630) and Public holidays (76, 0.630).
- The prompt is 45 tokens (the instructions and the question), so the context budget is 4,000 − 45 − 256 = 3,699 tokens and every retrieved chunk fits.
- The answer is three lines. The first quotes "Everyone earns 25 working days of paid leave a year, counted from 1 June to 31 May, which is the French reference period." and its citation is characters 344 to 465 of the document, version 1; the second quotes the two sentences on parental leave (1,916 to 2,178); the third quotes the carer's leave sentence (2,218 to 2,310). Each quote is exactly `body.slice(start, end)`, which is what the viewer highlights.
- Usage: 45 input tokens at 700 micro-dollars per thousand (32), 2,126 cached-input tokens at 70 (149), 121 output tokens at 2,100 (254): 435 micro-dollars, $0.000435, against Oriel's budget of $2 for the month.

Noor's one-off schedule "One-off: year-end leave" asks the same agent "What are the rules for leave between 20 December and 2 January?". When the tick finds it due, it opens a conversation as Noor titled after the schedule, runs the question through the pipeline, and records the run as `succeeded` with the conversation; the answer is one line, the skeleton-team sentence of the Paid leave section, cited; and the schedule ends because it was a one-off.

## The tick

The server runs the tick every minute (the browser demo on an interval). It has no actor. It closes the open budgets of months that have ended, deletes archived conversations older than their workspace's retention (the row stays with its counts and tokens; the messages and their citations go; usage rows keep their tokens and lose their message), and runs every active schedule whose next time has passed as a conversation of its owner, with the owner's rights at that moment. A run that is still running makes the next one `skipped`; a schedule whose tool has been switched off, or whose owner is no longer active, gets a `skipped` run with the reason; a `once` schedule ends after its run; the others get their next time in their time zone, across summer-time changes.
