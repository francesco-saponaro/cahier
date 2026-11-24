"use client";

import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InvitationStatus, Role } from "@cahier/domain";
import { describe } from "../../api/errors";
import { useTRPC, useTRPCClient } from "../../api/trpc";
import { useSession } from "../../auth/SessionProvider";
import { ago, plural, when } from "../../lib/format";
import { Initial } from "../../ui/Initial";
import { Button, Empty, Input, Pill, SearchIcon, Select, Skeleton } from "../../ui/primitives";
import { AdminTabs } from "./AdminTabs";
import { InviteForm } from "./InviteForm";

/*
 * Members and invitations. The question is "who is in the workspace, and who is waiting to
 * join?", so the table is the members with their role and standing, the invitations sit beside
 * it with the ones still open first, and the finding under the title is what needs doing: an
 * invitation about to expire, a suspended member. Nothing delivers an invitation; the token is
 * shown once to the admin to pass on, as the API answers it.
 */

const INVITATION_TONE: Record<InvitationStatus, "warn" | "pos" | "neutral" | "neg"> = { sent: "warn", accepted: "pos", revoked: "neutral", expired: "neg" };
const INVITATION_WORD: Record<InvitationStatus, string> = { sent: "Sent", accepted: "Accepted", revoked: "Revoked", expired: "Expired" };

export function MembersScreen() {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "active" | "suspended">("");
  const [role, setRole] = useState<"" | Role>("");
  const [token, setToken] = useState<{ email: string; token: string } | null>(null);

  const members = useInfiniteQuery(
    trpc.admin.members.list.infiniteQueryOptions({ q: q || undefined, status: status || undefined, role: role || undefined, limit: 30 }, { getNextPageParam: (last) => last.nextCursor }),
  );
  const invitations = useQuery(trpc.admin.members.invitations.queryOptions({ limit: 50 }));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: trpc.admin.members.pathKey() });
  const act = useMutation({
    mutationFn: async (input: { membershipId: string; action: "suspend" | "reinstate" } | { membershipId: string; action: "setRole"; role: Role }) =>
      input.action === "setRole" ? client.admin.members.setRole.mutate({ membershipId: input.membershipId, role: input.role }) : client.admin.members[input.action].mutate({ membershipId: input.membershipId }),
    onSuccess: refresh,
  });
  const revoke = useMutation({ mutationFn: (id: string) => client.admin.members.revokeInvitation.mutate({ id }), onSuccess: refresh });

  const rows = members.data?.pages.flatMap((p) => p.items) ?? [];
  const open = (invitations.data?.items ?? []).filter((i) => i.status === "sent");
  const suspended = rows.filter((m) => m.status === "suspended").length;
  const admins = rows.filter((m) => m.role === "admin" && m.status === "active").length;
  const finding = members.isPending ? "…" : `${plural(rows.length, "member")}${members.hasNextPage ? " shown" : ""}, ${plural(admins, "admin")}${suspended ? `, ${suspended} suspended` : ""}${open.length ? `; ${plural(open.length, "invitation")} waiting to be accepted` : "; no invitation open"}.`;

  return (
    <div className="page">
      <AdminTabs />
      <div className="title-row">
        <div>
          <h1>Members</h1>
          <p className="sub">
            {session?.workspace.name} · {finding}
          </p>
        </div>
      </div>
      <div className="with-rail">
        <div>
          <div className="filters">
            <div className="search" style={{ width: 280 }}>
              <SearchIcon />
              <Input className="sm" type="search" aria-label="Search members" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select className="sm" aria-label="Standing" value={status} onChange={(e) => setStatus(e.target.value as "" | "active" | "suspended")} style={{ width: 150 }}>
              <option value="">Any standing</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </Select>
            <Select className="sm" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as "" | Role)} style={{ width: 140 }}>
              <option value="">Any role</option>
              <option value="member">Members</option>
              <option value="admin">Admins</option>
            </Select>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: "40%" }}>Member</th>
                  <th>Role</th>
                  <th>Standing</th>
                  <th className="n">Since</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {members.isPending ? (
                  [0, 1, 2, 3].map((i) => (
                    <tr key={i}>
                      <td colSpan={5}>
                        <Skeleton height={20} />
                      </td>
                    </tr>
                  ))
                ) : members.isError ? (
                  <tr>
                    <td colSpan={5}>
                      <Empty>Could not load the members: {describe(members.error).message}</Empty>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <Empty>Nobody matches.</Empty>
                    </td>
                  </tr>
                ) : (
                  rows.map((m) => {
                    const self = m.userId === session?.user.id;
                    return (
                      <tr key={m.id}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <Initial id={m.user.id} name={m.user.name} />
                            <div style={{ minWidth: 0 }}>
                              <span className="name">
                                {m.user.name}
                                {self ? <span className="muted"> (you)</span> : null}
                              </span>
                              <span className="sub truncate">{m.user.email}</span>
                            </div>
                          </div>
                        </td>
                        <td>{m.role === "admin" ? "Admin" : "Member"}</td>
                        <td>{m.status === "active" ? <Pill tone="pos">Active</Pill> : <Pill tone="neg">Suspended</Pill>}</td>
                        <td className="n">{ago(m.createdAt)}</td>
                        <td className="n" style={{ whiteSpace: "nowrap" }}>
                          {self ? null : (
                            <>
                              {m.status === "active" ? (
                                <Button small tone="ghost" onClick={() => act.mutate({ membershipId: m.id, action: "setRole", role: m.role === "admin" ? "member" : "admin" })} disabled={act.isPending}>
                                  {m.role === "admin" ? "Make member" : "Make admin"}
                                </Button>
                              ) : null}
                              {m.status === "active" ? (
                                <Button small tone="ghost" onClick={() => act.mutate({ membershipId: m.id, action: "suspend" })} disabled={act.isPending}>
                                  Suspend
                                </Button>
                              ) : (
                                <Button small onClick={() => act.mutate({ membershipId: m.id, action: "reinstate" })} disabled={act.isPending}>
                                  Reinstate
                                </Button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            {members.hasNextPage ? (
              <div className="table-foot">
                <span>{plural(rows.length, "member")} shown</span>
                <Button small onClick={() => members.fetchNextPage()} disabled={members.isFetchingNextPage}>
                  Show more
                </Button>
              </div>
            ) : null}
          </div>
          {act.isError ? (
            <p className="muted small" style={{ marginTop: 8 }}>
              {describe(act.error).reason === "last_admin" ? "That is the last active admin; make someone else an admin first." : describe(act.error).message}
            </p>
          ) : null}
        </div>
        <div className="stack">
          <div className="panel">
            <header>
              <h2>Invite someone</h2>
            </header>
            <InviteForm
              onSubmit={async (values) => {
                try {
                  const made = await client.admin.members.invite.mutate(values);
                  setToken({ email: made.invitation.email, token: made.token });
                  refresh();
                  return null;
                } catch (e) {
                  const failure = describe(e);
                  return failure.code === "CONFLICT" ? "That address is already a member, or has an open invitation." : failure.message;
                }
              }}
            />
            {token ? (
              <div className="notice" style={{ marginTop: 12 }}>
                The invitation for {token.email} is ready. Nothing sends it: pass this token on, it is shown once and is good for seven days.
                <code style={{ display: "block", marginTop: 6, wordBreak: "break-all", fontFamily: "inherit", fontWeight: 500 }}>{token.token}</code>
              </div>
            ) : null}
          </div>
          <div className="panel">
            <header>
              <h2>Invitations</h2>
              {invitations.data ? <span className="muted small">{open.length} open</span> : null}
            </header>
            {invitations.isPending ? (
              <Skeleton height={60} />
            ) : invitations.isError ? (
              <p className="muted small">Could not load them: {describe(invitations.error).message}</p>
            ) : (invitations.data.items.length ?? 0) === 0 ? (
              <Empty>No invitation yet.</Empty>
            ) : (
              <ol className="versions">
                {[...invitations.data.items]
                  .sort((a, b) => (a.status === "sent" ? 0 : 1) - (b.status === "sent" ? 0 : 1))
                  .slice(0, 8)
                  .map((i) => (
                    <li key={i.id} className="version">
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span className="name truncate">{i.email}</span>
                          <Pill tone={INVITATION_TONE[i.status]}>{INVITATION_WORD[i.status]}</Pill>
                        </div>
                        <div className="sub">
                          {i.role} · {i.status === "sent" ? `expires ${when(i.expiresAt)}` : `sent ${ago(i.createdAt)}`}
                        </div>
                      </div>
                      {i.status === "sent" ? (
                        <Button small onClick={() => revoke.mutate(i.id)} disabled={revoke.isPending}>
                          Revoke
                        </Button>
                      ) : null}
                    </li>
                  ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
