import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { Citation, Message } from "@cahier/domain";
import { MessageList } from "../src/screens/chat/MessageList";

const at = new Date("2026-11-23T20:00:00Z");
const base: Message = { id: "m", conversationId: "cnv_1", ordinal: 0, role: "user", body: "", status: "complete", refusedReason: null, modelId: null, agentVersionId: null, promptTokens: 0, contextTokens: 0, completionTokens: 0, createdAt: at, completedAt: at };
const cite = (index: number, documentId: string | null): Citation => ({ id: `cit_${index}`, messageId: "a", index, chunkId: null, documentId, documentTitle: `Doc ${index}`, documentVersion: 2, startChar: 10 * index, endChar: 10 * index + 5, quote: "quote" });
const me = { id: "usr_lea", name: "Léa Marchetti" };

describe("the message list", () => {
  test("renders the thread in order with each answer's lines carrying their citation chips", () => {
    const messages = [
      { ...base, id: "u", ordinal: 1, body: "How many days?", citations: [] },
      { ...base, id: "a", ordinal: 2, role: "assistant" as const, body: "Everyone earns 25 days. [1]\nTell your manager first. [2]", modelId: "small-4", promptTokens: 12, contextTokens: 300, completionTokens: 9, citations: [cite(1, "doc_1"), cite(2, null)] },
    ];
    render(<MessageList messages={messages} me={me} agentName="Handbook helper" stream={{ phase: "idle" }} />);
    const items = screen.getAllByRole("article");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Léa Marchetti")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Handbook helper")).toBeInTheDocument();
    const chip1 = within(items[1]!).getByRole("link", { name: "Citation 1: Doc 1" });
    expect(chip1).toHaveAttribute("href", "/documents/view?id=doc_1&from=10&to=15&v=2");
    // A citation whose document was removed keeps its quote but opens nothing.
    expect(within(items[1]!).queryByRole("link", { name: "Citation 2: Doc 2" })).toBeNull();
    expect(within(items[1]!).getByTitle("The document was removed; the quote is kept.")).toHaveTextContent("[2]");
    expect(within(items[1]!).getByText(/321 tokens/)).toBeInTheDocument();
  });

  test("a refused answer reads as the reason in words, not as an answer", () => {
    const messages = [{ ...base, id: "r", ordinal: 1, role: "assistant" as const, body: "The workspace has used its token budget for the month.", status: "refused" as const, refusedReason: "budget_exhausted" as const, citations: [] }];
    render(<MessageList messages={messages} me={me} agentName="Helper" stream={{ phase: "idle" }} />);
    const item = screen.getByRole("article");
    expect(item).toHaveClass("refused");
    expect(within(item).getByText("Refused: budget exhausted")).toBeInTheDocument();
  });

  test("while streaming, the question and the growing answer show after the thread", () => {
    const user = { ...base, id: "u2", ordinal: 5, body: "What about sick leave?" };
    render(<MessageList messages={[]} me={me} agentName="Helper" stream={{ phase: "streaming", userMessage: user, assistantMessageId: "x", text: "Tell your manager", citations: [] }} />);
    const items = screen.getAllByRole("article");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("What about sick leave?")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Tell your manager")).toHaveClass("cursor");
  });
});
