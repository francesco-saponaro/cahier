"use client";

import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { describe } from "../../api/errors";
import { useTRPC } from "../../api/trpc";
import { useSession } from "../../auth/SessionProvider";
import { ago, count, plural } from "../../lib/format";
import { Button, Empty, Input, Pill, SearchIcon, Select, Skeleton } from "../../ui/primitives";
import { ShareRequestsPanel } from "../shares/ShareRequestsPanel";

/*
 * The agents: the person's own and the shared ones (an admin sees all), each with the version
 * that answers and how many versions it has. The question is "which agents answer, and with
 * which version?"; an agent with no published version is the finding.
 */

type Scope = "own" | "shared" | "all";
type Sort = "name" | "newest";

export function AgentsScreen() {
  const trpc = useTRPC();
  const { session } = useSession();
  const isAdmin = session?.role === "admin";
  const [scope, setScope] = useState<Scope>("own");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const query = useInfiniteQuery(trpc.agents.list.infiniteQueryOptions({ scope, q: q || undefined, sort, limit: 30 }, { getNextPageParam: (last) => last.nextCursor }));
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const silent = items.filter((a) => a.status === "active" && a.currentVersion === null).length;

  return (
    <div className="page">
      <div className="title-row">
        <div>
          <h1>Agents</h1>
          <p className="sub">
            {session?.workspace.name} · {query.isPending ? "…" : silent > 0 ? `${plural(silent, "agent")} with no published version yet; publish one so it can answer.` : items.length > 0 ? "every active agent has a version answering." : "none yet."}
          </p>
        </div>
        <div className="actions">
          <Link href="/agents/edit" className="btn primary">
            New agent
          </Link>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Which agents" style={{ marginBottom: 12 }}>
        <button type="button" role="tab" aria-selected={scope === "own"} onClick={() => setScope("own")}>
          Mine
        </button>
        <button type="button" role="tab" aria-selected={scope === "shared"} onClick={() => setScope("shared")}>
          Shared with the workspace
        </button>
        {isAdmin ? (
          <button type="button" role="tab" aria-selected={scope === "all"} onClick={() => setScope("all")}>
            Every agent
          </button>
        ) : null}
      </div>
      <div className="filters">
        <div className="search" style={{ width: 280 }}>
          <SearchIcon />
          <Input className="sm" type="search" aria-label="Search agents" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="sm" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ width: 160 }}>
          <option value="name">By name</option>
          <option value="newest">Newest first</option>
        </Select>
        <span className="spacer" />
        <span className="muted small">{query.isPending ? "" : `${plural(items.length, "agent")}${query.hasNextPage ? " shown" : ""}`}</span>
      </div>
      <div className="with-rail">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: "32%" }}>Agent</th>
              <th>Owner</th>
              <th>Visibility</th>
              <th>Status</th>
              <th className="n">Answering</th>
              <th className="n">Versions</th>
              <th className="n">Created</th>
            </tr>
          </thead>
          <tbody>
            {query.isPending ? (
              [0, 1, 2].map((i) => (
                <tr key={i}>
                  <td colSpan={7}>
                    <Skeleton height={20} />
                  </td>
                </tr>
              ))
            ) : query.isError ? (
              <tr>
                <td colSpan={7}>
                  <Empty>Could not load the agents: {describe(query.error).message}</Empty>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <Empty>{q ? "No agent has that in its name." : scope === "own" ? "You have no agent yet. Build one over a library and publish it." : "Nothing is shared with the workspace yet."}</Empty>
                </td>
              </tr>
            ) : (
              items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/agents/edit?id=${encodeURIComponent(a.id)}`} className="name">
                      {a.name}
                    </Link>
                  </td>
                  <td>{a.ownerName}</td>
                  <td>{a.visibility === "workspace" ? <Pill tone="accent">Shared</Pill> : <Pill>Private</Pill>}</td>
                  <td>{a.status === "archived" ? <span className="muted">Archived</span> : a.currentVersion === null ? <span style={{ color: "var(--negative)" }}>No version published</span> : "Active"}</td>
                  <td className="n num">{a.currentVersion === null ? <span className="muted">—</span> : `v${a.currentVersion}`}</td>
                  <td className="n num">{count(a.versionCount)}</td>
                  <td className="n">{ago(a.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {query.hasNextPage ? (
          <div className="table-foot">
            <span>{plural(items.length, "agent")} shown</span>
            <Button small onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              Show more
            </Button>
          </div>
        ) : null}
      </div>
      <ShareRequestsPanel kind="agent" />
      </div>
    </div>
  );
}
