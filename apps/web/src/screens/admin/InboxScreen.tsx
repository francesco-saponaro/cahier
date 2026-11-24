"use client";

import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ShareStatus } from "@cahier/domain";
import { describe } from "../../api/errors";
import { useTRPC, useTRPCClient } from "../../api/trpc";
import { useSession } from "../../auth/SessionProvider";
import { ago, plural } from "../../lib/format";
import { Button, Empty, Pill, Skeleton, Textarea } from "../../ui/primitives";
import { AdminTabs } from "./AdminTabs";

/*
 * The share inbox. The question is "what is waiting for my approval, and what would it expose?",
 * so the open requests come first, each with what approving it opens to the workspace: for an
 * agent, the libraries it reads and which of those are still private (a colleague using the
 * agent still gets only the chunks they may read; the request is approved for the agent alone).
 * Approve flips the thing's visibility; Decline needs a reason the owner will read.
 */

const TONE: Record<ShareStatus, "warn" | "pos" | "neg" | "neutral"> = { requested: "warn", approved: "pos", declined: "neg", withdrawn: "neutral" };
const WORD: Record<ShareStatus, string> = { requested: "Waiting", approved: "Approved", declined: "Declined", withdrawn: "Withdrawn" };

export function InboxScreen() {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [status, setStatus] = useState<"requested" | "all">("requested");
  const [declining, setDeclining] = useState<{ id: string; reason: string } | null>(null);
  const query = useInfiniteQuery(trpc.admin.shares.inbox.infiniteQueryOptions({ status: status === "all" ? undefined : status, limit: 30 }, { getNextPageParam: (last) => last.nextCursor }));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: trpc.admin.shares.pathKey() });
  const approve = useMutation({ mutationFn: (id: string) => client.shares.approve.mutate({ id }), onSuccess: refresh });
  const decline = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => client.shares.decline.mutate({ id, reason }),
    onSuccess: () => {
      setDeclining(null);
      refresh();
    },
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const waiting = rows.filter((r) => r.status === "requested");
  const exposing = waiting.filter((r) => r.exposes.some((l) => l.visibility === "private")).length;
  const finding = query.isPending ? "…" : waiting.length === 0 ? (status === "requested" ? "Nothing is waiting for approval." : `${plural(rows.length, "request")}, none waiting.`) : `${plural(waiting.length, "request")} waiting${exposing ? `; ${exposing} would open an agent that reads a private library` : ""}.`;

  return (
    <div className="page">
      <AdminTabs />
      <div className="title-row">
        <div>
          <h1>Share inbox</h1>
          <p className="sub">
            {session?.workspace.name} · {finding}
          </p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Which requests" style={{ marginBottom: 12 }}>
        <button type="button" role="tab" aria-selected={status === "requested"} onClick={() => setStatus("requested")}>
          Waiting
        </button>
        <button type="button" role="tab" aria-selected={status === "all"} onClick={() => setStatus("all")}>
          Every request
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: "30%" }}>Request</th>
              <th>Asked by</th>
              <th>Would expose</th>
              <th>Status</th>
              <th className="n">Asked</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {query.isPending ? (
              [0, 1, 2].map((i) => (
                <tr key={i}>
                  <td colSpan={6}>
                    <Skeleton height={20} />
                  </td>
                </tr>
              ))
            ) : query.isError ? (
              <tr>
                <td colSpan={6}>
                  <Empty>Could not load the inbox: {describe(query.error).message}</Empty>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <Empty>{status === "requested" ? "No request is waiting. When a member asks to share a library or an agent with the workspace, it lands here." : "No request yet."}</Empty>
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={r.subjectKind === "agent" ? `/agents/edit?id=${encodeURIComponent(r.subjectId)}` : `/libraries/view?id=${encodeURIComponent(r.subjectId)}`} className="name">
                      {r.subjectName}
                    </Link>
                    <span className="sub">{r.subjectKind === "agent" ? "Agent" : "Library"}</span>
                  </td>
                  <td>{r.requesterName}</td>
                  <td>
                    {r.subjectKind === "library" ? (
                      <span className="muted small">Its documents, to every member</span>
                    ) : r.exposes.length === 0 ? (
                      <span className="muted small">Reads no library</span>
                    ) : (
                      <span className="small">
                        {r.exposes.map((l, i) => (
                          <span key={l.id} style={{ whiteSpace: "nowrap" }}>
                            {i > 0 ? ", " : ""}
                            {l.name}
                            {l.visibility === "private" ? <span className="muted"> (private)</span> : null}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td>
                    <Pill tone={TONE[r.status]}>{WORD[r.status]}</Pill>
                    {r.status === "declined" && r.reason ? <span className="sub">{r.reason}</span> : null}
                  </td>
                  <td className="n">{ago(r.createdAt)}</td>
                  <td className="n">
                    {r.status === "requested" ? (
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        <Button small onClick={() => approve.mutate(r.id)} disabled={approve.isPending}>
                          Approve
                        </Button>
                        <Button small tone="ghost" onClick={() => setDeclining({ id: r.id, reason: "" })} disabled={decline.isPending}>
                          Decline
                        </Button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {query.hasNextPage ? (
          <div className="table-foot">
            <span>{plural(rows.length, "request")} shown</span>
            <Button small onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              Show more
            </Button>
          </div>
        ) : null}
      </div>
      {approve.isError ? (
        <p className="muted small" style={{ marginTop: 8 }}>
          {describe(approve.error).message}
        </p>
      ) : null}
      {declining ? (
        <div className="panel" style={{ marginTop: 16, maxWidth: 640 }}>
          <header>
            <h2>Decline {rows.find((r) => r.id === declining.id)?.subjectName ?? "the request"}</h2>
            <span className="muted small">The owner reads the reason</span>
          </header>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              if (declining.reason.trim()) decline.mutate({ id: declining.id, reason: declining.reason.trim() });
            }}
          >
            <Textarea rows={3} aria-label="Reason" value={declining.reason} onChange={(e) => setDeclining({ ...declining, reason: e.target.value })} placeholder="Why it stays private" />
            {decline.isError ? <p className="muted small">{describe(decline.error).message}</p> : null}
            <div className="form-actions">
              <Button tone="ghost" onClick={() => setDeclining(null)}>
                Cancel
              </Button>
              <Button type="submit" tone="danger" disabled={decline.isPending || declining.reason.trim().length === 0}>
                Decline the request
              </Button>
            </div>
          </form>
        </div>
      ) : null}
      <div className="usage-row" style={{ marginTop: 16 }}>
        <SharedNow kind="library" />
        <SharedNow kind="agent" />
      </div>
    </div>
  );
}

/** What the workspace can read today, with the way back: an admin can unshare, and the thing goes private again. */
function SharedNow({ kind }: { kind: "library" | "agent" }) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const libraries = useQuery({ ...trpc.libraries.list.queryOptions({ scope: "shared", sort: "name", limit: 50 }), enabled: kind === "library" });
  const agents = useQuery({ ...trpc.agents.list.queryOptions({ scope: "shared", sort: "name", limit: 50 }), enabled: kind === "agent" });
  const query = kind === "library" ? libraries : agents;
  const unshare = useMutation({
    mutationFn: (id: string) => client.shares.unshare.mutate({ kind, id }),
    onSuccess: () => void queryClient.invalidateQueries(),
  });
  const items: { id: string; name: string; ownerName: string; sub: string }[] =
    kind === "library"
      ? (libraries.data?.items ?? []).map((l) => ({ id: l.id, name: l.name, ownerName: l.ownerName, sub: `${plural(l.documentCount, "document")}, ${l.indexedCount} indexed` }))
      : (agents.data?.items ?? []).filter((a) => a.status === "active").map((a) => ({ id: a.id, name: a.name, ownerName: a.ownerName, sub: a.currentVersion ? `version ${a.currentVersion} answering` : "no published version" }));
  return (
    <div className="panel">
      <header>
        <h2>{kind === "library" ? "Libraries shared with the workspace" : "Agents shared with the workspace"}</h2>
        {query.data ? <span className="muted small">{items.length}</span> : null}
      </header>
      {query.isPending ? (
        <Skeleton height={60} />
      ) : query.isError ? (
        <p className="muted small">Could not load them: {describe(query.error).message}</p>
      ) : items.length === 0 ? (
        <Empty>Nothing is shared yet.</Empty>
      ) : (
        <ol className="versions">
          {items.map((it) => (
            <li key={it.id} className="version">
              <div style={{ minWidth: 0 }}>
                <Link href={kind === "agent" ? `/agents/edit?id=${encodeURIComponent(it.id)}` : `/libraries/view?id=${encodeURIComponent(it.id)}`} className="name">
                  {it.name}
                </Link>
                <div className="sub">
                  {it.ownerName} · {it.sub}
                </div>
              </div>
              <Button small tone="ghost" onClick={() => unshare.mutate(it.id)} disabled={unshare.isPending}>
                Unshare
              </Button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
