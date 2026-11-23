"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { describe } from "../../api/errors";
import { useTRPC, useTRPCClient } from "../../api/trpc";
import { useSession } from "../../auth/SessionProvider";
import { ago, count, dollars, plural, tokens } from "../../lib/format";
import { Button, Empty, Input, SearchIcon, Skeleton } from "../../ui/primitives";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { IDLE, reduce, type StreamState } from "./stream";

/*
 * The chat: the conversations in a column, the open one beside it with the streamed answer and
 * its citations, and the agent's details in a rail on a wide screen. The question this screen
 * answers is "what do the documents say, and where?", so the thread is the biggest thing and
 * the composer is one keystroke away. Ids travel in the query string (`?c=`): the static export
 * cannot enumerate them.
 */

export function ChatScreen() {
  const params = useSearchParams();
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [q, setQ] = useState("");
  const list = useConversationList(status, q);
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const starting = params.get("new") === "1";
  // With no conversation named, the latest active one opens (on a wide screen; a phone shows the list first).
  const conversationId = params.get("c") ?? (starting ? null : (items[0]?.id ?? null));
  const view = params.get("c") || starting ? "thread" : "list";
  // One h1 per view: the column's when the list is the screen, the open thread's when it is.
  return (
    <div className="chat with-aside" data-view={view}>
      <ConversationColumn selected={params.get("c")} status={status} setStatus={setStatus} q={q} setQ={setQ} query={list} items={items} heading={view === "list" ? "h1" : "h2"} />
      {conversationId ? <Thread key={conversationId} conversationId={conversationId} heading={view === "thread" ? "h1" : "h2"} /> : list.isPending && !starting ? <section className="thread" aria-label="Conversation" /> : <AgentPicker heading={view === "thread" ? "h1" : "h2"} />}
      {conversationId ? <Aside conversationId={conversationId} /> : <NewAside />}
    </div>
  );
}

type Heading = "h1" | "h2";

interface ColumnProps {
  selected: string | null;
  status: "active" | "archived";
  setStatus: (s: "active" | "archived") => void;
  q: string;
  setQ: (q: string) => void;
  query: ReturnType<typeof useConversationList>;
  items: ConversationItem[];
  heading: Heading;
}

type ConversationItem = { id: string; title: string; agentName: string; messageCount: number; lastMessageAt: Date };

function useConversationList(status: "active" | "archived", q: string) {
  const trpc = useTRPC();
  return useInfiniteQuery(trpc.conversations.list.infiniteQueryOptions({ status, q: q || undefined, limit: 30 }, { getNextPageParam: (last) => last.nextCursor }));
}

function ConversationColumn({ selected, status, setStatus, q, setQ, query, items, heading: H }: ColumnProps) {
  const { session } = useSession();
  return (
    <section className="list-col" aria-label="Conversations">
      <div className="head">
        <div className="row1">
          <H className="col-title">Conversations</H>
          <Link href="/chat?new=1" className="btn primary sm">
            New
          </Link>
        </div>
        <div className="tabs" role="tablist" aria-label="Which conversations">
          <button type="button" role="tab" aria-selected={status === "active"} onClick={() => setStatus("active")}>
            Active
          </button>
          <button type="button" role="tab" aria-selected={status === "archived"} onClick={() => setStatus("archived")}>
            Archived
          </button>
        </div>
        <div className="search">
          <SearchIcon />
          <Input className="sm" type="search" aria-label="Search conversations" placeholder="Search by title" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <p className="muted small" style={{ marginBottom: 4 }}>
          {session?.workspace.name} · {query.isPending ? "…" : `${plural(items.length, "conversation")}${query.hasNextPage ? " shown" : ""}`}
        </p>
      </div>
      <div className="scroll">
        {query.isPending ? (
          <div style={{ display: "grid", gap: 8, padding: 8 }}>
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </div>
        ) : query.isError ? (
          <Empty>Could not load the conversations: {describe(query.error).message}</Empty>
        ) : items.length === 0 ? (
          <Empty>{q ? "No conversation has that in its title." : status === "active" ? "No conversations yet. Start one with an agent." : "Nothing archived."}</Empty>
        ) : (
          items.map((c) => (
            <Link key={c.id} href={`/chat?c=${encodeURIComponent(c.id)}`} className="convo" aria-current={c.id === selected ? "true" : undefined}>
              <span className="line1">
                <span className="title">{c.title}</span>
                <span className="time">{ago(c.lastMessageAt)}</span>
              </span>
              <span className="line2">
                {c.agentName} · {plural(c.messageCount, "message")}
              </span>
            </Link>
          ))
        )}
        {query.hasNextPage ? (
          <div style={{ padding: 8 }}>
            <Button small onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              Show more
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Starting a conversation: the agents this person may use, with what each one reads. */
function AgentPicker({ heading: H }: { heading: Heading }) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const router = useRouter();
  const own = useQuery(trpc.agents.list.queryOptions({ scope: "own", sort: "name", limit: 50 }));
  const shared = useQuery(trpc.agents.list.queryOptions({ scope: "shared", sort: "name", limit: 50 }));
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (agentId: string) => client.conversations.create.mutate({ agentId }),
    onSuccess: (c) => router.push(`/chat?c=${encodeURIComponent(c.id)}`),
    onError: (e) => setError(describe(e).message),
  });
  const agents = useMemo(() => {
    const seen = new Set<string>();
    return [...(own.data?.items ?? []), ...(shared.data?.items ?? [])].filter((a) => a.status === "active" && a.currentVersion !== null && !seen.has(a.id) && seen.add(a.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [own.data, shared.data]);
  return (
    <section className="thread" aria-label="New conversation">
      <div className="head">
        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/chat" className="btn ghost sm back" aria-label="Back to the conversations">
            ←
          </Link>
          <div style={{ minWidth: 0 }}>
            <H className="thread-title">New conversation</H>
            <p className="sub">Pick the agent to ask. Each one reads the libraries its published version names.</p>
          </div>
        </div>
      </div>
      <div className="scroll">
        {error ? <p className="alert" style={{ maxWidth: 760, marginBottom: 12 }}>{error}</p> : null}
        {own.isPending || shared.isPending ? (
          <div className="picker">
            <Skeleton height={72} />
            <Skeleton height={72} />
          </div>
        ) : agents.length === 0 ? (
          <Empty>
            No agent is ready to answer. <Link href="/agents/edit" className="link">Build one</Link> and publish a version.
          </Empty>
        ) : (
          <div className="picker">
            {agents.map((a) => (
              <button key={a.id} type="button" className="pick" onClick={() => create.mutate(a.id)} disabled={create.isPending}>
                <span className="line1">
                  <span className="name">{a.name}</span>
                  <span className="muted small">{a.visibility === "workspace" ? "Shared with the workspace" : "Private"}</span>
                </span>
                <span className="sub">
                  {a.ownerName} · version {a.currentVersion} answering
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Thread({ conversationId, heading: H }: { conversationId: string; heading: Heading }) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { session } = useSession();
  const conversation = useQuery(trpc.conversations.get.queryOptions({ id: conversationId }));
  const messages = useInfiniteQuery(trpc.messages.list.infiniteQueryOptions({ conversationId, limit: 50 }, { getNextPageParam: (last) => last.nextCursor }));
  const [stream, setStream] = useState<StreamState>(IDLE);
  const [renaming, setRenaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const thread = messages.data?.pages.flatMap((p) => p.items) ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.messages.list.infiniteQueryKey({ conversationId }) });
    void queryClient.invalidateQueries({ queryKey: trpc.conversations.pathKey() });
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, stream]);

  function send(text: string) {
    setStream({ phase: "sending", question: text });
    let state: StreamState = { phase: "sending", question: text };
    const apply = (event: Parameters<typeof reduce>[1]) => {
      state = reduce(state, event);
      setStream(state);
    };
    client.messages.send.subscribe(
      { conversationId, text },
      {
        onData: apply,
        onError: (error) => apply({ type: "error", message: describe(error).message }),
        onComplete: async () => {
          await queryClient.invalidateQueries({ queryKey: trpc.messages.list.infiniteQueryKey({ conversationId }) });
          void queryClient.invalidateQueries({ queryKey: trpc.conversations.pathKey() });
          setStream(IDLE);
        },
      },
    );
  }

  const setStatus = useMutation({
    mutationFn: (to: "archived" | "active") => (to === "archived" ? client.conversations.archive.mutate({ id: conversationId }) : client.conversations.restore.mutate({ id: conversationId })),
    onSuccess: invalidate,
  });
  const rename = useMutation({
    mutationFn: (title: string) => client.conversations.rename.mutate({ id: conversationId, title }),
    onSuccess: () => {
      setRenaming(false);
      invalidate();
    },
  });

  const busy = stream.phase === "sending" || stream.phase === "streaming";
  const c = conversation.data?.conversation;
  const agentName = conversation.data?.agentName ?? "Agent";

  return (
    <section className="thread" aria-label="Conversation">
      <div className="head">
        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/chat" className="btn ghost sm back" aria-label="Back to the conversations">
            ←
          </Link>
          <div style={{ minWidth: 0 }}>
            {conversation.isPending ? (
              <Skeleton width={220} height={20} />
            ) : conversation.isError ? (
              <H className="thread-title">Conversation not found</H>
            ) : renaming ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const title = new FormData(e.currentTarget).get("title");
                  if (typeof title === "string" && title.trim()) rename.mutate(title.trim());
                }}
                style={{ display: "flex", gap: 8 }}
              >
                <Input name="title" className="sm" defaultValue={c?.title} aria-label="Title" maxLength={120} autoFocus />
                <Button type="submit" small>
                  Save
                </Button>
                <Button small tone="ghost" onClick={() => setRenaming(false)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <H className="thread-title">{c?.title}</H>
                <p className="sub">
                  {agentName} · {plural(c?.messageCount ?? 0, "message")} · {tokens(c?.tokenTotal ?? 0)}
                  {c?.status === "archived" ? " · archived" : ""}
                </p>
              </>
            )}
          </div>
        </div>
        {c ? (
          <div className="actions" style={{ display: "flex", gap: 6, flex: "none" }}>
            {c.status === "active" ? (
              <>
                <Button small tone="ghost" onClick={() => setRenaming(true)}>
                  Rename
                </Button>
                <Button small tone="ghost" onClick={() => setStatus.mutate("archived")} disabled={setStatus.isPending}>
                  Archive
                </Button>
              </>
            ) : (
              <Button small onClick={() => setStatus.mutate("active")} disabled={setStatus.isPending}>
                Restore
              </Button>
            )}
          </div>
        ) : null}
      </div>
      <div className="scroll" ref={scrollRef}>
        {conversation.isError ? (
          <Empty>
            This conversation is not yours or no longer exists. <Link href="/chat" className="link">Back to the list</Link>
          </Empty>
        ) : messages.isPending ? (
          <div className="messages">
            <Skeleton height={44} />
            <Skeleton height={88} />
          </div>
        ) : messages.isError ? (
          <Empty>Could not load the messages: {describe(messages.error).message}</Empty>
        ) : (
          <>
            {thread.length === 0 && stream.phase === "idle" ? <Empty>Nothing asked yet. The agent answers from its libraries and cites every line.</Empty> : null}
            <MessageList messages={thread} me={session?.user ?? { id: "", name: "" }} agentName={agentName} stream={stream} />
            {messages.hasNextPage ? (
              <div style={{ marginTop: 16 }}>
                <Button small onClick={() => messages.fetchNextPage()} disabled={messages.isFetchingNextPage}>
                  Show the next messages
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
      {c?.status === "active" ? (
        <Composer onSend={send} busy={busy} />
      ) : c ? (
        <div className="composer">
          <p className="muted">
            An archived conversation takes no new questions.{" "}
            <button type="button" className="link" style={{ border: 0, background: "none", padding: 0 }} onClick={() => setStatus.mutate("active")}>
              Restore it
            </button>{" "}
            to continue, or{" "}
            <button type="button" className="link" style={{ border: 0, background: "none", padding: 0 }} onClick={() => router.push("/chat?new=1")}>
              start a new one
            </button>
            .
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** Beside the agent picker: what happens to a question, with this person's own usage this month. */
function NewAside() {
  const trpc = useTRPC();
  const month = new Date().toISOString().slice(0, 7);
  const usage = useQuery(trpc.usage.mine.queryOptions({ month }));
  return (
    <aside className="aside" aria-label="How an answer is made">
      <div>
        <h3>How an answer is made</h3>
        <p className="muted">The agent searches the libraries its version names, keeping only the ones you may read. The best passages are packed under its context budget, the answer is built from them, and every line cites the passage it came from. The month&apos;s budget and your rate limit are checked first; a refusal says why.</p>
      </div>
      <div>
        <h3>Your usage this month</h3>
        {usage.isPending ? (
          <Skeleton height={56} />
        ) : usage.isError ? (
          <p className="muted small">Could not load it.</p>
        ) : (
          <dl className="kv">
            <div>
              <dt>Input tokens</dt>
              <dd className="num">{count(usage.data.byKind.input.tokens + usage.data.byKind.cached_input.tokens)}</dd>
            </div>
            <div>
              <dt>Output tokens</dt>
              <dd className="num">{count(usage.data.byKind.output.tokens)}</dd>
            </div>
            <div>
              <dt>All tokens</dt>
              <dd className="num">{count(usage.data.tokens)}</dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd className="num">{dollars(usage.data.costMicros)}</dd>
            </div>
          </dl>
        )}
      </div>
    </aside>
  );
}

/** The agent behind the conversation: the version that answers, its model and budget, the libraries it reads. */
function Aside({ conversationId }: { conversationId: string }) {
  const trpc = useTRPC();
  const conversation = useQuery(trpc.conversations.get.queryOptions({ id: conversationId }));
  const agentId = conversation.data?.conversation.agentId;
  const agent = useQuery({ ...trpc.agents.get.queryOptions({ id: agentId ?? "" }), enabled: Boolean(agentId) });
  const versionId = conversation.data?.conversation.agentVersionId;
  const version = agent.data?.versions.find((v) => v.id === versionId) ?? agent.data?.versions.find((v) => v.id === agent.data?.agent.currentVersionId);
  const libraries = useQueries({ queries: (version?.libraryIds ?? []).map((id) => trpc.libraries.get.queryOptions({ id })) });
  const c = conversation.data?.conversation;
  return (
    <aside className="aside" aria-label="About this agent">
      <div>
        <h3>{agent.data?.agent.name ?? conversation.data?.agentName ?? "Agent"}</h3>
        {agent.isPending ? (
          <Skeleton height={40} />
        ) : agent.isError ? (
          <p className="muted small">The agent is no longer visible to you; the conversation stays readable.</p>
        ) : (
          <>
            {version?.description ? <p className="muted">{version.description}</p> : null}
            <dl className="kv" style={{ marginTop: 8 }}>
              <div>
                <dt>Version answering</dt>
                <dd className="num">{version ? `${version.version}${version.id === agent.data.agent.currentVersionId ? "" : " (then)"}` : "—"}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{version?.modelId ?? "—"}</dd>
              </div>
              <div>
                <dt>Context budget</dt>
                <dd className="num">{version ? tokens(version.maxContextTokens) : "—"}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{agent.data.ownerName}</dd>
              </div>
            </dl>
          </>
        )}
      </div>
      <div>
        <h3>Reads</h3>
        {libraries.length === 0 ? (
          <p className="muted small">No library: the agent cannot find anything.</p>
        ) : (
          <ul style={{ display: "grid", gap: 4 }}>
            {libraries.map((l, i) =>
              l.data ? (
                <li key={l.data.library.id}>
                  <Link href={`/libraries/view?id=${encodeURIComponent(l.data.library.id)}`} className="link">
                    {l.data.library.name}
                  </Link>
                  <span className="muted small"> · {l.data.library.visibility === "workspace" ? "shared" : "private"}</span>
                </li>
              ) : (
                <li key={i} className="muted small">
                  {l.isError ? "A library you cannot read" : "…"}
                </li>
              ),
            )}
          </ul>
        )}
      </div>
      <div>
        <h3>This conversation</h3>
        <dl className="kv">
          <div>
            <dt>Messages</dt>
            <dd className="num">{c ? count(c.messageCount) : "—"}</dd>
          </div>
          <div>
            <dt>Tokens</dt>
            <dd className="num">{c ? count(c.tokenTotal) : "—"}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{c ? ago(c.createdAt) : "—"}</dd>
          </div>
        </dl>
      </div>
    </aside>
  );
}
