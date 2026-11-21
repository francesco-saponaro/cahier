import { describe, expect, test } from "vitest";
import { tokenHashOf } from "../src/use-cases/auth.js";
import { BOB, DAY, LEA, NOOR, NOW, failure, unwrap, world } from "./harness.js";

describe("members", () => {
  test("an admin lists the workspace's members and invitations; a member may not", async () => {
    const { useCases } = world();
    const members = unwrap(await useCases.members.list(NOOR, { limit: 50, cursor: null }));
    expect(members.items.map((m) => [m.user.name, m.role, m.status])).toEqual([
      ["Ada", "member", "suspended"],
      ["Léa", "member", "active"],
      ["Noor", "admin", "active"],
      ["Tom", "member", "active"],
    ]);
    expect(unwrap(await useCases.members.invitations(NOOR, { limit: 50, cursor: null })).items.map((i) => i.id)).toEqual(["inv_1", "inv_2"]);
    expect(failure(await useCases.members.list(LEA, { limit: 50, cursor: null })).code).toBe("forbidden");
  });

  test("inviting writes a sent invitation with a token shown once, lower-cases the email and audits it", async () => {
    const { useCases, store } = world();
    const { invitation, token } = unwrap(await useCases.members.invite(NOOR, { email: "Zoe@Example.com", role: "admin" }));
    expect(invitation).toMatchObject({ workspaceId: "ws_oriel", email: "zoe@example.com", role: "admin", status: "sent", invitedBy: "usr_noor", createdAt: NOW, expiresAt: new Date(NOW.getTime() + 7 * DAY) });
    expect(invitation.tokenHash).toBe(tokenHashOf(token));
    expect(token).toHaveLength(48);
    expect(store.auditLog.at(-1)).toMatchObject({ action: "invitation.sent", entityId: invitation.id, actorId: "usr_noor", after: { email: "zoe@example.com", role: "admin" } });
  });

  test("refuses a bad email, someone already a member, and someone already invited", async () => {
    const { useCases } = world();
    expect(failure(await useCases.members.invite(NOOR, { email: "not an email", role: "member" })).code).toBe("invalid");
    expect(failure(await useCases.members.invite(NOOR, { email: "tom@example.com", role: "member" })).reason).toBe("already_member");
    expect(failure(await useCases.members.invite(NOOR, { email: "new@example.com", role: "member" })).reason).toBe("already_invited");
    // A suspended person is still a member: reinstate them instead.
    expect(failure(await useCases.members.invite(NOOR, { email: "ada@example.com", role: "member" })).reason).toBe("already_member");
    // Someone with an account elsewhere can be invited here.
    expect((await useCases.members.invite(BOB, { email: "lea@example.com", role: "member" })).ok).toBe(false);
    expect((await useCases.members.invite(BOB, { email: "tom@example.com", role: "member" })).ok).toBe(true);
  });

  test("revoking an invitation is a transition, so a decided one is refused", async () => {
    const { useCases, store } = world();
    unwrap(await useCases.members.revokeInvitation(NOOR, "inv_1"));
    expect(store.invitations.find((i) => i.id === "inv_1")?.status).toBe("revoked");
    expect(failure(await useCases.members.revokeInvitation(NOOR, "inv_1")).reason).toBe("forbidden_transition");
    expect(failure(await useCases.members.revokeInvitation(NOOR, "inv_3")).code).toBe("not_found");
  });

  test("suspending ends the member's sessions in the workspace, and the last active admin cannot be suspended or demoted", async () => {
    const { useCases, store } = world();
    unwrap(await useCases.members.suspend(NOOR, "mem_tom"));
    expect(store.memberships.find((m) => m.id === "mem_tom")?.status).toBe("suspended");
    expect(store.sessions.some((s) => s.userId === "usr_tom")).toBe(false);
    expect(store.auditLog.at(-1)).toMatchObject({ action: "membership.suspended", entityId: "mem_tom", before: { status: "active" }, after: { status: "suspended" } });
    expect(failure(await useCases.members.suspend(NOOR, "mem_noor")).reason).toBe("last_admin");
    expect(failure(await useCases.members.setRole(NOOR, "mem_noor", "member")).reason).toBe("last_admin");
    unwrap(await useCases.members.setRole(NOOR, "mem_lea", "admin"));
    unwrap(await useCases.members.setRole(NOOR, "mem_noor", "member"));
    expect(store.memberships.find((m) => m.id === "mem_noor")?.role).toBe("member");
  });

  test("reinstating is the way back, and a membership of another workspace is not found", async () => {
    const { useCases, store } = world();
    unwrap(await useCases.members.reinstate(NOOR, "mem_ada"));
    expect(store.memberships.find((m) => m.id === "mem_ada")?.status).toBe("active");
    expect(failure(await useCases.members.reinstate(NOOR, "mem_ada")).reason).toBe("forbidden_transition");
    expect(failure(await useCases.members.suspend(NOOR, "mem_bob")).code).toBe("not_found");
    expect(failure(await useCases.members.suspend(LEA, "mem_tom")).code).toBe("forbidden");
  });

  test("setting the same role again changes nothing and writes no audit row", async () => {
    const { useCases, store } = world();
    const rows = store.auditLog.length;
    unwrap(await useCases.members.setRole(NOOR, "mem_lea", "member"));
    expect(store.auditLog).toHaveLength(rows);
  });
});
