import type { Actor, Agent, AgentVersion, Citation, Conversation, Message, RefusedReason, UsageEvent, Workspace } from "../entities.js";
import type { Deps, Ports } from "../ports.js";
import { fail, invalid, notFound, ok, type Result } from "../result.js";
import { messageTransitions, move } from "../transitions.js";
import { canUseAgent } from "../access.js";
import { monthOf } from "../time.js";
import { countTokens } from "../text/tokens.js";
import { packContext, type RetrievedChunk } from "../grounding/pack.js";
import { REFUSALS, extractiveAnswerer, type Answerer, type CitationDraft } from "../grounding/compose.js";
import { ANSWER_RESERVE, costedRows, estimatedCostMicros, roomInBudget, type TokenCounts } from "../grounding/meter.js";
import { rateLimiterCreator, type RateLimiter } from "../grounding/rate.js";
import { auditRecorder } from "./audit.js";

/*
 * The pipeline. A question comes in on a conversation; the user message is written; then, in
 * order: the tool must be on, the model priced, the member under their rate limit, the month
 * under its budget; the chunks are retrieved from the agent version's libraries intersected with
 * what the member may read, packed under the version's context budget, and composed into an
 * answer by the `Answerer`. The answer streams as events; the assistant message goes
 * streaming → complete (or failed), the citations and the usage rows are written, and the
 * conversation's counts move. A refusal is a terminal message with its reason and no usage.
 */

export const QUESTION_MAX = 4000;
export const RETRIEVE_LIMIT = 24;
const TITLE_LIMIT = 60;

export type SendEvent =
  | { type: "started"; userMessage: Message; assistantMessageId: string }
  | { type: "delta"; text: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "done"; message: Message }
  | { type: "refused"; message: Message; reason: RefusedReason }
  | { type: "failed"; message: Message; error: string };

export interface Prepared {
  conversation: Conversation;
  agent: Agent;
  version: AgentVersion;
  workspace: Workspace;
  question: string;
}

export function messagesUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids } = deps;
  const audit = auditRecorder(deps);
  const answerer: Answerer = deps.answerer ?? extractiveAnswerer();
  const rateLimiter: RateLimiter = deps.rateLimiter ?? rateLimiterCreator(clock);
  const pace = deps.streamDelayMs ?? 0;

  /** Everything that must hold before a single row is written. */
  async function prepare(actor: Actor, conversationId: string, text: string): Promise<Result<Prepared>> {
    const conversation = await ports.conversations.findById(conversationId);
    if (!conversation || conversation.userId !== actor.userId || conversation.workspaceId !== actor.workspaceId || conversation.status === "deleted") return notFound("conversation");
    if (conversation.status !== "active") return fail("rule", "the conversation is archived; restore it to continue", "conversation_archived");
    const question = text.trim();
    if (question.length === 0 || question.length > QUESTION_MAX) return invalid(`a question of 1 to ${QUESTION_MAX} characters is needed`);
    const agent = await ports.agents.findById(conversation.agentId);
    if (!agent || !canUseAgent(actor, agent)) return fail("rule", "the agent is archived, unpublished, or not yours to use", "agent_unusable");
    const version = await ports.agentVersions.findById(agent.currentVersionId!);
    const workspace = await ports.workspaces.findById(actor.workspaceId);
    if (!version || !workspace) return notFound("agent");
    return ok({ conversation, agent, version, workspace, question });
  }

  /** The chunks of the version's libraries the member may read, best first. */
  async function retrieve(actor: Actor, version: AgentVersion, question: string): Promise<RetrievedChunk[]> {
    const libraryIds = await ports.libraries.readableIds(actor, await ports.agentVersions.librariesOf(version.id));
    if (libraryIds.length === 0) return [];
    return ports.chunks.search({ libraryIds, question, limit: RETRIEVE_LIMIT });
  }

  const usageRow = (p: Prepared, actor: Actor, messageId: string, at: Date, row: { kind: UsageEvent["kind"]; tokens: number; microsPer1k: number; costMicros: number }): UsageEvent => ({
    id: ids.id("use"), workspaceId: actor.workspaceId, userId: actor.userId, agentId: p.agent.id, messageId, modelId: p.version.modelId, ...row, occurredAt: at,
  });

  async function* run(actor: Actor, p: Prepared): AsyncGenerator<SendEvent> {
    const now = clock.now();
    const ordinal = p.conversation.messageCount;
    const userMessage: Message = {
      id: ids.id("msg"), conversationId: p.conversation.id, ordinal, role: "user", body: p.question, status: "complete", refusedReason: null, modelId: null, agentVersionId: null,
      promptTokens: 0, contextTokens: 0, completionTokens: 0, createdAt: now, completedAt: now,
    };
    const assistantId = ids.id("msg");
    const title = ordinal === 0 && p.conversation.title === "New conversation" ? (p.question.length > TITLE_LIMIT ? `${p.question.slice(0, TITLE_LIMIT - 3)}...` : p.question) : p.conversation.title;
    let conversation: Conversation = { ...p.conversation, title, messageCount: ordinal + 2, lastMessageAt: now, agentVersionId: p.version.id };
    await unitOfWork.run(async (on) => {
      await on.messages.insert(userMessage);
      await on.conversations.update(conversation);
    });
    yield { type: "started", userMessage, assistantMessageId: assistantId };

    const base: Message = {
      id: assistantId, conversationId: p.conversation.id, ordinal: ordinal + 1, role: "assistant", body: "", status: "streaming", refusedReason: null, modelId: p.version.modelId, agentVersionId: p.version.id,
      promptTokens: 0, contextTokens: 0, completionTokens: 0, createdAt: now, completedAt: null,
    };

    const refuse = async (reason: RefusedReason): Promise<SendEvent> => {
      const message: Message = { ...base, body: REFUSALS[reason], status: "refused", refusedReason: reason, completedAt: now };
      await unitOfWork.run(async (on) => {
        await on.messages.insert(message);
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "message.refused", entityKind: "message", entityId: message.id, after: { status: "refused", reason } });
      });
      return { type: "refused", message, reason };
    };

    // The checks, cheapest first.
    if (!p.workspace.tools.groundedAnswers) {
      yield await refuse("tool_off");
      return;
    }
    const prices = await ports.models.prices();
    const promptTokens = countTokens(`${p.version.instructions}\n${p.question}`);
    const contextBudget = Math.max(0, p.version.maxContextTokens - promptTokens - ANSWER_RESERVE);
    const estimate = estimatedCostMicros(prices, p.version.modelId, now, { input: promptTokens, cached_input: contextBudget, output: ANSWER_RESERVE });
    if (estimate === null) {
      yield await refuse("no_price");
      return;
    }
    if (!rateLimiter.take(actor.userId, promptTokens + ANSWER_RESERVE)) {
      yield await refuse("rate_limited");
      return;
    }
    const budget = await ports.budgets.find(actor.workspaceId, monthOf(now));
    if (!roomInBudget(budget?.limitMicros ?? null, await ports.usage.spentMicros(actor.workspaceId, monthOf(now)), estimate)) {
      yield await refuse("budget_exhausted");
      return;
    }

    // Retrieve and pack; nothing is written until the model has something to say or fails.
    const candidates = await retrieve(actor, p.version, p.question);
    const packed = packContext(candidates, { budget: contextBudget });
    const contextTokens = packed.reduce((n, c) => n + c.tokenCount, 0);
    const streaming: Message = { ...base, promptTokens, contextTokens };

    const meter = async (on: Ports, tokens: TokenCounts): Promise<number> => {
      const rows = costedRows(prices, p.version.modelId, now, tokens)!;
      let total = 0;
      for (const row of rows) {
        if (row.tokens === 0 && row.kind === "output") continue;
        await on.usage.insert(usageRow(p, actor, assistantId, now, row));
        total += row.tokens;
      }
      return total;
    };

    let composed;
    try {
      composed = await answerer.compose({ question: p.question, instructions: p.version.instructions, chunks: packed });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const failed: Message = { ...streaming, status: "failed", completedAt: clock.now() };
      await unitOfWork.run(async (on) => {
        await on.messages.insert(failed);
        const spent = await meter(on, { input: promptTokens, cached_input: contextTokens, output: 0 });
        conversation = { ...conversation, tokenTotal: conversation.tokenTotal + spent };
        await on.conversations.update(conversation);
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "message.failed", entityKind: "message", entityId: failed.id, before: { status: "streaming" }, after: { status: "failed", error } });
      });
      rateLimiter.spend(actor.userId, contextTokens);
      yield { type: "failed", message: failed, error };
      return;
    }
    if (composed.kind === "no_sources") {
      yield await refuse("no_sources");
      return;
    }

    // Stream the answer, then land it with its citations and usage in one unit of work.
    await ports.messages.insert(streaming);
    for (const piece of composed.text.split(/(?<=\s)/u)) {
      if (pace > 0) await new Promise((resolve) => setTimeout(resolve, pace));
      yield { type: "delta", text: piece };
    }
    const completionTokens = countTokens(composed.text);
    const citations: Citation[] = composed.citations.map((c: CitationDraft) => ({ id: ids.id("cit"), messageId: assistantId, ...c }));
    const next = move(messageTransitions, "message", "streaming", "complete");
    if (!next.ok) throw new Error(next.error.message);
    const complete: Message = { ...streaming, body: composed.text, status: "complete", completionTokens, completedAt: clock.now() };
    await unitOfWork.run(async (on) => {
      await on.messages.update(complete);
      await on.messages.insertCitations(citations);
      const spent = await meter(on, { input: promptTokens, cached_input: contextTokens, output: completionTokens });
      conversation = { ...conversation, tokenTotal: conversation.tokenTotal + spent };
      await on.conversations.update(conversation);
      await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "message.completed", entityKind: "message", entityId: complete.id, before: { status: "streaming" }, after: { status: "complete", citations: citations.length } });
    });
    rateLimiter.spend(actor.userId, contextTokens + completionTokens - ANSWER_RESERVE);
    yield { type: "citations", citations };
    yield { type: "done", message: complete };
  }

  return {
    /** The checks run now; the pipeline runs as the iterable is consumed. */
    async send(actor: Actor, conversationId: string, text: string): Promise<Result<AsyncIterable<SendEvent>>> {
      const prepared = await prepare(actor, conversationId, text);
      if (!prepared.ok) return prepared;
      return ok(run(actor, prepared.value));
    },
    prepare,
    retrieve,
  };
}
