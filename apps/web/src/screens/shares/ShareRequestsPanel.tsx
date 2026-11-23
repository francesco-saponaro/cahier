"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ShareStatus, ShareSubjectKind } from "@cahier/domain";
import { describe } from "../../api/errors";
import { useTRPC, useTRPCClient } from "../../api/trpc";
import { ago } from "../../lib/format";
import { Button, Empty, Pill, Skeleton } from "../../ui/primitives";

/*
 * The person's own share requests of one kind, with how each one ended: requested (and still
 * withdrawable), approved, declined with the admin's reason, withdrawn. This is where the owner
 * reads the outcome of asking to share.
 */

const TONE: Record<ShareStatus, "neutral" | "pos" | "neg" | "warn"> = { requested: "warn", approved: "pos", declined: "neg", withdrawn: "neutral" };
const WORD: Record<ShareStatus, string> = { requested: "Waiting for an admin", approved: "Approved", declined: "Declined", withdrawn: "Withdrawn" };

export function ShareRequestsPanel({ kind }: { kind: ShareSubjectKind }) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const query = useQuery(trpc.shares.listMine.queryOptions({ limit: 50 }));
  const withdraw = useMutation({ mutationFn: (id: string) => client.shares.withdraw.mutate({ id }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.shares.pathKey() }) });
  const rows = (query.data?.items ?? []).filter((r) => r.subjectKind === kind).slice(0, 8);
  return (
    <div className="panel">
      <header>
        <h2>Your share requests</h2>
        {rows.length > 0 ? <span className="muted small">{rows.filter((r) => r.status === "requested").length} waiting</span> : null}
      </header>
      {query.isPending ? (
        <Skeleton height={60} />
      ) : query.isError ? (
        <p className="muted small">Could not load them: {describe(query.error).message}</p>
      ) : rows.length === 0 ? (
        <Empty>No request yet. Sharing {kind === "library" ? "a library" : "an agent"} with the workspace asks an admin; the answer shows here.</Empty>
      ) : (
        <ol className="versions">
          {rows.map((r) => (
            <li key={r.id} className="version">
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="name">{r.subjectName}</span>
                  <Pill tone={TONE[r.status]}>{WORD[r.status]}</Pill>
                </div>
                <div className="sub">
                  {r.status === "requested" ? `asked ${ago(r.createdAt)}` : `${r.decidedAt ? ago(r.decidedAt) : ago(r.createdAt)}`}
                  {r.status === "declined" && r.reason ? ` · ${r.reason}` : ""}
                </div>
              </div>
              {r.status === "requested" ? (
                <Button small onClick={() => withdraw.mutate(r.id)} disabled={withdraw.isPending}>
                  Withdraw
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
