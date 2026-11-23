import { describe, expect, test } from "vitest";
import type { Citation, Message, SendEvent } from "@cahier/domain";
import { IDLE, reduce, type StreamState } from "../src/screens/chat/stream";

/*
 * The streamed answer as the chat keeps it: the same events the server emits, folded into one
 * state the message list renders from. Nothing here knows about transport.
 */

const at = new Date("2026-11-23T20:00:00Z");
const user: Message = { id: "msg_u", conversationId: "cnv_1", ordinal: 3, role: "user", body: "How many days?", status: "complete", refusedReason: null, modelId: null, agentVersionId: null, promptTokens: 0, contextTokens: 0, completionTokens: 0, createdAt: at, completedAt: at };
const assistant: Message = { ...user, id: "msg_a", ordinal: 4, role: "assistant", body: "Everyone earns 25 days. [1]", modelId: "small-4", agentVersionId: "agv_1", promptTokens: 12, contextTokens: 300, completionTokens: 9 };
const citation: Citation = { id: "cit_1", messageId: "msg_a", index: 1, chunkId: "chk_1", documentId: "doc_1", documentTitle: "Leave", documentVersion: 1, startChar: 9, endChar: 31, quote: "Everyone earns 25 days." };

const run = (events: SendEvent[], from: StreamState = { phase: "sending", question: "How many days?" }) => events.reduce(reduce, from);

describe("the stream state", () => {
  test("started opens the assistant's message, deltas grow its text, citations and done close it", () => {
    const streaming = run([{ type: "started", userMessage: user, assistantMessageId: "msg_a" }, { type: "delta", text: "Everyone earns " }, { type: "delta", text: "25 days. [1]" }]);
    expect(streaming).toEqual({ phase: "streaming", userMessage: user, assistantMessageId: "msg_a", text: "Everyone earns 25 days. [1]", citations: [] });
    const done = run([{ type: "citations", citations: [citation] }, { type: "done", message: assistant }], streaming);
    expect(done).toEqual({ phase: "done", userMessage: user, message: { ...assistant, citations: [citation] } });
  });

  test("a refusal and a failure end the stream as terminal messages with their reason", () => {
    const refusedMessage = { ...assistant, body: "No budget.", status: "refused" as const, refusedReason: "budget_exhausted" as const };
    expect(run([{ type: "started", userMessage: user, assistantMessageId: "msg_a" }, { type: "refused", message: refusedMessage, reason: "budget_exhausted" }])).toEqual({ phase: "done", userMessage: user, message: { ...refusedMessage, citations: [] } });
    const failedMessage = { ...assistant, status: "failed" as const };
    expect(run([{ type: "started", userMessage: user, assistantMessageId: "msg_a" }, { type: "failed", message: failedMessage, error: "boom" }])).toEqual({ phase: "done", userMessage: user, message: { ...failedMessage, citations: [] } });
  });

  test("a transport error before anything was written goes back to idle with the question kept", () => {
    expect(reduce({ phase: "sending", question: "q" }, { type: "error", message: "offline" })).toEqual({ phase: "error", question: "q", message: "offline" });
    expect(IDLE).toEqual({ phase: "idle" });
  });
});
