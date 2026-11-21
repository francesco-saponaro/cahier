import { describe, expect, test } from "vitest";
import { LEA, NOOR, NOW, TOM, failure, unwrap, world } from "./harness.js";

describe("share requests", () => {
  test("the owner of a private thing asks for it to be shared, once, and sees their own requests", async () => {
    const { useCases, store } = world();
    const made = unwrap(await useCases.shares.request(LEA, { kind: "agent", id: "agt_new" }));
    expect(made).toMatchObject({ workspaceId: "ws_oriel", subjectKind: "agent", subjectId: "agt_new", requestedBy: "usr_lea", status: "requested", decidedBy: null, createdAt: NOW });
    expect(store.auditLog.at(-1)).toMatchObject({ action: "share.requested", entityId: made.id, after: { subjectKind: "agent", subjectId: "agt_new" } });
    expect(failure(await useCases.shares.request(LEA, { kind: "agent", id: "agt_new" })).reason).toBe("already_requested");
    expect(failure(await useCases.shares.request(LEA, { kind: "library", id: "lib_drafts" })).reason).toBe("already_requested");
    expect(failure(await useCases.shares.request(TOM, { kind: "library", id: "lib_runbooks" })).reason).toBe("already_shared");
    expect(failure(await useCases.shares.request(LEA, { kind: "library", id: "lib_field" })).code).toBe("forbidden");
    expect(failure(await useCases.shares.request(LEA, { kind: "library", id: "lib_nowhere" })).code).toBe("not_found");
    const mine = unwrap(await useCases.shares.listMine(LEA, { limit: 50, cursor: null }));
    expect(mine.items.map((r) => [r.id, r.subjectName, r.status])).toEqual([
      [made.id, "New agent", "requested"],
      ["shr_4", "Drafts", "requested"],
    ]);
  });

  test("an admin sharing their own thing needs no second admin: the request is approved at once", async () => {
    const { useCases, store } = world((s) => {
      s.libraries.push({ id: "lib_admin", workspaceId: "ws_oriel", ownerId: "usr_noor", slug: "policies", name: "Policies", description: "", visibility: "private", createdAt: NOW, updatedAt: NOW });
    });
    const made = unwrap(await useCases.shares.request(NOOR, { kind: "library", id: "lib_admin" }));
    expect(made).toMatchObject({ status: "approved", decidedBy: "usr_noor", decidedAt: NOW });
    expect(store.libraries.find((l) => l.id === "lib_admin")?.visibility).toBe("workspace");
    expect(store.auditLog.slice(-3).map((a) => a.action)).toEqual(["share.requested", "share.approved", "library.shared"]);
  });

  test("the requester withdraws a pending request; nobody else can, and a decided one stays decided", async () => {
    const { useCases, store } = world();
    unwrap(await useCases.shares.withdraw(TOM, "shr_2"));
    expect(store.shareRequests.find((r) => r.id === "shr_2")).toMatchObject({ status: "withdrawn", decidedAt: NOW });
    expect(failure(await useCases.shares.withdraw(TOM, "shr_2")).reason).toBe("forbidden_transition");
    expect(failure(await useCases.shares.withdraw(LEA, "shr_2")).code).toBe("not_found");
    expect(failure(await useCases.shares.withdraw(TOM, "shr_1")).reason).toBe("forbidden_transition");
  });

  test("the inbox shows what an agent would expose: its libraries and which of those are not shared", async () => {
    const { useCases, store } = world((s) => {
      s.shareRequests.push({ id: "shr_field_agent", workspaceId: "ws_oriel", subjectKind: "agent", subjectId: "agt_field", requestedBy: "usr_tom", status: "requested", reason: null, decidedBy: null, createdAt: new Date(NOW.getTime() + 1), decidedAt: null });
    });
    void store;
    const inbox = unwrap(await useCases.shares.inbox(NOOR, { limit: 50, cursor: null, status: "requested" }));
    expect(inbox.items.map((r) => [r.id, r.subjectName, r.requesterName])).toEqual([
      ["shr_field_agent", "Field agent", "Tom"],
      ["shr_4", "Drafts", "Léa"],
      ["shr_2", "Field notes", "Tom"],
    ]);
    expect(inbox.items[0]?.exposes).toEqual([
      { id: "lib_field", name: "Field notes", visibility: "private" },
      { id: "lib_runbooks", name: "Runbooks", visibility: "workspace" },
    ]);
    expect(inbox.items[1]?.exposes).toEqual([]);
    expect(failure(await useCases.shares.inbox(LEA, { limit: 50, cursor: null })).code).toBe("forbidden");
  });

  test("approving sets the subject's visibility to the workspace; declining needs a reason; both are final", async () => {
    const { useCases, store } = world();
    const approved = unwrap(await useCases.shares.approve(NOOR, "shr_2"));
    expect(approved).toMatchObject({ status: "approved", decidedBy: "usr_noor", decidedAt: NOW });
    expect(store.libraries.find((l) => l.id === "lib_field")?.visibility).toBe("workspace");
    expect(store.auditLog.slice(-2).map((a) => [a.action, a.entityId])).toEqual([
      ["share.approved", "shr_2"],
      ["library.shared", "lib_field"],
    ]);
    expect(failure(await useCases.shares.decline(NOOR, "shr_2", "late")).reason).toBe("forbidden_transition");
    expect(failure(await useCases.shares.decline(NOOR, "shr_4", "  ")).code).toBe("invalid");
    const declined = unwrap(await useCases.shares.decline(NOOR, "shr_4", "Drafts stay private until reviewed."));
    expect(declined).toMatchObject({ status: "declined", reason: "Drafts stay private until reviewed.", decidedBy: "usr_noor" });
    expect(store.libraries.find((l) => l.id === "lib_drafts")?.visibility).toBe("private");
    expect(store.auditLog.at(-1)).toMatchObject({ action: "share.declined", reason: "Drafts stay private until reviewed." });
    expect(failure(await useCases.shares.approve(LEA, "shr_2")).code).toBe("forbidden");
    expect(failure(await useCases.shares.approve(NOOR, "shr_5")).code).toBe("not_found");
  });

  test("an admin or the owner unshares, which takes the thing private again without touching old requests", async () => {
    const { useCases, store } = world();
    unwrap(await useCases.shares.unshare(TOM, { kind: "library", id: "lib_runbooks" }));
    expect(store.libraries.find((l) => l.id === "lib_runbooks")?.visibility).toBe("private");
    expect(store.shareRequests.find((r) => r.id === "shr_1")?.status).toBe("approved");
    expect(store.auditLog.at(-1)).toMatchObject({ action: "library.unshared", entityId: "lib_runbooks", before: { visibility: "workspace" }, after: { visibility: "private" } });
    expect(failure(await useCases.shares.unshare(TOM, { kind: "library", id: "lib_runbooks" })).reason).toBe("forbidden_transition");
    expect(failure(await useCases.shares.unshare(LEA, { kind: "agent", id: "agt_helper" })).code).toBe("forbidden");
    unwrap(await useCases.shares.unshare(NOOR, { kind: "agent", id: "agt_helper" }));
    expect(store.agents.find((a) => a.id === "agt_helper")?.visibility).toBe("private");
  });
});
