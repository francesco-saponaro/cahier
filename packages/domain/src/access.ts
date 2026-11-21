import type { Actor, Agent, Library } from "./entities.js";

/*
 * Who may read, manage and use what, as pure functions of the actor and the thing. The use cases
 * ask these before every read and write; the retrieval query of session 3 is their SQL twin, and
 * a test there proves the two agree on a generated set of members and libraries.
 */

const sameWorkspace = (actor: Actor, thing: { workspaceId: string }) => actor.workspaceId === thing.workspaceId;

export function canAdmin(actor: Actor, workspaceId: string): boolean {
  return actor.role === "admin" && actor.workspaceId === workspaceId;
}

/** Own, shared with the workspace, or the admin's workspace: an admin keeps the workspace's data. */
export function canReadLibrary(actor: Actor, library: Library): boolean {
  if (!sameWorkspace(actor, library)) return false;
  return library.ownerId === actor.userId || library.visibility === "workspace" || actor.role === "admin";
}

export function canManageLibrary(actor: Actor, library: Library): boolean {
  if (!sameWorkspace(actor, library)) return false;
  return library.ownerId === actor.userId || actor.role === "admin";
}

export function canReadAgent(actor: Actor, agent: Agent): boolean {
  if (!sameWorkspace(actor, agent)) return false;
  return agent.ownerId === actor.userId || agent.visibility === "workspace" || actor.role === "admin";
}

export function canManageAgent(actor: Actor, agent: Agent): boolean {
  if (!sameWorkspace(actor, agent)) return false;
  return agent.ownerId === actor.userId || actor.role === "admin";
}

/** Chatting with an agent: own or shared, active, and with a published version. Being an admin gives no extra agent. */
export function canUseAgent(actor: Actor, agent: Agent): boolean {
  if (!sameWorkspace(actor, agent)) return false;
  if (agent.status !== "active" || agent.currentVersionId === null) return false;
  return agent.ownerId === actor.userId || agent.visibility === "workspace";
}
