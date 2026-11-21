import { describe, expect, test } from "vitest";
import { LEA, NOOR, NOW, TOM, failure, unwrap, world } from "./harness.js";

describe("libraries", () => {
  test("a member lists own and shared libraries; only an admin lists them all", async () => {
    const { useCases } = world();
    expect(unwrap(await useCases.libraries.list(TOM, { limit: 50, cursor: null, scope: "own", sort: "name" })).items.map((l) => l.name)).toEqual(["Field notes", "Runbooks"]);
    expect(unwrap(await useCases.libraries.list(LEA, { limit: 50, cursor: null, scope: "shared", sort: "name" })).items.map((l) => l.name)).toEqual(["Handbook", "Runbooks"]);
    expect(failure(await useCases.libraries.list(LEA, { limit: 50, cursor: null, scope: "all", sort: "name" })).code).toBe("forbidden");
    expect(unwrap(await useCases.libraries.list(NOOR, { limit: 50, cursor: null, scope: "all", sort: "name" })).items).toHaveLength(4);
  });

  test("get answers the library with its owner's name and pending request to those who may read it", async () => {
    const { useCases } = world();
    const field = unwrap(await useCases.libraries.get(TOM, "lib_field"));
    expect(field.library.name).toBe("Field notes");
    expect(field.ownerName).toBe("Tom");
    expect(field.pendingShare?.id).toBe("shr_2");
    expect(unwrap(await useCases.libraries.get(LEA, "lib_handbook")).pendingShare).toBeNull();
    expect(failure(await useCases.libraries.get(LEA, "lib_field")).code).toBe("not_found");
    expect(unwrap(await useCases.libraries.get(NOOR, "lib_field")).library.id).toBe("lib_field");
    expect(failure(await useCases.libraries.get(NOOR, "lib_manual")).code).toBe("not_found");
  });

  test("creating makes a private library with a slug from the name, unique in the workspace, and audits it", async () => {
    const { useCases, store } = world();
    const made = unwrap(await useCases.libraries.create(LEA, { name: "  Field Notes ", description: "Léa's own" }));
    expect(made).toMatchObject({ workspaceId: "ws_oriel", ownerId: "usr_lea", slug: "field-notes-2", name: "Field Notes", description: "Léa's own", visibility: "private", createdAt: NOW, updatedAt: NOW });
    expect(store.auditLog.at(-1)).toMatchObject({ action: "library.created", entityKind: "library", entityId: made.id, actorId: "usr_lea", after: { name: "Field Notes" } });
    expect(failure(await useCases.libraries.create(LEA, { name: "   ", description: "" })).code).toBe("invalid");
    expect(failure(await useCases.libraries.create(LEA, { name: "x".repeat(81), description: "" })).code).toBe("invalid");
  });

  test("the owner or an admin updates and removes a library; a colleague may not", async () => {
    const { useCases, store } = world();
    const updated = unwrap(await useCases.libraries.update(TOM, "lib_field", { name: "Site visits" }));
    expect(updated).toMatchObject({ name: "Site visits", slug: "field-notes", updatedAt: NOW });
    expect(store.auditLog.at(-1)).toMatchObject({ action: "library.updated", before: { name: "Field notes", description: "" }, after: { name: "Site visits", description: "" } });
    expect(failure(await useCases.libraries.update(LEA, "lib_runbooks", { name: "Mine now" })).code).toBe("forbidden");
    unwrap(await useCases.libraries.update(NOOR, "lib_runbooks", { description: "Kept by the admin" }));
    unwrap(await useCases.libraries.remove(TOM, "lib_field"));
    expect(store.libraries.some((l) => l.id === "lib_field")).toBe(false);
    expect(store.auditLog.at(-1)).toMatchObject({ action: "library.removed", entityId: "lib_field" });
    expect(failure(await useCases.libraries.remove(LEA, "lib_handbook")).code).toBe("forbidden");
    expect(failure(await useCases.libraries.remove(LEA, "lib_nowhere")).code).toBe("not_found");
  });
});

describe("documents", () => {
  test("a member lists and reads the documents of a library they may read, with the chunks on the detail", async () => {
    const { useCases } = world();
    const list = unwrap(await useCases.documents.list(LEA, "lib_handbook", { limit: 50, cursor: null, sort: "title" }));
    expect(list.items.map((d) => d.title)).toEqual(["Empty", "Expenses", "Leave"]);
    const detail = unwrap(await useCases.documents.get(LEA, "doc_expenses"));
    expect(detail.document.body).toContain("Keep the receipt");
    expect(detail.library.name).toBe("Handbook");
    expect(detail.chunks.map((c) => c.ordinal)).toEqual([0, 1]);
    expect(failure(await useCases.documents.list(LEA, "lib_field", { limit: 50, cursor: null, sort: "title" })).code).toBe("not_found");
    expect(failure(await useCases.documents.get(LEA, "doc_nowhere")).code).toBe("not_found");
  });

  test("the library's owner or an admin removes a document, which audits and keeps past citations' quotes", async () => {
    const { useCases, store } = world();
    expect(failure(await useCases.documents.remove(LEA, "doc_leave")).code).toBe("forbidden");
    unwrap(await useCases.documents.remove(NOOR, "doc_leave"));
    expect(store.documents.some((d) => d.id === "doc_leave")).toBe(false);
    expect(store.chunks.some((c) => c.documentId === "doc_leave")).toBe(false);
    expect(store.citations.find((c) => c.id === "cit_1")).toMatchObject({ documentId: null, chunkId: null, quote: "Everyone earns 25 days." });
    expect(store.auditLog.at(-1)).toMatchObject({ action: "document.removed", entityId: "doc_leave", before: { title: "Leave", libraryId: "lib_handbook" } });
  });
});
