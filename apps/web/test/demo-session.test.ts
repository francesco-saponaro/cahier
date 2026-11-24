// @vitest-environment node
import { createTRPCClient } from "@trpc/client";
import type { appRouter } from "@cahier/api";
import { cryptoIdGeneratorCreator, emptyStore, inMemoryPortsCreator, useCasesCreator, type MemoryStore } from "@cahier/domain";
import { describe, expect, it } from "vitest";
import { demoLinks, restoreSession } from "../src/demo/session";
import type { StoredSession } from "../src/auth/session";

/*
 * The demo's database is made when the page opens, so a reload would sign the person out: the
 * session row the server would still hold is gone with the old database. The demo puts it back
 * from the copy the browser kept, for a user the seed knows, and only while it is live.
 */

const NOW = new Date("2026-11-24T18:00:00Z");

function world() {
  const store: MemoryStore = emptyStore();
  store.workspaces.push({ id: "ws_oriel", slug: "oriel", name: "Oriel", tools: { groundedAnswers: true, scheduledPrompts: true, uploads: true }, retentionDays: 90, createdAt: NOW });
  store.users.push({ id: "usr_lea", email: "lea@example.com", name: "Léa Marchetti", passwordHash: "scrypt$1$1$1$00$00", createdAt: NOW });
  store.users.push({ id: "usr_out", email: "out@example.com", name: "Someone Suspended", passwordHash: "scrypt$1$1$1$00$00", createdAt: NOW });
  store.memberships.push({ id: "mem_lea", workspaceId: "ws_oriel", userId: "usr_lea", role: "member", status: "active", createdAt: NOW });
  store.memberships.push({ id: "mem_out", workspaceId: "ws_oriel", userId: "usr_out", role: "member", status: "suspended", createdAt: NOW });
  const { ports, unitOfWork } = inMemoryPortsCreator(store);
  const useCases = useCasesCreator({ ports, unitOfWork, clock: { now: () => NOW }, ids: cryptoIdGeneratorCreator(), sessionHours: 72 });
  return { store, ports, useCases };
}

const stored = (over: Partial<StoredSession> = {}): StoredSession => ({
  token: "a-token-the-browser-kept",
  expiresAt: "2026-11-27T18:00:00.000Z",
  user: { id: "usr_lea", name: "Léa Marchetti", email: "lea@example.com" },
  workspace: { id: "ws_oriel", slug: "oriel", name: "Oriel" },
  role: "member",
  ...over,
});

describe("restoring the stored session into a fresh demo database", () => {
  it("puts the session back so the token authenticates again", async () => {
    const { ports, useCases } = world();
    expect(await restoreSession(ports, stored(), NOW)).toBe(true);
    const found = await useCases.auth.authenticate("a-token-the-browser-kept");
    expect(found?.actor).toEqual({ userId: "usr_lea", workspaceId: "ws_oriel", role: "member" });
    expect(found?.session.expiresAt.toISOString()).toBe("2026-11-27T18:00:00.000Z");
  });

  it("restores nothing for a user the seed does not know", async () => {
    const { ports, useCases, store } = world();
    expect(await restoreSession(ports, stored({ user: { id: "usr_made_in_a_previous_visit", name: "New", email: "new@example.com" } }), NOW)).toBe(false);
    expect(store.sessions).toHaveLength(0);
    expect(await useCases.auth.authenticate("a-token-the-browser-kept")).toBeNull();
  });

  it("restores nothing for a suspended membership or a workspace the user is not in", async () => {
    const { ports, store } = world();
    expect(await restoreSession(ports, stored({ user: { id: "usr_out", name: "Someone Suspended", email: "out@example.com" } }), NOW)).toBe(false);
    expect(await restoreSession(ports, stored({ workspace: { id: "ws_elsewhere", slug: "elsewhere", name: "Elsewhere" } }), NOW)).toBe(false);
    expect(store.sessions).toHaveLength(0);
  });

  it("restores nothing once the stored session has expired", async () => {
    const { ports, store } = world();
    expect(await restoreSession(ports, stored({ expiresAt: "2026-11-24T17:59:59.000Z" }), NOW)).toBe(false);
    expect(store.sessions).toHaveLength(0);
  });
});

describe("the demo's links", () => {
  it("call the router in-process with the actor behind the token, and answer the server's codes", async () => {
    const { ports, useCases } = world();
    await restoreSession(ports, stored(), NOW);
    const asLea = createTRPCClient<typeof appRouter>({ links: demoLinks(() => Promise.resolve(useCases), "a-token-the-browser-kept") });
    const me = await asLea.auth.me.query();
    expect(me.user.email).toBe("lea@example.com");
    expect(me.role).toBe("member");
    await expect(asLea.admin.settings.get.query()).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

    const nobody = createTRPCClient<typeof appRouter>({ links: demoLinks(() => Promise.resolve(useCases), null) });
    await expect(nobody.auth.me.query()).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
  });

  it("carry the rule's reason, as the server's formatter does", async () => {
    const { ports, useCases, store } = world();
    store.workspaces[0]!.tools.scheduledPrompts = false;
    await restoreSession(ports, stored(), NOW);
    const asLea = createTRPCClient<typeof appRouter>({ links: demoLinks(() => Promise.resolve(useCases), "a-token-the-browser-kept") });
    await expect(asLea.conversations.create.mutate({ agentId: "agt_none" })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(
      asLea.schedules.create.mutate({ agentId: "agt_none", name: "Digest", prompt: "What changed?", cadence: "daily", atMinute: 540, weekday: null, dayOfMonth: null, timezone: "Europe/Paris" }),
    ).rejects.toMatchObject({ data: { code: "PRECONDITION_FAILED", reason: "tool_off" } });
  });
});
