import type { Actor, Agent, Conversation } from "../entities.js";
import type { Page, PageQuery } from "../cursor.js";
import type { ConversationFilter, ConversationRow, Deps, MessageWithCitations } from "../ports.js";
import { fail, invalid, notFound, ok, type Result } from "../result.js";
import { conversationTransitions, move } from "../transitions.js";
import { canReadAgent, canUseAgent } from "../access.js";
import { auditRecorder } from "./audit.js";

/*
 * Conversations are the member's own: nobody else, the admin included, reads their text. One is
 * opened on an agent the member may use and records the version that will answer, so a later
 * edit of the agent never changes what was said. Sending a message is session 3's pipeline.
 */

export const TITLE_MAX = 120;

export function conversationsUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids } = deps;
  const audit = auditRecorder(deps);

  async function own(actor: Actor, conversationId: string): Promise<Result<Conversation>> {
    const conversation = await ports.conversations.findById(conversationId);
    if (!conversation || conversation.userId !== actor.userId || conversation.workspaceId !== actor.workspaceId || conversation.status === "deleted") return notFound("conversation");
    return ok(conversation);
  }

  /** The agent the member may chat with: readable, active, with a published version. */
  async function usableAgent(actor: Actor, agentId: string): Promise<Result<Agent>> {
    const agent = await ports.agents.findById(agentId);
    if (!agent || !canReadAgent(actor, agent)) return notFound("agent");
    if (!canUseAgent(actor, agent)) return fail("rule", "the agent is archived, unpublished, or not yours to use", "agent_unusable");
    return ok(agent);
  }

  async function setStatus(actor: Actor, conversationId: string, to: Conversation["status"]): Promise<Result<Conversation>> {
    const found = await own(actor, conversationId);
    if (!found.ok) return found;
    const conversation = found.value;
    const next = move(conversationTransitions, "conversation", conversation.status, to);
    if (!next.ok) return next;
    const updated: Conversation = { ...conversation, status: to, archivedAt: to === "archived" ? clock.now() : null };
    await unitOfWork.run(async (on) => {
      await on.conversations.update(updated);
      await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: `conversation.${to === "archived" ? "archived" : "restored"}`, entityKind: "conversation", entityId: conversation.id, before: { status: conversation.status }, after: { status: to } });
    });
    return ok(updated);
  }

  const conversations = {
    async list(actor: Actor, filter: ConversationFilter): Promise<Result<Page<ConversationRow>>> {
      if (filter.status === "deleted") return invalid("deleted conversations are not listed");
      return ok(await ports.conversations.list(actor.workspaceId, actor.userId, filter));
    },

    async get(actor: Actor, conversationId: string): Promise<Result<{ conversation: Conversation; agentName: string }>> {
      const found = await own(actor, conversationId);
      if (!found.ok) return found;
      const agent = await ports.agents.findById(found.value.agentId);
      return ok({ conversation: found.value, agentName: agent?.name ?? "" });
    },

    async create(actor: Actor, agentId: string): Promise<Result<Conversation>> {
      const agent = await usableAgent(actor, agentId);
      if (!agent.ok) return agent;
      const now = clock.now();
      const conversation: Conversation = {
        id: ids.id("cnv"), workspaceId: actor.workspaceId, userId: actor.userId, agentId, agentVersionId: agent.value.currentVersionId!,
        title: "New conversation", status: "active", messageCount: 0, tokenTotal: 0, createdAt: now, lastMessageAt: now, archivedAt: null,
      };
      await unitOfWork.run(async (on) => {
        await on.conversations.insert(conversation);
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "conversation.created", entityKind: "conversation", entityId: conversation.id, after: { agentId, agentVersionId: conversation.agentVersionId } });
      });
      return ok(conversation);
    },

    async rename(actor: Actor, conversationId: string, title: string): Promise<Result<Conversation>> {
      const found = await own(actor, conversationId);
      if (!found.ok) return found;
      const trimmed = title.trim();
      if (trimmed.length === 0 || trimmed.length > TITLE_MAX) return invalid(`a title of 1 to ${TITLE_MAX} characters is needed`);
      const updated = { ...found.value, title: trimmed };
      await ports.conversations.update(updated);
      return ok(updated);
    },

    archive: (actor: Actor, conversationId: string) => setStatus(actor, conversationId, "archived"),
    restore: (actor: Actor, conversationId: string) => setStatus(actor, conversationId, "active"),

    usableAgent,
    own,
  };

  const messages = {
    async list(actor: Actor, conversationId: string, query: PageQuery): Promise<Result<Page<MessageWithCitations>>> {
      const found = await own(actor, conversationId);
      if (!found.ok) return found;
      return ok(await ports.messages.list(conversationId, query));
    },
  };

  return { conversations, messages };
}
