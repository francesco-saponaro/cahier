import { describe, expect, test } from "vitest";
import { tokenHashOf } from "../src/use-cases/auth.js";
import { DAY, LEA, NOW, PASSWORD, failure, unwrap, world } from "./harness.js";

describe("signIn", () => {
  test("opens a session in the member's oldest active workspace and answers who they are", async () => {
    const { useCases, store } = world();
    const signed = unwrap(await useCases.auth.signIn({ email: "Lea@Example.com", password: PASSWORD }));
    expect(signed.user).toEqual({ id: "usr_lea", email: "lea@example.com", name: "Léa", createdAt: expect.any(Date) });
    expect(signed.user).not.toHaveProperty("passwordHash");
    expect(signed.workspace.slug).toBe("oriel");
    expect(signed.role).toBe("member");
    expect(signed.token).toHaveLength(48);
    expect(signed.expiresAt).toEqual(new Date(NOW.getTime() + 72 * 60 * 60 * 1000));
    const session = store.sessions.find((s) => s.userId === "usr_lea" && s.createdAt.getTime() === NOW.getTime())!;
    expect(session.tokenHash).toBe(tokenHashOf(signed.token));
    expect(session.tokenHash).not.toContain(signed.token);
    expect(session.workspaceId).toBe("ws_oriel");
  });

  test("refuses a wrong password or an unknown email with the same answer", async () => {
    const { useCases } = world();
    const wrong = failure(await useCases.auth.signIn({ email: "lea@example.com", password: "not-it-at-all" }));
    const unknown = failure(await useCases.auth.signIn({ email: "nobody@example.com", password: PASSWORD }));
    expect(wrong).toEqual({ code: "unauthorized", message: "wrong email or password" });
    expect(unknown).toEqual(wrong);
  });

  test("refuses a person whose every membership is suspended", async () => {
    const { useCases } = world();
    const refused = failure(await useCases.auth.signIn({ email: "ada@example.com", password: PASSWORD }));
    expect(refused.code).toBe("forbidden");
    expect(refused.reason).toBe("no_active_membership");
  });
});

describe("authenticate, me, switchWorkspace and signOut", () => {
  test("turns a token into the actor of the session's workspace, or nothing after expiry, sign-out or suspension", async () => {
    const { useCases, clock, store } = world();
    const { token } = unwrap(await useCases.auth.signIn({ email: "lea@example.com", password: PASSWORD }));
    expect(await useCases.auth.authenticate(token)).toMatchObject({ actor: LEA });
    expect(await useCases.auth.authenticate("not-a-token")).toBeNull();
    store.memberships.find((m) => m.id === "mem_lea")!.status = "suspended";
    expect(await useCases.auth.authenticate(token)).toBeNull();
    store.memberships.find((m) => m.id === "mem_lea")!.status = "active";
    clock.advance(73 * 60 * 60 * 1000);
    expect(await useCases.auth.authenticate(token)).toBeNull();
    clock.advance(-73 * 60 * 60 * 1000);
    await useCases.auth.signOut(token);
    expect(await useCases.auth.authenticate(token)).toBeNull();
  });

  test("me names the user, the workspace, the role, the tools and the workspaces to switch to", async () => {
    const { useCases } = world();
    const me = unwrap(await useCases.auth.me(LEA));
    expect(me.user.name).toBe("Léa");
    expect(me.workspace.slug).toBe("oriel");
    expect(me.role).toBe("member");
    expect(me.tools).toEqual({ groundedAnswers: true, scheduledPrompts: true, uploads: true });
    expect(me.workspaces).toEqual([
      { id: "ws_oriel", slug: "oriel", name: "Oriel", role: "member" },
      { id: "ws_brindille", slug: "brindille", name: "Brindille", role: "member" },
    ]);
  });

  test("switching rewrites the session's workspace, only to one where the membership is active", async () => {
    const { useCases } = world();
    const { token } = unwrap(await useCases.auth.signIn({ email: "lea@example.com", password: PASSWORD }));
    const { actor, session } = (await useCases.auth.authenticate(token))!;
    const switched = unwrap(await useCases.auth.switchWorkspace(actor, session.id, "ws_brindille"));
    expect(switched.workspace.slug).toBe("brindille");
    expect((await useCases.auth.authenticate(token))?.actor).toEqual({ userId: "usr_lea", workspaceId: "ws_brindille", role: "member" });
    const refused = failure(await useCases.auth.switchWorkspace(actor, session.id, "ws_nowhere"));
    expect(refused.code).toBe("forbidden");
  });
});

describe("acceptInvitation", () => {
  test("creates the user and the membership, marks the invitation accepted, writes the audit rows and signs them in", async () => {
    const { useCases, store } = world((s) => {
      s.invitations.push({ id: "inv_new", workspaceId: "ws_oriel", email: "zoe@example.com", role: "member", tokenHash: tokenHashOf("zoe-token"), status: "sent", invitedBy: "usr_noor", acceptedUserId: null, createdAt: NOW, expiresAt: new Date(NOW.getTime() + 7 * DAY) });
    });
    const signed = unwrap(await useCases.auth.acceptInvitation({ token: "zoe-token", name: "Zoé", password: "a-good-long-password" }));
    expect(signed.user.email).toBe("zoe@example.com");
    expect(signed.workspace.slug).toBe("oriel");
    expect(signed.role).toBe("member");
    expect(store.invitations.find((i) => i.id === "inv_new")).toMatchObject({ status: "accepted", acceptedUserId: signed.user.id });
    expect(store.memberships.find((m) => m.userId === signed.user.id)).toMatchObject({ workspaceId: "ws_oriel", role: "member", status: "active" });
    expect(store.auditLog.filter((a) => a.at.getTime() === NOW.getTime()).map((a) => [a.action, a.actorId])).toEqual([
      ["invitation.accepted", signed.user.id],
      ["membership.created", signed.user.id],
    ]);
    expect(await useCases.auth.authenticate(signed.token)).toMatchObject({ actor: { userId: signed.user.id, workspaceId: "ws_oriel", role: "member" } });
  });

  test("an existing user joins with their own password and gets no second account", async () => {
    const { useCases, store } = world((s) => {
      s.invitations.push({ id: "inv_tom", workspaceId: "ws_brindille", email: "tom@example.com", role: "admin", tokenHash: tokenHashOf("tom-token"), status: "sent", invitedBy: "usr_bob", acceptedUserId: null, createdAt: NOW, expiresAt: new Date(NOW.getTime() + 7 * DAY) });
    });
    const wrong = failure(await useCases.auth.acceptInvitation({ token: "tom-token", name: "Tom", password: "not-his-password" }));
    expect(wrong.code).toBe("unauthorized");
    const signed = unwrap(await useCases.auth.acceptInvitation({ token: "tom-token", name: "Tom", password: PASSWORD }));
    expect(signed.user.id).toBe("usr_tom");
    expect(signed.workspace.slug).toBe("brindille");
    expect(signed.role).toBe("admin");
    expect(store.users.filter((u) => u.email === "tom@example.com")).toHaveLength(1);
  });

  test("refuses a token nobody sent, an invitation already decided, an expired one (and marks it), and a weak password", async () => {
    const { useCases, store } = world((s) => {
      s.invitations.push({ id: "inv_late", workspaceId: "ws_oriel", email: "late@example.com", role: "member", tokenHash: tokenHashOf("late-token"), status: "sent", invitedBy: "usr_noor", acceptedUserId: null, createdAt: new Date(NOW.getTime() - 8 * DAY), expiresAt: new Date(NOW.getTime() - DAY) });
      s.invitations.push({ id: "inv_weak", workspaceId: "ws_oriel", email: "weak@example.com", role: "member", tokenHash: tokenHashOf("weak-token"), status: "sent", invitedBy: "usr_noor", acceptedUserId: null, createdAt: NOW, expiresAt: new Date(NOW.getTime() + DAY) });
    });
    expect(failure(await useCases.auth.acceptInvitation({ token: "nothing", name: "X", password: "a-good-long-password" })).code).toBe("not_found");
    expect(failure(await useCases.auth.acceptInvitation({ token: "late-token", name: "X", password: "a-good-long-password" })).reason).toBe("invitation_expired");
    expect(store.invitations.find((i) => i.id === "inv_late")?.status).toBe("expired");
    const weak = failure(await useCases.auth.acceptInvitation({ token: "weak-token", name: "X", password: "short" }));
    expect(weak.code).toBe("invalid");
    expect(weak.message).toContain("at least 10 characters");
    expect(store.invitations.find((i) => i.id === "inv_weak")?.status).toBe("sent");
  });
});
