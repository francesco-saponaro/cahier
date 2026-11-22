import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { SendEvent } from "@cahier/domain";
import { codeOf, collect, reasonOf, startServer, type Server } from "./harness.js";

/*
 * The pipeline over HTTP on the seed: Tom uploads a page into his private library, the document
 * comes back indexed with its chunks, and the viewer's data (text, spans, heading paths) is what
 * the chunks say. Replacing bumps the version, re-indexing keeps it, and uploads can be switched
 * off by the admin. Then Tom asks his agent a question: the answer streams over SSE as events,
 * the citations point into the page, the usage rows and the budget move, and the refusals
 * come back with their reason.
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

describe("asking", () => {
  let agentId: string;
  let conversationId: string;
  const month = new Date().toISOString().slice(0, 7);

  const ask = (client: Client, id: string, text: string) => collect<SendEvent>((handlers) => client.messages.send.subscribe({ conversationId: id, text }, handlers));

  test("the answer streams as events, with citations into the uploaded page, and lands in the conversation", async () => {
    const libraryId = (await tom.libraries.list.query({ scope: "own", sort: "name", limit: 50 })).items.find((l) => l.name === "Charger manuals")!.id;
    const made = await tom.agents.create.mutate({ name: "Charger expert", description: "", instructions: "Answer from the manuals only.", modelId: "small-4", maxContextTokens: 4000, libraryIds: [libraryId] });
    agentId = made.agent.id;
    await tom.agents.publish.mutate({ versionId: made.version.id });
    conversationId = (await tom.conversations.create.mutate({ agentId })).id;
    const events = await ask(tom, conversationId, "What does a red light on a slot mean?");
    expect(events[0]?.type).toBe("started");
    expect(events.at(-1)?.type).toBe("done");
    const text = events.filter((e) => e.type === "delta").map((e) => (e.type === "delta" ? e.text : "")).join("");
    expect(text).toBe("A red light means the breaker tripped. [1]");
    const citations = events.find((e) => e.type === "citations");
    expect(citations?.type === "citations" ? citations.citations : []).toEqual([expect.objectContaining({ index: 1, documentTitle: "Charger faults, short", documentVersion: 2, quote: "A red light means the breaker tripped." })]);
    const messages = await tom.messages.list.query({ conversationId, limit: 50 });
    expect(messages.items.map((m) => [m.ordinal, m.role, m.status, m.citations.length])).toEqual([
      [0, "user", "complete", 0],
      [1, "assistant", "complete", 1],
    ]);
    const citation = messages.items[1]!.citations[0]!;
    const page = await tom.documents.get.query({ id: citation.documentId! });
    expect(page.document.body.slice(citation.startChar, citation.endChar)).toBe(citation.quote);
    const conversation = (await tom.conversations.get.query({ id: conversationId })).conversation;
    expect(conversation).toMatchObject({ title: "What does a red light on a slot mean?", messageCount: 2 });
    expect(conversation.tokenTotal).toBe(messages.items[1]!.promptTokens + messages.items[1]!.contextTokens + messages.items[1]!.completionTokens);
    const mine = await tom.usage.mine.query({ month });
    expect(mine.tokens).toBeGreaterThanOrEqual(conversation.tokenTotal);
  });

  test("nothing found is a refusal with its reason, and so is an exhausted budget", async () => {
    const nothing = await ask(tom, conversationId, "What is the canteen menu on Fridays?");
    expect(nothing.at(-1)).toMatchObject({ type: "refused", reason: "no_sources" });
    const report = await noor.admin.usage.report.query({ month });
    await noor.admin.budgets.set.mutate({ month, limitMicros: report.total.costMicros });
    const exhausted = await ask(tom, conversationId, "What does a red light on a slot mean?");
    expect(exhausted.at(-1)).toMatchObject({ type: "refused", reason: "budget_exhausted" });
    await noor.admin.budgets.set.mutate({ month, limitMicros: 50_000_000 });
    expect((await ask(tom, conversationId, "What does a red light on a slot mean?")).at(-1)?.type).toBe("done");
    expect((await tom.conversations.get.query({ id: conversationId })).conversation.messageCount).toBe(8);
  });

  test("a colleague cannot send into Tom's conversation, and a bad input is refused before anything is written", async () => {
    await expect(ask(lea, conversationId, "Hello")).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(ask(tom, conversationId, "")).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
    await expect(ask(tom, "cnv_nothing", "Hello")).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    expect((await tom.conversations.get.query({ id: conversationId })).conversation.messageCount).toBe(8);
  });

  test("without a token the subscription is unauthorized", async () => {
    await expect(ask(server.clientFor(), conversationId, "Hello")).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
  });
});

describe("scheduled prompts", () => {
  test("runNow runs the member's schedule at once as a conversation of theirs and answers the run", async () => {
    const helper = (await lea.agents.list.query({ scope: "shared", sort: "name", limit: 50 })).items.find((a) => a.name === "Handbook helper")!;
    const schedule = await lea.schedules.create.mutate({ agentId: helper.id, name: "Leave check", prompt: "How many days of paid leave do I earn a year?", cadence: "weekly", atMinute: 9 * 60, weekday: 1, dayOfMonth: null, timezone: "Europe/Paris" });
    const run = await lea.schedules.runNow.mutate({ id: schedule.id });
    expect(run).toMatchObject({ scheduledPromptId: schedule.id, status: "succeeded", error: null });
    expect(run.conversationId).toBeTruthy();
    const conversation = (await lea.conversations.get.query({ id: run.conversationId! })).conversation;
    expect(conversation).toMatchObject({ title: "Leave check", messageCount: 2 });
    const messages = await lea.messages.list.query({ conversationId: run.conversationId!, limit: 10 });
    expect(messages.items[1]?.body).toContain("25 working days");
    expect((await lea.schedules.get.query({ id: schedule.id })).runs.map((r) => r.id)).toEqual([run.id]);
    expect((await lea.schedules.get.query({ id: schedule.id })).schedule.nextRunAt).toEqual(schedule.nextRunAt);
    expect(await codeOf(tom.schedules.runNow.mutate({ id: schedule.id }))).toBe("NOT_FOUND");
    await lea.schedules.end.mutate({ id: schedule.id });
    expect(await reasonOf(lea.schedules.runNow.mutate({ id: schedule.id }))).toBe("forbidden_transition");
  });
});
