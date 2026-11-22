import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { codeOf, reasonOf, startServer, type Server } from "./harness.js";

/*
 * The pipeline over HTTP on the seed: Tom uploads a page into his private library, the document
 * comes back indexed with its chunks, and the viewer's data (text, spans, heading paths) is what
 * the chunks say. Replacing bumps the version, re-indexing keeps it, and uploads can be switched
 * off by the admin.
 */

let server: Server;
type Client = Awaited<ReturnType<Server["signIn"]>>["client"];
let lea: Client;
let tom: Client;
let noor: Client;

const PAGE = ["# Charger faults", "", "A slot that shows a red light has tripped its breaker. Reset it from the cabinet, wait ten seconds, then test with a bike.", "", "## When to call", "", "Call the on-call engineer when three or more slots fail together, or when the modem has rebooted twice in an hour.", ""].join("\n");

beforeAll(async () => {
  server = await startServer();
  ({ client: lea } = await server.signIn("lea@example.com"));
  ({ client: tom } = await server.signIn("tom@example.com"));
  ({ client: noor } = await server.signIn("noor@example.com"));
}, 120_000);

afterAll(async () => {
  await server.close();
});

describe("ingestion", () => {
  let libraryId: string;
  let documentId: string;

  test("uploading a page into an own library indexes it and answers the document with its chunks", async () => {
    libraryId = (await tom.libraries.create.mutate({ name: "Charger manuals", description: "" })).id;
    const { document, chunks } = await tom.documents.upload.mutate({ libraryId, title: "Charger faults", text: PAGE, sourceName: "charger-faults.md" });
    documentId = document.id;
    expect(document).toMatchObject({ status: "indexed", version: 1, mime: "text/markdown", charCount: PAGE.length });
    expect(chunks.map((c) => c.headingPath)).toEqual([["Charger faults"], ["Charger faults", "When to call"]]);
    for (const c of chunks) expect(PAGE.slice(c.startChar, c.endChar)).toBe(c.body);
    const got = await tom.documents.get.query({ id: documentId });
    expect(got.document.body).toBe(PAGE);
    expect(got.chunks).toEqual(chunks);
    expect((await tom.libraries.get.query({ id: libraryId })).library.updatedAt.getTime()).toBeGreaterThanOrEqual(document.createdAt.getTime());
  });

  test("a colleague cannot upload into or replace a library that is not theirs; the admin can", async () => {
    expect(await codeOf(lea.documents.upload.mutate({ libraryId, title: "Mine", text: "Text." }))).toBe("NOT_FOUND");
    expect(await codeOf(lea.documents.reindex.mutate({ id: documentId }))).toBe("NOT_FOUND");
    const { document } = await noor.documents.reindex.mutate({ id: documentId });
    expect(document).toMatchObject({ id: documentId, version: 1, status: "indexed" });
  });

  test("replacing the text bumps the version and rewrites the chunks", async () => {
    const { document, chunks } = await tom.documents.replace.mutate({ id: documentId, text: "# Charger faults\n\nA red light means the breaker tripped. Reset it from the cabinet.", title: "Charger faults, short" });
    expect(document).toMatchObject({ version: 2, title: "Charger faults, short", status: "indexed" });
    expect(chunks).toHaveLength(1);
    expect(await codeOf(tom.documents.replace.mutate({ id: documentId, text: "   " }))).toBe("BAD_REQUEST");
  });

  test("uploads can be switched off for the workspace", async () => {
    await noor.admin.settings.update.mutate({ tools: { uploads: false } });
    expect(await reasonOf(tom.documents.upload.mutate({ libraryId, title: "Another", text: "Text." }))).toBe("tool_off");
    await noor.admin.settings.update.mutate({ tools: { uploads: true } });
    expect((await tom.documents.upload.mutate({ libraryId, title: "Another", text: "Text." })).document.status).toBe("indexed");
  });
});
