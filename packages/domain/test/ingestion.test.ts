import { describe, expect, test } from "vitest";
import { LEA, NOOR, NOW, TOM, failure, unwrap, world } from "./harness.js";

const HANDBOOK_PAGE = ["# Remote work", "", "Anyone may work from home up to three days a week. Tell your team the day before.", "", "## Equipment", "", "Oriel pays for a screen, a chair and a keyboard, up to 600 euros, once every four years.", ""].join("\n");

describe("documents.upload", () => {
  test("writes the document, chunks it and marks it indexed, with an audit row for every step", async () => {
    const { useCases, store } = world();
    const { document, chunks } = unwrap(await useCases.documents.upload(TOM, { libraryId: "lib_field", title: " Remote work ", text: HANDBOOK_PAGE, sourceName: "remote-work.md" }));
    expect(document).toMatchObject({ libraryId: "lib_field", title: "Remote work", sourceName: "remote-work.md", mime: "text/markdown", status: "indexed", version: 1, uploadedBy: "usr_tom", charCount: HANDBOOK_PAGE.length, byteSize: HANDBOOK_PAGE.length, error: null, createdAt: NOW, indexedAt: NOW });
    expect(document.body).toBe(HANDBOOK_PAGE);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.documentId).toBe(document.id);
      expect(HANDBOOK_PAGE.slice(c.startChar, c.endChar)).toBe(c.body);
      expect(c.headingText).toBe(c.headingPath.join(" > "));
    }
    expect(chunks[0]!.headingPath).toEqual(["Remote work"]);
    expect(await useCases.documents.get(TOM, document.id).then(unwrap)).toMatchObject({ chunks });
    expect(store.auditLog.slice(-3).map((a) => [a.action, a.before, a.after])).toEqual([
      ["document.uploaded", null, { title: "Remote work", libraryId: "lib_field", version: 1 }],
      ["document.processing", { status: "uploaded" }, { status: "processing" }],
      ["document.indexed", { status: "processing" }, { status: "indexed", chunks: chunks.length }],
    ]);
  });

  test("plain text without headings is text/plain, and the source name defaults to the title", async () => {
    const { useCases } = world();
    const { document, chunks } = unwrap(await useCases.documents.upload(LEA, { libraryId: "lib_drafts", title: "Note", text: "One line of plain text." }));
    expect(document).toMatchObject({ mime: "text/plain", sourceName: "Note.txt" });
    expect(chunks.map((c) => c.body)).toEqual(["One line of plain text."]);
  });

  test("refuses when uploads are switched off, into a library the member may not change, and with no text", async () => {
    const { useCases, store } = world();
    expect(failure(await useCases.documents.upload(LEA, { libraryId: "lib_runbooks", title: "Mine", text: "Text." })).code).toBe("forbidden");
    expect(failure(await useCases.documents.upload(LEA, { libraryId: "lib_field", title: "Mine", text: "Text." })).code).toBe("not_found");
    expect(failure(await useCases.documents.upload(LEA, { libraryId: "lib_drafts", title: "Mine", text: "   \n " })).code).toBe("invalid");
    expect(failure(await useCases.documents.upload(LEA, { libraryId: "lib_drafts", title: "  ", text: "Text." })).code).toBe("invalid");
    expect(failure(await useCases.documents.upload(LEA, { libraryId: "lib_drafts", title: "Big", text: "x".repeat(400_001) })).code).toBe("invalid");
    store.workspaces[0]!.tools.uploads = false;
    expect(failure(await useCases.documents.upload(LEA, { libraryId: "lib_drafts", title: "Mine", text: "Text." }))).toMatchObject({ code: "rule", reason: "tool_off" });
    // An admin may upload into any library of the workspace.
    store.workspaces[0]!.tools.uploads = true;
    expect(unwrap(await useCases.documents.upload(NOOR, { libraryId: "lib_field", title: "From the admin", text: "Text." })).document.uploadedBy).toBe("usr_noor");
  });
});

describe("documents.replace and reindex", () => {
  test("replacing bumps the version and rewrites the chunks; an old citation keeps its quote and version", async () => {
    const { useCases, store } = world();
    const before = store.citations.find((c) => c.id === "cit_1")!;
    const { document, chunks } = unwrap(await useCases.documents.replace(NOOR, "doc_leave", { text: "# Leave\n\nEveryone earns 27 days from next year." }));
    expect(document).toMatchObject({ id: "doc_leave", version: 2, status: "indexed", charCount: 47 });
    expect(chunks.map((c) => c.body)).toEqual(["# Leave\n\nEveryone earns 27 days from next year."]);
    expect(chunks[0]!.id).not.toBe("chk_1");
    const after = store.citations.find((c) => c.id === "cit_1")!;
    expect(after).toMatchObject({ quote: before.quote, documentVersion: 1, documentId: "doc_leave", chunkId: null });
    expect(store.auditLog.slice(-3).map((a) => a.action)).toEqual(["document.replaced", "document.processing", "document.indexed"]);
    expect(store.auditLog.at(-3)).toMatchObject({ before: { version: 1 }, after: { version: 2 } });
  });

  test("replacing may also retitle; a colleague may not replace, and empty text is refused", async () => {
    const { useCases } = world();
    expect(unwrap(await useCases.documents.replace(NOOR, "doc_leave", { text: "New text.", title: "Leave policy" })).document).toMatchObject({ title: "Leave policy", version: 2 });
    expect(failure(await useCases.documents.replace(LEA, "doc_leave", { text: "Mine." })).code).toBe("forbidden");
    expect(failure(await useCases.documents.replace(TOM, "doc_draft", { text: "Mine." })).code).toBe("not_found");
    expect(failure(await useCases.documents.replace(NOOR, "doc_leave", { text: " " })).code).toBe("invalid");
  });

  test("reindexing keeps the version and rewrites the chunks with the current chunker", async () => {
    const { useCases, store } = world();
    const { document, chunks } = unwrap(await useCases.documents.reindex(NOOR, "doc_expenses"));
    expect(document).toMatchObject({ version: 1, status: "indexed" });
    expect(chunks.map((c) => c.body)).toEqual(["# Expenses\n\nKeep the receipt."]);
    expect(chunks[0]!.headingPath).toEqual(["Expenses"]);
    expect(store.chunks.filter((c) => c.documentId === "doc_expenses")).toHaveLength(1);
    // An uploaded document that never got indexed can be indexed now.
    expect(unwrap(await useCases.documents.reindex(LEA, "doc_draft")).document.status).toBe("indexed");
    expect(failure(await useCases.documents.reindex(LEA, "doc_expenses")).code).toBe("forbidden");
    expect(failure(await useCases.documents.reindex(TOM, "doc_draft")).code).toBe("not_found");
  });
});
