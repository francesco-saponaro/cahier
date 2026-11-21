import { describe, expect, test } from "vitest";
import { DAY, LEA, NOOR, NOW, TOM, failure, unwrap, world } from "./harness.js";

const draft = { name: "Expenses helper", description: "Expenses only", instructions: "Answer from the handbook's expenses page.", modelId: "small-4", maxContextTokens: 4000, libraryIds: ["lib_handbook"] };

describe("agents", () => {
  test("a member lists own and shared agents, an admin all; get shows the versions with their libraries", async () => {
    const { useCases } = world();
    expect(unwrap(await useCases.agents.list(LEA, { limit: 50, cursor: null, scope: "shared", sort: "name" })).items.map((a) => a.name)).toEqual(["Handbook helper", "Old bot"]);
    expect(failure(await useCases.agents.list(LEA, { limit: 50, cursor: null, scope: "all", sort: "name" })).code).toBe("forbidden");
    const helper = unwrap(await useCases.agents.get(LEA, "agt_helper"));
    expect(helper.agent.currentVersionId).toBe("agv_h1");
    expect(helper.ownerName).toBe("Noor");
    expect(helper.versions.map((v) => [v.version, v.status, v.libraryIds])).toEqual([
      [1, "retired", ["lib_handbook"]],
      [2, "published", ["lib_handbook", "lib_runbooks"]],
      [3, "draft", ["lib_handbook"]],
    ]);
    expect(failure(await useCases.agents.get(LEA, "agt_field")).code).toBe("not_found");
    expect(unwrap(await useCases.agents.get(NOOR, "agt_field")).agent.name).toBe("Field agent");
  });

  test("creating makes a private active agent with version 1 as a draft over libraries the creator may read", async () => {
    const { useCases, store } = world();
    const made = unwrap(await useCases.agents.create(LEA, draft));
    expect(made.agent).toMatchObject({ workspaceId: "ws_oriel", ownerId: "usr_lea", slug: "expenses-helper", name: "Expenses helper", visibility: "private", status: "active", currentVersionId: null, createdAt: NOW });
    expect(made.version).toMatchObject({ agentId: made.agent.id, version: 1, status: "draft", modelId: "small-4", maxContextTokens: 4000, createdBy: "usr_lea", publishedAt: null });
    expect(store.agentVersionLibraries.filter((x) => x.agentVersionId === made.version.id).map((x) => x.libraryId)).toEqual(["lib_handbook"]);
    expect(store.auditLog.slice(-2).map((a) => a.action)).toEqual(["agent.created", "agent_version.drafted"]);
    expect(failure(await useCases.agents.create(LEA, { ...draft, libraryIds: ["lib_field"] })).code).toBe("forbidden");
    expect(failure(await useCases.agents.create(LEA, { ...draft, modelId: "mini-3b" })).code).toBe("invalid");
    expect(failure(await useCases.agents.create(LEA, { ...draft, modelId: "nothing" })).code).toBe("invalid");
    expect(failure(await useCases.agents.create(LEA, { ...draft, maxContextTokens: 200 })).code).toBe("invalid");
    expect(failure(await useCases.agents.create(LEA, { ...draft, name: "" })).code).toBe("invalid");
  });

  test("saving a draft rewrites the open draft, or opens the next version when the latest one is published", async () => {
    const { useCases, store } = world();
    const kept = unwrap(await useCases.agents.saveDraft(NOOR, "agt_helper", { ...draft, name: "Handbook helper", libraryIds: ["lib_handbook", "lib_runbooks"] }));
    expect(kept).toMatchObject({ id: "agv_h2", version: 3, status: "draft", name: "Handbook helper" });
    expect(store.agentVersions.filter((v) => v.agentId === "agt_helper")).toHaveLength(3);
    const opened = unwrap(await useCases.agents.saveDraft(TOM, "agt_field", { ...draft, name: "Field agent", libraryIds: ["lib_field"] }));
    expect(opened).toMatchObject({ agentId: "agt_field", version: 2, status: "draft", createdBy: "usr_tom" });
    expect(store.agents.find((a) => a.id === "agt_field")?.currentVersionId).toBe("agv_f1");
    expect(failure(await useCases.agents.saveDraft(LEA, "agt_helper", draft)).code).toBe("forbidden");
    expect(failure(await useCases.agents.saveDraft(NOOR, "agt_old", draft)).reason).toBe("agent_archived");
  });

  test("publishing retires the current version and makes the draft the one that answers", async () => {
    const { useCases, store } = world();
    const published = unwrap(await useCases.agents.publish(NOOR, "agv_h2"));
    expect(published).toMatchObject({ id: "agv_h2", status: "published", publishedAt: NOW });
    expect(store.agentVersions.find((v) => v.id === "agv_h1")?.status).toBe("retired");
    expect(store.agents.find((a) => a.id === "agt_helper")?.currentVersionId).toBe("agv_h2");
    expect(store.auditLog.at(-1)).toMatchObject({ action: "agent_version.published", entityId: "agv_h2", after: { status: "published", version: 3 } });
    expect(failure(await useCases.agents.publish(NOOR, "agv_h2")).reason).toBe("forbidden_transition");
    const first = unwrap(await useCases.agents.publish(LEA, "agv_n1"));
    expect(first.status).toBe("published");
    expect(store.agents.find((a) => a.id === "agt_new")?.currentVersionId).toBe("agv_n1");
  });

  test("rolling back republishes a retired version under its own number and retires the current one", async () => {
    const { useCases, store } = world();
    const back = unwrap(await useCases.agents.rollBack(NOOR, "agv_h0"));
    expect(back).toMatchObject({ id: "agv_h0", version: 1, status: "published" });
    expect(store.agentVersions.find((v) => v.id === "agv_h1")?.status).toBe("retired");
    expect(store.agents.find((a) => a.id === "agt_helper")?.currentVersionId).toBe("agv_h0");
    expect(store.auditLog.at(-1)).toMatchObject({ action: "agent_version.rolled_back", entityId: "agv_h0", before: { currentVersion: 2 }, after: { currentVersion: 1 } });
    expect(failure(await useCases.agents.rollBack(NOOR, "agv_h2")).reason).toBe("forbidden_transition");
    expect(failure(await useCases.agents.rollBack(TOM, "agv_h1")).code).toBe("forbidden");
  });

  test("archiving stops new conversations and is final", async () => {
    const { useCases, store, clock } = world();
    clock.advance(DAY);
    const archived = unwrap(await useCases.agents.archive(NOOR, "agt_helper"));
    expect(archived).toMatchObject({ status: "archived", archivedAt: new Date(NOW.getTime() + DAY) });
    expect(store.auditLog.at(-1)).toMatchObject({ action: "agent.archived", entityId: "agt_helper" });
    expect(failure(await useCases.agents.archive(NOOR, "agt_helper")).reason).toBe("forbidden_transition");
    expect(failure(await useCases.agents.archive(LEA, "agt_field")).code).toBe("not_found");
    expect(failure(await useCases.agents.publish(NOOR, "agv_h2")).reason).toBe("agent_archived");
  });
});
