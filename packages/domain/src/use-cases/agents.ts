import type { Actor, Agent, AgentVersion, ShareRequest } from "../entities.js";
import type { Page } from "../cursor.js";
import type { AgentFilter, AgentRow, Deps, Ports } from "../ports.js";
import { fail, forbidden, invalid, notFound, ok, type Result } from "../result.js";
import { agentTransitions, agentVersionTransitions, move } from "../transitions.js";
import { canAdmin, canManageAgent, canReadAgent, canReadLibrary } from "../access.js";
import { auditRecorder } from "./audit.js";
import { cleanName, freshSlug } from "./libraries.js";

/*
 * Agents and their versions. An agent is a name and a slug; what it does lives in a version:
 * instructions, model, context budget and the libraries it may read. Saving opens a draft (or
 * rewrites the open one); publishing retires the current version and makes the draft the one
 * that answers; rolling back republishes a retired version under its own number. A conversation
 * records the version that answered, so an edit never changes what was already said.
 */

export const CONTEXT_MIN = 512;
export const INSTRUCTIONS_MAX = 4000;

export interface VersionInput {
  name: string;
  description: string;
  instructions: string;
  modelId: string;
  maxContextTokens: number;
  libraryIds: string[];
}

export type VersionWithLibraries = AgentVersion & { libraryIds: string[] };

export function agentsUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids } = deps;
  const audit = auditRecorder(deps);

  async function readable(actor: Actor, agentId: string): Promise<Result<Agent>> {
    const agent = await ports.agents.findById(agentId);
    if (!agent || !canReadAgent(actor, agent)) return notFound("agent");
    return ok(agent);
  }

  async function manageable(actor: Actor, agentId: string): Promise<Result<Agent>> {
    const found = await readable(actor, agentId);
    if (!found.ok) return found;
    if (!canManageAgent(actor, found.value)) return forbidden("only the owner or an admin changes an agent");
    return found;
  }

  /** The version's fields checked: the model exists and is on, the budget fits it, every library is one the actor may read. */
  async function checkedInput(actor: Actor, input: VersionInput): Promise<Result<VersionInput & { name: string }>> {
    const name = cleanName(input.name);
    if (!name.ok) return name;
    if (input.instructions.trim().length === 0) return invalid("instructions are needed");
    if (input.instructions.length > INSTRUCTIONS_MAX) return invalid(`instructions must be at most ${INSTRUCTIONS_MAX} characters`);
    const model = await ports.models.findById(input.modelId);
    if (!model || !model.enabled) return invalid("that model is not available");
    if (!Number.isInteger(input.maxContextTokens) || input.maxContextTokens < CONTEXT_MIN || input.maxContextTokens > model.contextTokens) {
      return invalid(`the context budget must be between ${CONTEXT_MIN} and ${model.contextTokens} tokens for ${model.name}`);
    }
    const libraryIds = [...new Set(input.libraryIds)];
    const libraries = await ports.libraries.findMany(libraryIds);
    if (libraries.length !== libraryIds.length) return notFound("library");
    if (!libraries.every((l) => canReadLibrary(actor, l))) return forbidden("an agent may only read libraries you may read");
    return ok({ ...input, name: name.value, description: input.description.trim(), instructions: input.instructions.trim(), libraryIds });
  }

  async function versionFor(actor: Actor, versionId: string): Promise<Result<{ agent: Agent; version: AgentVersion }>> {
    const version = await ports.agentVersions.findById(versionId);
    if (!version) return notFound("version");
    const agent = await manageable(actor, version.agentId);
    if (!agent.ok) return agent;
    if (agent.value.status !== "active") return fail("conflict", "the agent is archived", "agent_archived");
    return ok({ agent: agent.value, version });
  }

  /** Makes `version` the one that answers: the current one is retired, the agent points at the new one. */
  async function makeCurrent(on: Ports, actor: Actor, agent: Agent, version: AgentVersion, action: "published" | "rolled_back"): Promise<AgentVersion> {
    const now = clock.now();
    const current = agent.currentVersionId ? await on.agentVersions.findById(agent.currentVersionId) : null;
    if (current && current.id !== version.id) await on.agentVersions.update({ ...current, status: "retired" });
    const published: AgentVersion = { ...version, status: "published", publishedAt: action === "published" ? now : version.publishedAt };
    await on.agentVersions.update(published);
    await on.agents.update({ ...agent, currentVersionId: version.id });
    await audit(on, {
      workspaceId: actor.workspaceId, actorId: actor.userId, action: `agent_version.${action}`, entityKind: "agent_version", entityId: version.id,
      before: action === "published" ? { status: version.status } : { currentVersion: current?.version ?? null },
      after: action === "published" ? { status: "published", version: version.version } : { currentVersion: version.version },
    });
    return published;
  }

  return {
    async list(actor: Actor, filter: Omit<AgentFilter, "userId">): Promise<Result<Page<AgentRow>>> {
      if (filter.scope === "all" && !canAdmin(actor, actor.workspaceId)) return forbidden("only an admin lists every agent");
      return ok(await ports.agents.list(actor.workspaceId, { ...filter, userId: actor.userId }));
    },

    async get(actor: Actor, agentId: string): Promise<Result<{ agent: Agent; ownerName: string; versions: VersionWithLibraries[]; pendingShare: ShareRequest | null }>> {
      const found = await readable(actor, agentId);
      if (!found.ok) return found;
      const owner = await ports.users.findById(found.value.ownerId);
      const versions = await ports.agentVersions.listByAgent(agentId);
      const withLibraries = await Promise.all(versions.map(async (v) => ({ ...v, libraryIds: await ports.agentVersions.librariesOf(v.id) })));
      return ok({ agent: found.value, ownerName: owner?.name ?? "", versions: withLibraries, pendingShare: await ports.shareRequests.findPending("agent", agentId) });
    },

    async create(actor: Actor, input: VersionInput): Promise<Result<{ agent: Agent; version: AgentVersion }>> {
      const checked = await checkedInput(actor, input);
      if (!checked.ok) return checked;
      const now = clock.now();
      const slug = await freshSlug(async (s) => (await ports.agents.findBySlug(actor.workspaceId, s)) !== null, checked.value.name);
      const agent: Agent = { id: ids.id("agt"), workspaceId: actor.workspaceId, ownerId: actor.userId, slug, name: checked.value.name, visibility: "private", status: "active", currentVersionId: null, createdAt: now, archivedAt: null };
      const version: AgentVersion = {
        id: ids.id("agv"), agentId: agent.id, version: 1, name: checked.value.name, description: checked.value.description, instructions: checked.value.instructions,
        modelId: checked.value.modelId, maxContextTokens: checked.value.maxContextTokens, status: "draft", createdBy: actor.userId, createdAt: now, publishedAt: null,
      };
      await unitOfWork.run(async (on) => {
        await on.agents.insert(agent);
        await on.agentVersions.insert(version);
        await on.agentVersions.setLibraries(version.id, checked.value.libraryIds);
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "agent.created", entityKind: "agent", entityId: agent.id, after: { name: agent.name } });
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "agent_version.drafted", entityKind: "agent_version", entityId: version.id, after: { version: 1, libraryIds: checked.value.libraryIds } });
      });
      return ok({ agent, version });
    },

    async saveDraft(actor: Actor, agentId: string, input: VersionInput): Promise<Result<AgentVersion>> {
      const found = await manageable(actor, agentId);
      if (!found.ok) return found;
      const agent = found.value;
      if (agent.status !== "active") return fail("conflict", "the agent is archived", "agent_archived");
      const checked = await checkedInput(actor, input);
      if (!checked.ok) return checked;
      const versions = await ports.agentVersions.listByAgent(agentId);
      const latest = versions[versions.length - 1];
      const now = clock.now();
      const fields = { name: checked.value.name, description: checked.value.description, instructions: checked.value.instructions, modelId: checked.value.modelId, maxContextTokens: checked.value.maxContextTokens };
      const draft: AgentVersion =
        latest?.status === "draft"
          ? { ...latest, ...fields }
          : { id: ids.id("agv"), agentId, version: (latest?.version ?? 0) + 1, ...fields, status: "draft", createdBy: actor.userId, createdAt: now, publishedAt: null };
      await unitOfWork.run(async (on) => {
        if (latest?.status === "draft") await on.agentVersions.update(draft);
        else await on.agentVersions.insert(draft);
        await on.agentVersions.setLibraries(draft.id, checked.value.libraryIds);
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "agent_version.drafted", entityKind: "agent_version", entityId: draft.id, after: { version: draft.version, libraryIds: checked.value.libraryIds } });
      });
      return ok(draft);
    },

    async publish(actor: Actor, versionId: string): Promise<Result<AgentVersion>> {
      const found = await versionFor(actor, versionId);
      if (!found.ok) return found;
      const { agent, version } = found.value;
      const next = move(agentVersionTransitions, "version", version.status, "published");
      if (!next.ok) return next;
      if (version.status === "retired") return fail("conflict", "a retired version comes back through a roll-back", "forbidden_transition");
      return ok(await unitOfWork.run((on) => makeCurrent(on, actor, agent, version, "published")));
    },

    async rollBack(actor: Actor, versionId: string): Promise<Result<AgentVersion>> {
      const found = await versionFor(actor, versionId);
      if (!found.ok) return found;
      const { agent, version } = found.value;
      if (version.status !== "retired") return fail("conflict", `a ${version.status} version cannot be rolled back to`, "forbidden_transition");
      return ok(await unitOfWork.run((on) => makeCurrent(on, actor, agent, version, "rolled_back")));
    },

    async archive(actor: Actor, agentId: string): Promise<Result<Agent>> {
      const found = await manageable(actor, agentId);
      if (!found.ok) return found;
      const agent = found.value;
      const next = move(agentTransitions, "agent", agent.status, "archived");
      if (!next.ok) return next;
      const archived: Agent = { ...agent, status: "archived", archivedAt: clock.now() };
      await unitOfWork.run(async (on) => {
        await on.agents.update(archived);
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "agent.archived", entityKind: "agent", entityId: agent.id, before: { status: "active" }, after: { status: "archived" } });
      });
      return ok(archived);
    },
  };
}
