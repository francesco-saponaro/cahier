import { describe, expect, test } from "vitest";
import { countTokens } from "../src/text/tokens.js";
import type { SendEvent } from "../src/use-cases/messages.js";
import type { Answerer } from "../src/grounding/compose.js";
import { rateLimiterCreator } from "../src/grounding/rate.js";
import { inMemoryPortsCreator } from "../src/in-memory.js";
import { useCasesCreator } from "../src/use-cases/index.js";
import { LEA, NOOR, NOW, TOM, failure, fixedClock, sequentialIds, unwrap, world } from "./harness.js";
import { fixture } from "./port-contract.js";

/*
 * The pipeline on the small world: Léa asks the Handbook helper (which reads the Handbook and the
 * Runbooks) in a conversation of hers. The answer is streamed as events, cited, metered and
 * audited; the refusals each have their reason and write no usage.
 */

async function collect(events: AsyncIterable<SendEvent>): Promise<SendEvent[]> {
  const out: SendEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

const answerText = (events: SendEvent[]) => events.filter((e) => e.type === "delta").map((e) => (e.type === "delta" ? e.text : "")).join("");

describe("messages.send", () => {
  test("answers from the chunks the member may read: user message, deltas, citations, done, usage, counts", async () => {
    const { useCases, store } = world();
    const events = await collect(unwrap(await useCases.messages.send(LEA, "cnv_2", "How many days do I earn?")));
    expect(events.map((e) => e.type)).toEqual(["started", ...events.filter((e) => e.type === "delta").map(() => "delta"), "citations", "done"]);
    const started = events[0]!;
    if (started.type !== "started") throw new Error(started.type);
    expect(started.userMessage).toMatchObject({ conversationId: "cnv_2", ordinal: 2, role: "user", body: "How many days do I earn?", status: "complete", createdAt: NOW });
    expect(answerText(events)).toBe("Everyone earns 25 days. [1]");
    const citations = events.find((e) => e.type === "citations");
    expect(citations?.type === "citations" && citations.citations).toEqual([expect.objectContaining({ messageId: started.assistantMessageId, index: 1, chunkId: "chk_1", documentId: "doc_leave", documentTitle: "Leave", documentVersion: 1, startChar: 9, endChar: 32, quote: "Everyone earns 25 days." })]);
    const done = events.at(-1)!;
    if (done.type !== "done") throw new Error(done.type);
    const prompt = countTokens("Answer.\nHow many days do I earn?");
    expect(done.message).toMatchObject({ id: started.assistantMessageId, ordinal: 3, role: "assistant", status: "complete", body: "Everyone earns 25 days. [1]", modelId: "small-4", agentVersionId: "agv_h1", promptTokens: prompt, contextTokens: 8, completionTokens: countTokens("Everyone earns 25 days. [1]"), completedAt: NOW });
    const usage = store.usageEvents.filter((u) => u.messageId === started.assistantMessageId);
    expect(usage.map((u) => [u.kind, u.tokens, u.microsPer1k, u.costMicros])).toEqual([
      ["input", prompt, 150, Math.floor((prompt * 150 + 500) / 1000)],
      ["cached_input", 8, 15, 0],
      ["output", done.message.completionTokens, 600, Math.floor((done.message.completionTokens * 600 + 500) / 1000)],
    ]);
    expect(usage.every((u) => u.userId === "usr_lea" && u.agentId === "agt_helper" && u.workspaceId === "ws_oriel" && u.occurredAt.getTime() === NOW.getTime())).toBe(true);
    const conversation = store.conversations.find((c) => c.id === "cnv_2")!;
    expect(conversation).toMatchObject({ messageCount: 4, tokenTotal: 100 + prompt + 8 + done.message.completionTokens, lastMessageAt: NOW, title: "Expenses abroad" });
    expect(store.auditLog.at(-1)).toMatchObject({ action: "message.completed", entityKind: "message", entityId: started.assistantMessageId, actorId: "usr_lea", after: { status: "complete", citations: 1 } });
  });

  test("the first question titles a new conversation", async () => {
    const { useCases, store } = world();
    const conversation = unwrap(await useCases.conversations.create(LEA, "agt_helper"));
    await collect(unwrap(await useCases.messages.send(LEA, conversation.id, "Tell me about the days of leave everyone earns, and whether the receipt rule applies to lunch on a trip")));
    expect(store.conversations.find((c) => c.id === conversation.id)!.title).toBe("Tell me about the days of leave everyone earns, and wheth...");
  });

  test("refuses to answer from a private library the member may not read, even through a shared agent", async () => {
    const { useCases, store } = world((s) => {
      // The helper's current version also reads Tom's private Field notes, which hold the only page about chargers.
      s.agentVersionLibraries.push({ agentVersionId: "agv_h1", libraryId: "lib_field" });
      s.documents.push({ id: "doc_chargers", libraryId: "lib_field", title: "Chargers", sourceName: "c.md", mime: "text/markdown", byteSize: 40, charCount: 40, body: "Reset the charger from the cabinet first.", status: "indexed", error: null, version: 1, uploadedBy: "usr_tom", createdAt: NOW, indexedAt: NOW });
      s.chunks.push({ id: "chk_c", documentId: "doc_chargers", ordinal: 0, headingPath: [], headingText: "", startChar: 0, endChar: 41, tokenCount: 9, body: "Reset the charger from the cabinet first." });
    });
    const lea = await collect(unwrap(await useCases.messages.send(LEA, "cnv_2", "How do I reset the charger?")));
    expect(lea.at(-1)).toMatchObject({ type: "refused", reason: "no_sources" });
    expect(store.usageEvents.filter((u) => u.userId === "usr_lea" && u.occurredAt.getTime() === NOW.getTime())).toEqual([]);
    const tomsConversation = unwrap(await useCases.conversations.create(TOM, "agt_helper"));
    const tom = await collect(unwrap(await useCases.messages.send(TOM, tomsConversation.id, "How do I reset the charger?")));
    expect(answerText(tom)).toBe("Reset the charger from the cabinet first. [1]");
  });

  test("a refused answer is a terminal message with its reason and no usage: tool off, nothing found, no price", async () => {
    const { useCases, store } = world();
    store.workspaces[0]!.tools.groundedAnswers = false;
    const off = await collect(unwrap(await useCases.messages.send(LEA, "cnv_2", "How many days do I earn?")));
    expect(off.map((e) => e.type)).toEqual(["started", "refused"]);
    expect(off[1]).toMatchObject({ type: "refused", reason: "tool_off", message: { status: "refused", refusedReason: "tool_off", role: "assistant", ordinal: 3 } });
    store.workspaces[0]!.tools.groundedAnswers = true;
    const nothing = await collect(unwrap(await useCases.messages.send(LEA, "cnv_2", "Where is the car park?")));
    expect(nothing.at(-1)).toMatchObject({ type: "refused", reason: "no_sources" });
    store.agentVersions.find((v) => v.id === "agv_h1")!.modelId = "large-4"; // no cached_input price in the fixture
    const unpriced = await collect(unwrap(await useCases.messages.send(LEA, "cnv_2", "How many days do I earn?")));
    expect(unpriced.at(-1)).toMatchObject({ type: "refused", reason: "no_price" });
    expect(store.usageEvents.filter((u) => u.occurredAt.getTime() === NOW.getTime())).toEqual([]);
    expect(store.messages.filter((m) => m.conversationId === "cnv_2").map((m) => m.ordinal)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(store.conversations.find((c) => c.id === "cnv_2")!.messageCount).toBe(8);
    expect(store.auditLog.filter((a) => a.action === "message.refused")).toHaveLength(3);
  });

  test("the month's budget is checked against the estimate before answering", async () => {
    const { useCases, store } = world();
    const budget = store.budgets.find((b) => b.id === "bud_1")!;
    budget.limitMicros = 1201; // exactly what September's rows already cost
    const events = await collect(unwrap(await useCases.messages.send(LEA, "cnv_2", "How many days do I earn?")));
    expect(events.at(-1)).toMatchObject({ type: "refused", reason: "budget_exhausted" });
    budget.limitMicros = 2_000_000;
    expect((await collect(unwrap(await useCases.messages.send(LEA, "cnv_2", "How many days do I earn?")))).at(-1)?.type).toBe("done");
    // No budget row for the month means no cap.
    store.budgets.splice(store.budgets.indexOf(budget), 1);
    expect((await collect(unwrap(await useCases.messages.send(LEA, "cnv_2", "How many days do I earn?")))).at(-1)?.type).toBe("done");
  });

  test("the member's rate limit refuses the question over the limit, and the tokens of an answer are spent against it", async () => {
    const store = fixture();
    const { ports, unitOfWork } = inMemoryPortsCreator(store);
    const clock = fixedClock();
    const rateLimiter = rateLimiterCreator(clock, { requestsPerMinute: 2, tokensPerMinute: 10_000 });
    const useCases = useCasesCreator({ ports, unitOfWork, clock, ids: sequentialIds(), sessionHours: 72, rateLimiter });
    expect((await collect(unwrap(await useCases.messages.send(LEA, "cnv_2", "How many days do I earn?")))).at(-1)?.type).toBe("done");
    expect(rateLimiter.peek("usr_lea").requests).toBe(1);
    expect(rateLimiter.peek("usr_lea").tokens).toBeLessThan(10_000);
    expect((await collect(unwrap(await useCases.messages.send(LEA, "cnv_2", "How many days do I earn?")))).at(-1)?.type).toBe("done");
    expect((await collect(unwrap(await useCases.messages.send(LEA, "cnv_2", "How many days do I earn?")))).at(-1)).toMatchObject({ type: "refused", reason: "rate_limited" });
    // Another member has their own bucket.
    const tom = unwrap(await useCases.conversations.create(TOM, "agt_helper"));
    expect((await collect(unwrap(await useCases.messages.send(TOM, tom.id, "How many days do I earn?")))).at(-1)?.type).toBe("done");
  });

  test("a failure while composing marks the message failed and still meters the prompt", async () => {
    const store = fixture();
    const { ports, unitOfWork } = inMemoryPortsCreator(store);
    const broken: Answerer = { compose: async () => Promise.reject(new Error("the model is away")) };
    const useCases = useCasesCreator({ ports, unitOfWork, clock: fixedClock(), ids: sequentialIds(), sessionHours: 72, answerer: broken });
    const events = await collect(unwrap(await useCases.messages.send(LEA, "cnv_2", "How many days do I earn?")));
    expect(events.map((e) => e.type)).toEqual(["started", "failed"]);
    expect(events[1]).toMatchObject({ type: "failed", error: "the model is away", message: { status: "failed", body: "", completionTokens: 0, contextTokens: 8 } });
    const usage = store.usageEvents.filter((u) => u.occurredAt.getTime() === NOW.getTime());
    expect(usage.map((u) => [u.kind, u.tokens])).toEqual([
      ["input", countTokens("Answer.\nHow many days do I earn?")],
      ["cached_input", 8],
    ]);
    expect(store.auditLog.at(-1)).toMatchObject({ action: "message.failed", after: { status: "failed", error: "the model is away" } });
  });

  test("refuses before starting: not the member's conversation, archived, an agent no longer usable, no text", async () => {
    const { useCases, store } = world();
    expect(failure(await useCases.messages.send(TOM, "cnv_2", "Hello")).code).toBe("not_found");
    expect(failure(await useCases.messages.send(NOOR, "cnv_2", "Hello")).code).toBe("not_found");
    expect(failure(await useCases.messages.send(LEA, "cnv_3", "Hello"))).toMatchObject({ code: "rule", reason: "conversation_archived" });
    expect(failure(await useCases.messages.send(LEA, "cnv_2", "   ")).code).toBe("invalid");
    expect(failure(await useCases.messages.send(LEA, "cnv_2", "x".repeat(4001))).code).toBe("invalid");
    store.agents.find((a) => a.id === "agt_helper")!.status = "archived";
    expect(failure(await useCases.messages.send(LEA, "cnv_2", "Hello"))).toMatchObject({ code: "rule", reason: "agent_unusable" });
    expect(store.messages.filter((m) => m.conversationId === "cnv_2")).toEqual([]);
  });

  test("the packed context stays under the version's budget and the message records the version that answered", async () => {
    const { useCases, store } = world((s) => {
      s.agentVersions.find((v) => v.id === "agv_h1")!.maxContextTokens = 512;
      s.agentVersions.find((v) => v.id === "agv_h1")!.instructions = "x ".repeat(200); // 200 tokens of instructions
    });
    const events = await collect(unwrap(await useCases.messages.send(LEA, "cnv_2", "How many days do I earn and what about the receipt?")));
    const done = events.at(-1)!;
    if (done.type !== "done") throw new Error(done.type);
    expect(done.message.promptTokens + done.message.contextTokens + 256).toBeLessThanOrEqual(512);
    expect(done.message.agentVersionId).toBe("agv_h1");
    expect(store.conversations.find((c) => c.id === "cnv_2")!.agentVersionId).toBe("agv_h1");
  });
});
