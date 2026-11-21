import { describe, expect, test } from "vitest";
import type { Actor, Agent, Library } from "../src/entities.js";
import { canAdmin, canManageAgent, canManageLibrary, canReadAgent, canReadLibrary, canUseAgent } from "../src/access.js";

const member: Actor = { userId: "usr_lea", workspaceId: "ws_oriel", role: "member" };
const admin: Actor = { userId: "usr_noor", workspaceId: "ws_oriel", role: "admin" };
const elsewhere: Actor = { userId: "usr_bob", workspaceId: "ws_brindille", role: "admin" };

const library = (ownerId: string, visibility: Library["visibility"], workspaceId = "ws_oriel"): Library => ({
  id: "lib", workspaceId, ownerId, slug: "l", name: "L", description: "", visibility, createdAt: new Date(0), updatedAt: new Date(0),
});
const agent = (ownerId: string, visibility: Agent["visibility"], status: Agent["status"] = "active", currentVersionId: string | null = "agv_1", workspaceId = "ws_oriel"): Agent => ({
  id: "agt", workspaceId, ownerId, slug: "a", name: "A", visibility, status, currentVersionId, createdAt: new Date(0), archivedAt: null,
});

describe("access", () => {
  test("a member reads own libraries and the ones shared with the workspace; an admin reads every library of the workspace", () => {
    expect(canReadLibrary(member, library("usr_lea", "private"))).toBe(true);
    expect(canReadLibrary(member, library("usr_tom", "workspace"))).toBe(true);
    expect(canReadLibrary(member, library("usr_tom", "private"))).toBe(false);
    expect(canReadLibrary(admin, library("usr_tom", "private"))).toBe(true);
    expect(canReadLibrary(elsewhere, library("usr_tom", "workspace"))).toBe(false);
    expect(canReadLibrary(admin, library("usr_tom", "workspace", "ws_brindille"))).toBe(false);
  });

  test("only the owner or an admin of the workspace manages a library", () => {
    expect(canManageLibrary(member, library("usr_lea", "private"))).toBe(true);
    expect(canManageLibrary(member, library("usr_tom", "workspace"))).toBe(false);
    expect(canManageLibrary(admin, library("usr_tom", "workspace"))).toBe(true);
    expect(canManageLibrary(elsewhere, library("usr_tom", "workspace"))).toBe(false);
  });

  test("an agent is readable like a library, managed by its owner or an admin, and usable only when active with a published version", () => {
    expect(canReadAgent(member, agent("usr_tom", "workspace"))).toBe(true);
    expect(canReadAgent(member, agent("usr_tom", "private"))).toBe(false);
    expect(canReadAgent(admin, agent("usr_tom", "private"))).toBe(true);
    expect(canManageAgent(member, agent("usr_lea", "private"))).toBe(true);
    expect(canManageAgent(member, agent("usr_tom", "workspace"))).toBe(false);
    expect(canUseAgent(member, agent("usr_tom", "workspace"))).toBe(true);
    expect(canUseAgent(member, agent("usr_lea", "private"))).toBe(true);
    expect(canUseAgent(member, agent("usr_tom", "private"))).toBe(false);
    expect(canUseAgent(member, agent("usr_tom", "workspace", "archived"))).toBe(false);
    expect(canUseAgent(member, agent("usr_tom", "workspace", "active", null))).toBe(false);
    // An admin reads a private agent as the workspace's keeper, but does not chat with it.
    expect(canUseAgent(admin, agent("usr_tom", "private"))).toBe(false);
    expect(canUseAgent(elsewhere, agent("usr_tom", "workspace"))).toBe(false);
  });

  test("canAdmin is the role in the actor's own workspace", () => {
    expect(canAdmin(admin, "ws_oriel")).toBe(true);
    expect(canAdmin(member, "ws_oriel")).toBe(false);
    expect(canAdmin(elsewhere, "ws_oriel")).toBe(false);
  });
});
