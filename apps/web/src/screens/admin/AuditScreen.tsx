"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { describe } from "../../api/errors";
import { useTRPC } from "../../api/trpc";
import { useSession } from "../../auth/SessionProvider";
import { plural, when } from "../../lib/format";
import { Button, Empty, Input, SearchIcon, Select, Skeleton } from "../../ui/primitives";
import { AdminTabs } from "./AdminTabs";
import { actionWords, changes } from "./changes";

/*
 * The audit log: every change in the workspace, newest first, with who made it and what it did.
 * The question is "what changed, by whom?", so the row is the action in words and the person,
 * and opening a row shows the fields before and after. Filters narrow by entity, action and
 * actor, server-side, since the log is the largest table the workspace has.
 */

const KINDS = ["workspace", "membership", "invitation", "library", "document", "agent", "agent_version", "share", "conversation", "message", "budget", "schedule", "scheduled_run"];

export function AuditScreen() {
  const trpc = useTRPC();
  const { session } = useSession();
  const [kind, setKind] = useState("");
  const [action, setAction] = useState("");
  const [entityId, setEntityId] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const query = useInfiniteQuery(
    trpc.admin.audit.list.infiniteQueryOptions({ entityKind: kind || undefined, action: action.trim() || undefined, entityId: entityId.trim() || undefined, limit: 50 }, { getNextPageParam: (last) => last.nextCursor }),
  );
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const latest = rows[0];
  const finding = query.isPending ? "…" : rows.length === 0 ? "Nothing matches." : `${plural(rows.length, "entry", "entries")}${query.hasNextPage ? " shown" : ""}; the latest is ${actionWords(latest!.action).toLowerCase()} by ${latest!.actorName ?? "the system"}, ${when(latest!.at)}.`;

  return (
    <div className="page">
      <AdminTabs />
      <div className="title-row">
        <div>
          <h1>Audit log</h1>
          <p className="sub">
            {session?.workspace.name} · {finding}
          </p>
        </div>
      </div>
      <div className="filters">
        <Select className="sm" aria-label="Entity" value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 170 }}>
          <option value="">Any entity</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
        <div className="search" style={{ width: 240 }}>
          <SearchIcon />
          <Input className="sm" type="search" aria-label="Action" placeholder="Action, such as share.approved" value={action} onChange={(e) => setAction(e.target.value)} />
        </div>
        <Input className="sm" aria-label="Entity id" placeholder="Entity id" value={entityId} onChange={(e) => setEntityId(e.target.value)} style={{ width: 220 }} />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: "24%" }}>What</th>
              <th>Who</th>
              <th>Entity</th>
              <th>Changes</th>
              <th className="n">When</th>
            </tr>
          </thead>
          <tbody>
            {query.isPending ? (
              [0, 1, 2, 3, 4].map((i) => (
                <tr key={i}>
                  <td colSpan={5}>
                    <Skeleton height={20} />
                  </td>
                </tr>
              ))
            ) : query.isError ? (
              <tr>
                <td colSpan={5}>
                  <Empty>Could not load the log: {describe(query.error).message}</Empty>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <Empty>No entry matches these filters.</Empty>
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const diff = changes(r.before, r.after);
                const isOpen = open === r.id;
                return (
                  <tr key={r.id}>
                    <td>
                      <span className="name">{actionWords(r.action)}</span>
                      {r.reason ? <span className="sub">{r.reason}</span> : null}
                    </td>
                    <td>{r.actorName ?? <span className="muted">System</span>}</td>
                    <td>
                      <span>{r.entityKind.replace(/_/g, " ")}</span>
                      <span className="sub truncate" style={{ maxWidth: 180 }}>
                        {r.entityId}
                      </span>
                    </td>
                    <td>
                      {diff.length === 0 ? (
                        <span className="muted">—</span>
                      ) : isOpen ? (
                        <dl className="kv small" style={{ gap: 0 }}>
                          {diff.map((c) => (
                            <div key={c.field} style={{ minHeight: 22 }}>
                              <dt>{c.field}</dt>
                              <dd>
                                {c.before !== null ? <span className="muted">{c.before || "empty"} → </span> : null}
                                {c.after !== null ? c.after || "empty" : <span className="muted">removed</span>}
                              </dd>
                            </div>
                          ))}
                          <div style={{ minHeight: 22 }}>
                            <button type="button" className="link small" onClick={() => setOpen(null)}>
                              Hide
                            </button>
                          </div>
                        </dl>
                      ) : (
                        <button type="button" className="link small" onClick={() => setOpen(r.id)}>
                          {diff.length === 1 ? `${diff[0]!.field}: ${diff[0]!.after ?? "removed"}`.slice(0, 60) : `${plural(diff.length, "field")} changed`}
                        </button>
                      )}
                    </td>
                    <td className="n num" style={{ whiteSpace: "nowrap" }}>
                      {when(r.at)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {query.hasNextPage ? (
          <div className="table-foot">
            <span>{plural(rows.length, "entry", "entries")} shown</span>
            <Button small onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              Show more
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
