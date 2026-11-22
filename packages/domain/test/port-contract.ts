import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MemoryStore } from "../src/in-memory.js";
import type { Agent, AgentVersion, Conversation, Document, Library, Membership, Ports, UnitOfWork, UsageEvent, User } from "../src/index.js";

/*
 * The behaviour every implementation of the ports must have. The in-memory adapters run it here;
 * `packages/db` runs the same file against the Drizzle adapters on PGlite, so the two can never
 * drift apart in what a filter, a sort, a page or a sum means.
 */

export type Fixture = MemoryStore;

export interface PortsUnderTest {
  ports: Ports;
  unitOfWork: UnitOfWork;
  close: () => Promise<void>;
}

const at = (iso: string) => new Date(iso);
const T0 = at("2026-09-01T10:00:00Z");
const day = (n: number) => new Date(T0.getTime() + n * 24 * 60 * 60 * 1000);

const user = (id: string, name: string): User => ({ id, email: `${id.slice(4)}@example.com`, name, passwordHash: "x", createdAt: T0 });
const membership = (id: string, workspaceId: string, userId: string, role: Membership["role"], status: Membership["status"] = "active", createdAt = T0): Membership => ({ id, workspaceId, userId, role, status, createdAt });
const library = (id: string, workspaceId: string, ownerId: string, name: string, visibility: Library["visibility"], createdAt: Date): Library => ({
  id, workspaceId, ownerId, slug: name.toLowerCase().replace(/\s+/g, "-"), name, description: "", visibility, createdAt, updatedAt: createdAt,
});
const document = (id: string, libraryId: string, title: string, body: string, status: Document["status"], createdAt: Date): Document => ({
  id, libraryId, title, sourceName: `${title}.md`, mime: "text/markdown", byteSize: body.length, charCount: body.length, body, status, error: status === "failed" ? "empty" : null, version: 1, uploadedBy: "usr_lea", createdAt, indexedAt: status === "indexed" ? createdAt : null,
});
const agent = (id: string, workspaceId: string, ownerId: string, name: string, visibility: Agent["visibility"], currentVersionId: string | null, createdAt: Date, status: Agent["status"] = "active"): Agent => ({
  id, workspaceId, ownerId, slug: name.toLowerCase().replace(/\s+/g, "-"), name, visibility, status, currentVersionId, createdAt, archivedAt: null,
});
const version = (id: string, agentId: string, v: number, status: AgentVersion["status"], createdAt: Date): AgentVersion => ({
  id, agentId, version: v, name: `v${v}`, description: "", instructions: "Answer.", modelId: "small-4", maxContextTokens: 4000, status, createdBy: "usr_lea", createdAt, publishedAt: status === "draft" ? null : createdAt,
});
const conversation = (id: string, userId: string, agentId: string, title: string, status: Conversation["status"], lastMessageAt: Date): Conversation => ({
  id, workspaceId: "ws_oriel", userId, agentId, agentVersionId: "agv_h1", title, status, messageCount: 2, tokenTotal: 100, createdAt: lastMessageAt, lastMessageAt, archivedAt: null,
});
const usage = (id: string, userId: string, agentId: string | null, modelId: string, kind: UsageEvent["kind"], tokens: number, microsPer1k: number, occurredAt: Date): UsageEvent => ({
  id, workspaceId: "ws_oriel", userId, agentId, messageId: null, modelId, kind, tokens, microsPer1k, costMicros: Math.floor((tokens * microsPer1k + 500) / 1000), occurredAt,
});

export function fixture(): Fixture {
  return {
    workspaces: [
      { id: "ws_oriel", slug: "oriel", name: "Oriel", tools: { groundedAnswers: true, scheduledPrompts: true, uploads: true }, retentionDays: 90, createdAt: T0 },
      { id: "ws_brindille", slug: "brindille", name: "Brindille", tools: { groundedAnswers: true, scheduledPrompts: false, uploads: true }, retentionDays: 30, createdAt: T0 },
    ],
    users: [user("usr_lea", "Léa"), user("usr_tom", "Tom"), user("usr_noor", "Noor"), user("usr_ada", "Ada"), user("usr_bob", "Bob")],
    memberships: [
      membership("mem_lea", "ws_oriel", "usr_lea", "member"),
      membership("mem_tom", "ws_oriel", "usr_tom", "member", "active", day(1)),
      membership("mem_noor", "ws_oriel", "usr_noor", "admin", "active", day(2)),
      membership("mem_ada", "ws_oriel", "usr_ada", "member", "suspended", day(3)),
      membership("mem_bob", "ws_brindille", "usr_bob", "admin"),
      membership("mem_lea_b", "ws_brindille", "usr_lea", "member", "active", day(4)),
    ],
    sessions: [
      { id: "ses_1", tokenHash: "hash-lea", userId: "usr_lea", workspaceId: "ws_oriel", createdAt: T0, expiresAt: day(3) },
      { id: "ses_2", tokenHash: "hash-old", userId: "usr_lea", workspaceId: "ws_oriel", createdAt: day(-10), expiresAt: day(-7) },
      { id: "ses_3", tokenHash: "hash-tom", userId: "usr_tom", workspaceId: "ws_oriel", createdAt: T0, expiresAt: day(3) },
    ],
    invitations: [
      { id: "inv_1", workspaceId: "ws_oriel", email: "new@example.com", role: "member", tokenHash: "inv-hash-1", status: "sent", invitedBy: "usr_noor", acceptedUserId: null, createdAt: day(1), expiresAt: day(8) },
      { id: "inv_2", workspaceId: "ws_oriel", email: "old@example.com", role: "member", tokenHash: "inv-hash-2", status: "revoked", invitedBy: "usr_noor", acceptedUserId: null, createdAt: day(0), expiresAt: day(7) },
      { id: "inv_3", workspaceId: "ws_brindille", email: "b@example.com", role: "admin", tokenHash: "inv-hash-3", status: "sent", invitedBy: "usr_bob", acceptedUserId: null, createdAt: day(2), expiresAt: day(9) },
    ],
    models: [
      { id: "small-4", name: "Small 4", contextTokens: 128000, enabled: true },
      { id: "large-4", name: "Large 4", contextTokens: 128000, enabled: true },
      { id: "mini-3b", name: "Mini 3B", contextTokens: 32000, enabled: false },
    ],
    modelPrices: [
      { id: "prc_1", modelId: "small-4", kind: "input", microsPer1k: 150, validFrom: day(-100), validTo: null },
      { id: "prc_2", modelId: "small-4", kind: "cached_input", microsPer1k: 15, validFrom: day(-100), validTo: null },
      { id: "prc_3", modelId: "small-4", kind: "output", microsPer1k: 600, validFrom: day(-100), validTo: null },
      { id: "prc_4", modelId: "large-4", kind: "input", microsPer1k: 500, validFrom: day(-100), validTo: day(0) },
      { id: "prc_5", modelId: "large-4", kind: "input", microsPer1k: 700, validFrom: day(0), validTo: null },
    ],
    libraries: [
      library("lib_handbook", "ws_oriel", "usr_noor", "Handbook", "workspace", day(0)),
      library("lib_runbooks", "ws_oriel", "usr_tom", "Runbooks", "workspace", day(1)),
      library("lib_drafts", "ws_oriel", "usr_lea", "Drafts", "private", day(2)),
      library("lib_field", "ws_oriel", "usr_tom", "Field notes", "private", day(3)),
      library("lib_manual", "ws_brindille", "usr_bob", "Manual", "workspace", day(0)),
    ],
    documents: [
      document("doc_leave", "lib_handbook", "Leave", "# Leave\n\nEveryone earns 25 days.", "indexed", day(0)),
      document("doc_expenses", "lib_handbook", "Expenses", "# Expenses\n\nKeep the receipt.", "indexed", day(1)),
      document("doc_empty", "lib_handbook", "Empty", "", "failed", day(2)),
      document("doc_draft", "lib_drafts", "A draft", "# Draft\n\nSoon.", "uploaded", day(2)),
    ],
    chunks: [
      { id: "chk_1", documentId: "doc_leave", ordinal: 0, headingPath: ["Leave"], headingText: "Leave", startChar: 0, endChar: 32, tokenCount: 8, body: "# Leave\n\nEveryone earns 25 days." },
      { id: "chk_2", documentId: "doc_expenses", ordinal: 1, headingPath: ["Expenses"], headingText: "Expenses", startChar: 12, endChar: 29, tokenCount: 4, body: "Keep the receipt." },
      { id: "chk_3", documentId: "doc_expenses", ordinal: 0, headingPath: [], headingText: "", startChar: 0, endChar: 10, tokenCount: 2, body: "# Expenses" },
    ],
    agents: [
      agent("agt_helper", "ws_oriel", "usr_noor", "Handbook helper", "workspace", "agv_h1", day(0)),
      agent("agt_field", "ws_oriel", "usr_tom", "Field agent", "private", "agv_f1", day(1)),
      agent("agt_old", "ws_oriel", "usr_noor", "Old bot", "workspace", "agv_o1", day(-5), "archived"),
      agent("agt_new", "ws_oriel", "usr_lea", "New agent", "private", null, day(2)),
      agent("agt_shop", "ws_brindille", "usr_bob", "Shop helper", "workspace", "agv_s1", day(0)),
    ],
    agentVersions: [
      version("agv_h0", "agt_helper", 1, "retired", day(0)),
      version("agv_h1", "agt_helper", 2, "published", day(1)),
      version("agv_h2", "agt_helper", 3, "draft", day(2)),
      version("agv_f1", "agt_field", 1, "published", day(1)),
      version("agv_o1", "agt_old", 1, "published", day(-5)),
      version("agv_n1", "agt_new", 1, "draft", day(2)),
      version("agv_s1", "agt_shop", 1, "published", day(0)),
    ],
    agentVersionLibraries: [
      { agentVersionId: "agv_h0", libraryId: "lib_handbook" },
      { agentVersionId: "agv_h1", libraryId: "lib_handbook" },
      { agentVersionId: "agv_h1", libraryId: "lib_runbooks" },
      { agentVersionId: "agv_h2", libraryId: "lib_handbook" },
      { agentVersionId: "agv_f1", libraryId: "lib_field" },
      { agentVersionId: "agv_f1", libraryId: "lib_runbooks" },
      { agentVersionId: "agv_s1", libraryId: "lib_manual" },
    ],
    shareRequests: [
      { id: "shr_1", workspaceId: "ws_oriel", subjectKind: "library", subjectId: "lib_runbooks", requestedBy: "usr_tom", status: "approved", reason: null, decidedBy: "usr_noor", createdAt: day(1), decidedAt: day(2) },
      { id: "shr_2", workspaceId: "ws_oriel", subjectKind: "library", subjectId: "lib_field", requestedBy: "usr_tom", status: "requested", reason: null, decidedBy: null, createdAt: day(5), decidedAt: null },
      { id: "shr_3", workspaceId: "ws_oriel", subjectKind: "agent", subjectId: "agt_field", requestedBy: "usr_tom", status: "declined", reason: "Not yet", decidedBy: "usr_noor", createdAt: day(3), decidedAt: day(4) },
      { id: "shr_4", workspaceId: "ws_oriel", subjectKind: "library", subjectId: "lib_drafts", requestedBy: "usr_lea", status: "requested", reason: null, decidedBy: null, createdAt: day(6), decidedAt: null },
      { id: "shr_5", workspaceId: "ws_brindille", subjectKind: "agent", subjectId: "agt_shop", requestedBy: "usr_bob", status: "requested", reason: null, decidedBy: null, createdAt: day(6), decidedAt: null },
    ],
    conversations: [
      conversation("cnv_1", "usr_lea", "agt_helper", "Leave rules", "active", day(10)),
      conversation("cnv_2", "usr_lea", "agt_helper", "Expenses abroad", "active", day(12)),
      conversation("cnv_3", "usr_lea", "agt_helper", "Old chat", "archived", day(5)),
      conversation("cnv_4", "usr_lea", "agt_helper", "Gone", "deleted", day(1)),
      conversation("cnv_5", "usr_tom", "agt_field", "Tom's chat", "active", day(11)),
    ],
    messages: [
      { id: "msg_1", conversationId: "cnv_1", ordinal: 0, role: "user", body: "How many days of leave?", status: "complete", refusedReason: null, modelId: null, agentVersionId: null, promptTokens: 0, contextTokens: 0, completionTokens: 0, createdAt: day(10), completedAt: day(10) },
      { id: "msg_2", conversationId: "cnv_1", ordinal: 1, role: "assistant", body: "Everyone earns 25 days. [1]", status: "complete", refusedReason: null, modelId: "small-4", agentVersionId: "agv_h1", promptTokens: 10, contextTokens: 8, completionTokens: 7, createdAt: day(10), completedAt: day(10) },
      { id: "msg_3", conversationId: "cnv_1", ordinal: 2, role: "user", body: "Thanks", status: "complete", refusedReason: null, modelId: null, agentVersionId: null, promptTokens: 0, contextTokens: 0, completionTokens: 0, createdAt: day(10), completedAt: day(10) },
      { id: "msg_4", conversationId: "cnv_5", ordinal: 0, role: "user", body: "Tom asks", status: "complete", refusedReason: null, modelId: null, agentVersionId: null, promptTokens: 0, contextTokens: 0, completionTokens: 0, createdAt: day(11), completedAt: day(11) },
    ],
    citations: [{ id: "cit_1", messageId: "msg_2", index: 1, chunkId: "chk_1", documentId: "doc_leave", documentTitle: "Leave", documentVersion: 1, startChar: 9, endChar: 32, quote: "Everyone earns 25 days." }],
    usageEvents: [
      usage("use_1", "usr_lea", "agt_helper", "small-4", "input", 1000, 150, day(10)),
      usage("use_2", "usr_lea", "agt_helper", "small-4", "cached_input", 2000, 15, day(10)),
      usage("use_3", "usr_lea", "agt_helper", "small-4", "output", 500, 600, day(10)),
      usage("use_4", "usr_tom", "agt_field", "large-4", "input", 1000, 700, day(11)),
      usage("use_5", "usr_tom", null, "large-4", "output", 10, 2100, day(12)),
      usage("use_6", "usr_lea", "agt_helper", "small-4", "input", 999, 150, day(40)),
    ],
    budgets: [
      { id: "bud_1", workspaceId: "ws_oriel", month: "2026-09", limitMicros: 2_000_000, status: "open", setBy: "usr_noor", createdAt: T0 },
      { id: "bud_2", workspaceId: "ws_oriel", month: "2026-08", limitMicros: 1_000_000, status: "closed", setBy: "usr_noor", createdAt: day(-31) },
      { id: "bud_3", workspaceId: "ws_brindille", month: "2026-09", limitMicros: 500_000, status: "open", setBy: "usr_bob", createdAt: T0 },
    ],
    scheduledPrompts: [
      { id: "sch_1", workspaceId: "ws_oriel", userId: "usr_lea", agentId: "agt_helper", name: "Monday recap", prompt: "What was decided?", cadence: "weekly", atMinute: 510, weekday: 1, dayOfMonth: null, timezone: "Europe/Paris", nextRunAt: day(14), status: "active", createdAt: day(1), lastRunAt: day(7) },
      { id: "sch_2", workspaceId: "ws_oriel", userId: "usr_lea", agentId: "agt_helper", name: "Ended one", prompt: "Old", cadence: "daily", atMinute: 60, weekday: null, dayOfMonth: null, timezone: "Europe/Paris", nextRunAt: null, status: "ended", createdAt: day(0), lastRunAt: null },
      { id: "sch_3", workspaceId: "ws_oriel", userId: "usr_tom", agentId: "agt_field", name: "Tom's", prompt: "Follow-ups?", cadence: "monthly", atMinute: 540, weekday: null, dayOfMonth: 1, timezone: "Europe/Paris", nextRunAt: day(30), status: "paused", createdAt: day(2), lastRunAt: null },
    ],
    scheduledRuns: [
      { id: "run_1", scheduledPromptId: "sch_1", scheduledFor: day(7), startedAt: day(7), finishedAt: day(7), status: "succeeded", conversationId: "cnv_2", error: null },
      { id: "run_2", scheduledPromptId: "sch_1", scheduledFor: day(0), startedAt: day(0), finishedAt: day(0), status: "failed", conversationId: null, error: "No document" },
    ],
    auditLog: [
      { id: "aud_1", workspaceId: "ws_oriel", actorId: "usr_noor", action: "library.created", entityKind: "library", entityId: "lib_handbook", before: null, after: { name: "Handbook" }, reason: null, at: day(0) },
      { id: "aud_2", workspaceId: "ws_oriel", actorId: "usr_tom", action: "share.requested", entityKind: "share_request", entityId: "shr_1", before: null, after: { subjectId: "lib_runbooks" }, reason: null, at: day(1) },
      { id: "aud_3", workspaceId: "ws_oriel", actorId: null, action: "document.indexed", entityKind: "document", entityId: "doc_leave", before: { status: "processing" }, after: { status: "indexed" }, reason: null, at: day(0) },
      { id: "aud_4", workspaceId: "ws_brindille", actorId: "usr_bob", action: "library.created", entityKind: "library", entityId: "lib_manual", before: null, after: null, reason: null, at: day(0) },
    ],
  };
}

export function portContract(name: string, create: (data: Fixture) => Promise<PortsUnderTest>): void {
  describe(`${name} ports`, () => {
    let t: PortsUnderTest;
    let p: Ports;
    beforeAll(async () => {
      t = await create(fixture());
      p = t.ports;
    });
    afterAll(async () => {
      await t.close();
    });

    describe("workspaces, users and memberships", () => {
      it("finds a workspace and updates its tools and retention", async () => {
        const ws = (await p.workspaces.findById("ws_oriel"))!;
        expect(ws.name).toBe("Oriel");
        await p.workspaces.update({ ...ws, retentionDays: 45, tools: { ...ws.tools, uploads: false } });
        expect(await p.workspaces.findById("ws_oriel")).toMatchObject({ retentionDays: 45, tools: { groundedAnswers: true, scheduledPrompts: true, uploads: false } });
        await p.workspaces.update(ws);
      });

      it("finds a user by id and by email, and inserts one", async () => {
        expect((await p.users.findById("usr_lea"))?.name).toBe("Léa");
        expect((await p.users.findByEmail("tom@example.com"))?.id).toBe("usr_tom");
        expect(await p.users.findByEmail("nobody@example.com")).toBeNull();
        await p.users.insert(user("usr_zed", "Zed"));
        expect((await p.users.findById("usr_zed"))?.email).toBe("zed@example.com");
      });

      it("finds a membership by id and by workspace and user", async () => {
        expect((await p.memberships.findById("mem_noor"))?.role).toBe("admin");
        expect((await p.memberships.find("ws_oriel", "usr_ada"))?.status).toBe("suspended");
        expect(await p.memberships.find("ws_brindille", "usr_noor")).toBeNull();
      });

      it("lists a user's memberships with their workspaces", async () => {
        const mine = await p.memberships.listByUser("usr_lea");
        expect(mine.map((m) => [m.workspace.slug, m.role])).toEqual([
          ["oriel", "member"],
          ["brindille", "member"],
        ]);
      });

      it("lists a workspace's members with the user, by name, filtered by status, role and text", async () => {
        const all = await p.memberships.list("ws_oriel", { limit: 50, cursor: null });
        expect(all.items.map((m) => m.user.name)).toEqual(["Ada", "Léa", "Noor", "Tom"]);
        expect(all.items[0]).not.toHaveProperty("passwordHash");
        expect((await p.memberships.list("ws_oriel", { limit: 50, cursor: null, status: "suspended" })).items.map((m) => m.id)).toEqual(["mem_ada"]);
        expect((await p.memberships.list("ws_oriel", { limit: 50, cursor: null, role: "admin" })).items.map((m) => m.id)).toEqual(["mem_noor"]);
        expect((await p.memberships.list("ws_oriel", { limit: 50, cursor: null, q: "tom@" })).items.map((m) => m.id)).toEqual(["mem_tom"]);
        expect((await p.memberships.list("ws_oriel", { limit: 50, cursor: null, q: "NOO" })).items.map((m) => m.id)).toEqual(["mem_noor"]);
      });

      it("pages the members list by cursor", async () => {
        const first = await p.memberships.list("ws_oriel", { limit: 3, cursor: null });
        expect(first.items).toHaveLength(3);
        expect(first.nextCursor).not.toBeNull();
        const second = await p.memberships.list("ws_oriel", { limit: 3, cursor: first.nextCursor });
        expect(second.items.map((m) => m.user.name)).toEqual(["Tom"]);
        expect(second.nextCursor).toBeNull();
      });

      it("counts the active admins, inserts and updates a membership", async () => {
        expect(await p.memberships.countActiveAdmins("ws_oriel")).toBe(1);
        await p.memberships.insert(membership("mem_zed", "ws_oriel", "usr_zed", "admin", "active", day(9)));
        expect(await p.memberships.countActiveAdmins("ws_oriel")).toBe(2);
        const zed = (await p.memberships.findById("mem_zed"))!;
        await p.memberships.update({ ...zed, status: "suspended" });
        expect(await p.memberships.countActiveAdmins("ws_oriel")).toBe(1);
      });
    });

    describe("sessions and invitations", () => {
      it("finds a live session by its token hash and not an expired one", async () => {
        expect((await p.sessions.findActive("hash-lea", day(1)))?.id).toBe("ses_1");
        expect(await p.sessions.findActive("hash-lea", day(4))).toBeNull();
        expect(await p.sessions.findActive("hash-old", day(1))).toBeNull();
        expect(await p.sessions.findActive("nothing", day(1))).toBeNull();
      });

      it("inserts, rewrites, deletes a session, and deletes every session of a user in a workspace", async () => {
        await p.sessions.insert({ id: "ses_x", tokenHash: "hash-x", userId: "usr_tom", workspaceId: "ws_oriel", createdAt: day(1), expiresAt: day(5) });
        const s = (await p.sessions.findById("ses_x"))!;
        expect(s.tokenHash).toBe("hash-x");
        await p.sessions.update({ ...s, workspaceId: "ws_brindille" });
        expect((await p.sessions.findActive("hash-x", day(1)))?.workspaceId).toBe("ws_brindille");
        await p.sessions.delete("ses_x");
        expect(await p.sessions.findActive("hash-x", day(1))).toBeNull();
        expect(await p.sessions.deleteByUser("usr_tom", "ws_oriel")).toBe(1);
        expect(await p.sessions.findActive("hash-tom", day(1))).toBeNull();
        expect((await p.sessions.findActive("hash-lea", day(1)))?.id).toBe("ses_1");
      });

      it("finds an invitation by id, by token hash and as the pending one for an email", async () => {
        expect((await p.invitations.findById("inv_1"))?.email).toBe("new@example.com");
        expect((await p.invitations.findByTokenHash("inv-hash-3"))?.workspaceId).toBe("ws_brindille");
        expect((await p.invitations.findPending("ws_oriel", "new@example.com"))?.id).toBe("inv_1");
        expect(await p.invitations.findPending("ws_oriel", "old@example.com")).toBeNull();
      });

      it("lists a workspace's invitations newest first, filtered by status, and updates one", async () => {
        await p.invitations.insert({ id: "inv_4", workspaceId: "ws_oriel", email: "later@example.com", role: "admin", tokenHash: "inv-hash-4", status: "sent", invitedBy: "usr_noor", acceptedUserId: null, createdAt: day(3), expiresAt: day(10) });
        expect((await p.invitations.list("ws_oriel", { limit: 50, cursor: null })).items.map((i) => i.id)).toEqual(["inv_4", "inv_1", "inv_2"]);
        expect((await p.invitations.list("ws_oriel", { limit: 50, cursor: null, status: "sent" })).items.map((i) => i.id)).toEqual(["inv_4", "inv_1"]);
        const inv = (await p.invitations.findById("inv_4"))!;
        await p.invitations.update({ ...inv, status: "accepted", acceptedUserId: "usr_zed" });
        expect(await p.invitations.findById("inv_4")).toMatchObject({ status: "accepted", acceptedUserId: "usr_zed" });
      });
    });

    describe("models", () => {
      it("lists the models with their prices", async () => {
        expect((await p.models.list()).map((m) => m.id)).toEqual(["large-4", "mini-3b", "small-4"]);
        expect((await p.models.findById("small-4"))?.enabled).toBe(true);
        expect(await p.models.findById("none")).toBeNull();
        expect((await p.models.prices()).map((x) => x.id).sort()).toEqual(["prc_1", "prc_2", "prc_3", "prc_4", "prc_5"]);
      });
    });

    describe("libraries, documents and chunks", () => {
      it("finds a library by id and by slug in its workspace", async () => {
        expect((await p.libraries.findById("lib_handbook"))?.name).toBe("Handbook");
        expect((await p.libraries.findBySlug("ws_oriel", "runbooks"))?.id).toBe("lib_runbooks");
        expect(await p.libraries.findBySlug("ws_brindille", "runbooks")).toBeNull();
        expect((await p.libraries.findMany(["lib_field", "lib_handbook", "lib_none"])).map((l) => l.id)).toEqual(["lib_field", "lib_handbook"]);
      });

      it("lists libraries by scope with the owner's name and the document counts", async () => {
        const own = await p.libraries.list("ws_oriel", { limit: 50, cursor: null, scope: "own", userId: "usr_tom", sort: "name" });
        expect(own.items.map((l) => l.name)).toEqual(["Field notes", "Runbooks"]);
        const shared = await p.libraries.list("ws_oriel", { limit: 50, cursor: null, scope: "shared", userId: "usr_lea", sort: "name" });
        expect(shared.items.map((l) => [l.name, l.ownerName, l.documentCount, l.indexedCount])).toEqual([
          ["Handbook", "Noor", 3, 2],
          ["Runbooks", "Tom", 0, 0],
        ]);
        const all = await p.libraries.list("ws_oriel", { limit: 50, cursor: null, scope: "all", userId: "usr_noor", sort: "newest" });
        expect(all.items.map((l) => l.name)).toEqual(["Field notes", "Drafts", "Runbooks", "Handbook"]);
        expect((await p.libraries.list("ws_oriel", { limit: 50, cursor: null, scope: "all", userId: "usr_noor", sort: "name", q: "note" })).items.map((l) => l.id)).toEqual(["lib_field"]);
      });

      it("pages libraries sorted by name and by update time", async () => {
        const first = await p.libraries.list("ws_oriel", { limit: 2, cursor: null, scope: "all", userId: "usr_noor", sort: "name" });
        expect(first.items.map((l) => l.name)).toEqual(["Drafts", "Field notes"]);
        const second = await p.libraries.list("ws_oriel", { limit: 2, cursor: first.nextCursor, scope: "all", userId: "usr_noor", sort: "name" });
        expect(second.items.map((l) => l.name)).toEqual(["Handbook", "Runbooks"]);
        expect(second.nextCursor).toBeNull();
        const updated = await p.libraries.list("ws_oriel", { limit: 1, cursor: null, scope: "all", userId: "usr_noor", sort: "updated" });
        expect(updated.items.map((l) => l.name)).toEqual(["Field notes"]);
      });

      it("inserts, updates and deletes a library", async () => {
        await p.libraries.insert(library("lib_tmp", "ws_oriel", "usr_lea", "Temp", "private", day(8)));
        const lib = (await p.libraries.findById("lib_tmp"))!;
        await p.libraries.update({ ...lib, name: "Temporary", updatedAt: day(9) });
        expect((await p.libraries.findById("lib_tmp"))?.name).toBe("Temporary");
        await p.libraries.delete("lib_tmp");
        expect(await p.libraries.findById("lib_tmp")).toBeNull();
      });

      it("finds a document with its body and lists a library's documents without bodies", async () => {
        expect((await p.documents.findById("doc_leave"))?.body).toContain("25 days");
        const list = await p.documents.list("lib_handbook", { limit: 50, cursor: null, sort: "title" });
        expect(list.items.map((d) => d.title)).toEqual(["Empty", "Expenses", "Leave"]);
        expect(list.items[0]).not.toHaveProperty("body");
        expect((await p.documents.list("lib_handbook", { limit: 50, cursor: null, sort: "newest" })).items.map((d) => d.id)).toEqual(["doc_empty", "doc_expenses", "doc_leave"]);
        expect((await p.documents.list("lib_handbook", { limit: 50, cursor: null, sort: "newest", status: "indexed" })).items.map((d) => d.id)).toEqual(["doc_expenses", "doc_leave"]);
        expect((await p.documents.list("lib_handbook", { limit: 50, cursor: null, sort: "newest", q: "exp" })).items.map((d) => d.id)).toEqual(["doc_expenses"]);
        const page = await p.documents.list("lib_handbook", { limit: 2, cursor: null, sort: "title" });
        expect((await p.documents.list("lib_handbook", { limit: 2, cursor: page.nextCursor, sort: "title" })).items.map((d) => d.id)).toEqual(["doc_leave"]);
      });

      it("answers the subset of library ids the actor may read: own, shared, or any in an admin's workspace", async () => {
        const ids = ["lib_handbook", "lib_runbooks", "lib_drafts", "lib_field", "lib_manual", "lib_none"];
        expect(await p.libraries.readableIds({ userId: "usr_lea", workspaceId: "ws_oriel", role: "member" }, ids)).toEqual(["lib_drafts", "lib_handbook", "lib_runbooks"]);
        expect(await p.libraries.readableIds({ userId: "usr_tom", workspaceId: "ws_oriel", role: "member" }, ids)).toEqual(["lib_field", "lib_handbook", "lib_runbooks"]);
        expect(await p.libraries.readableIds({ userId: "usr_noor", workspaceId: "ws_oriel", role: "admin" }, ids)).toEqual(["lib_drafts", "lib_field", "lib_handbook", "lib_runbooks"]);
        expect(await p.libraries.readableIds({ userId: "usr_bob", workspaceId: "ws_brindille", role: "admin" }, ids)).toEqual(["lib_manual"]);
        expect(await p.libraries.readableIds({ userId: "usr_lea", workspaceId: "ws_oriel", role: "member" }, [])).toEqual([]);
      });

      it("searches the indexed documents of the given libraries, best first, with the document's title and version", async () => {
        const hits = await p.chunks.search({ libraryIds: ["lib_handbook", "lib_drafts"], question: "How many days do I earn?", limit: 10 });
        expect(hits.map((h) => h.chunkId)).toEqual(["chk_1"]);
        expect(hits[0]).toMatchObject({ documentId: "doc_leave", documentTitle: "Leave", documentVersion: 1, ordinal: 0, startChar: 0, endChar: 32, tokenCount: 8, headingPath: ["Leave"] });
        expect(hits[0]!.score).toBeGreaterThan(0);
        expect((await p.chunks.search({ libraryIds: ["lib_handbook"], question: "receipt", limit: 10 })).map((h) => h.chunkId)).toEqual(["chk_2"]);
        // The title counts: both chunks of "Expenses" match a question about expenses.
        expect((await p.chunks.search({ libraryIds: ["lib_handbook"], question: "expenses", limit: 10 })).map((h) => h.chunkId).sort()).toEqual(["chk_2", "chk_3"]);
        expect(await p.chunks.search({ libraryIds: ["lib_handbook"], question: "expenses", limit: 1 })).toHaveLength(1);
      });

      it("finds nothing for a question of stop words, for another library, or for a document that is not indexed", async () => {
        expect(await p.chunks.search({ libraryIds: ["lib_handbook"], question: "What is it?", limit: 10 })).toEqual([]);
        expect(await p.chunks.search({ libraryIds: ["lib_runbooks"], question: "days", limit: 10 })).toEqual([]);
        expect(await p.chunks.search({ libraryIds: [], question: "days", limit: 10 })).toEqual([]);
        const draft = (await p.documents.findById("doc_draft"))!;
        await p.chunks.replaceForDocument("doc_draft", [{ id: "chk_draft", documentId: "doc_draft", ordinal: 0, headingPath: ["Draft"], headingText: "Draft", startChar: 0, endChar: draft.body.length, tokenCount: 4, body: draft.body }]);
        expect(await p.chunks.search({ libraryIds: ["lib_drafts"], question: "soon", limit: 10 })).toEqual([]);
        await p.documents.update({ ...draft, status: "indexed", indexedAt: day(3) });
        expect((await p.chunks.search({ libraryIds: ["lib_drafts"], question: "soon", limit: 10 })).map((h) => h.chunkId)).toEqual(["chk_draft"]);
        await p.documents.update(draft);
      });

      it("replaces a document's chunks", async () => {
        await p.chunks.replaceForDocument("doc_draft", [
          { id: "chk_d1", documentId: "doc_draft", ordinal: 0, headingPath: [], headingText: "", startChar: 0, endChar: 7, tokenCount: 2, body: "# Draft" },
          { id: "chk_d2", documentId: "doc_draft", ordinal: 1, headingPath: ["Draft"], headingText: "Draft", startChar: 9, endChar: 14, tokenCount: 2, body: "Soon." },
        ]);
        expect((await p.chunks.listByDocument("doc_draft")).map((c) => c.id)).toEqual(["chk_d1", "chk_d2"]);
        await p.chunks.replaceForDocument("doc_draft", []);
        expect(await p.chunks.listByDocument("doc_draft")).toEqual([]);
      });

      it("lists a document's chunks in order, and deleting the document keeps the citation's quote", async () => {
        expect((await p.chunks.listByDocument("doc_expenses")).map((c) => c.ordinal)).toEqual([0, 1]);
        const doc = (await p.documents.findById("doc_leave"))!;
        await p.documents.update({ ...doc, title: "Leave and time off" });
        expect((await p.documents.findById("doc_leave"))?.title).toBe("Leave and time off");
        await p.documents.delete("doc_leave");
        expect(await p.documents.findById("doc_leave")).toBeNull();
        expect(await p.chunks.listByDocument("doc_leave")).toEqual([]);
        const [msg] = (await p.messages.list("cnv_1", { limit: 50, cursor: null })).items.filter((m) => m.id === "msg_2");
        expect(msg?.citations).toEqual([expect.objectContaining({ chunkId: null, documentId: null, quote: "Everyone earns 25 days.", documentTitle: "Leave" })]);
      });
    });

    describe("agents and versions", () => {
      it("finds an agent by id and by slug, and lists by scope with the version summary", async () => {
        expect((await p.agents.findById("agt_helper"))?.currentVersionId).toBe("agv_h1");
        expect((await p.agents.findBySlug("ws_oriel", "field-agent"))?.id).toBe("agt_field");
        const shared = await p.agents.list("ws_oriel", { limit: 50, cursor: null, scope: "shared", userId: "usr_lea", sort: "name" });
        expect(shared.items.map((a) => [a.name, a.ownerName, a.currentVersion, a.versionCount, a.status])).toEqual([
          ["Handbook helper", "Noor", 2, 3, "active"],
          ["Old bot", "Noor", 1, 1, "archived"],
        ]);
        expect((await p.agents.list("ws_oriel", { limit: 50, cursor: null, scope: "own", userId: "usr_lea", sort: "newest" })).items.map((a) => [a.id, a.currentVersion])).toEqual([["agt_new", null]]);
        expect((await p.agents.list("ws_oriel", { limit: 50, cursor: null, scope: "all", userId: "usr_noor", sort: "newest" })).items.map((a) => a.id)).toEqual(["agt_new", "agt_field", "agt_helper", "agt_old"]);
        expect((await p.agents.list("ws_oriel", { limit: 50, cursor: null, scope: "all", userId: "usr_noor", sort: "name", q: "BOT" })).items.map((a) => a.id)).toEqual(["agt_old"]);
      });

      it("lists an agent's versions in order with their libraries, and rewrites a version's libraries", async () => {
        const versions = await p.agentVersions.listByAgent("agt_helper");
        expect(versions.map((v) => [v.version, v.status])).toEqual([
          [1, "retired"],
          [2, "published"],
          [3, "draft"],
        ]);
        expect(await p.agentVersions.librariesOf("agv_h1")).toEqual(["lib_handbook", "lib_runbooks"]);
        await p.agentVersions.setLibraries("agv_h2", ["lib_runbooks"]);
        expect(await p.agentVersions.librariesOf("agv_h2")).toEqual(["lib_runbooks"]);
      });

      it("inserts an agent and a version, then updates both", async () => {
        await p.agents.insert(agent("agt_tmp", "ws_oriel", "usr_lea", "Temp agent", "private", null, day(9)));
        await p.agentVersions.insert(version("agv_t1", "agt_tmp", 1, "draft", day(9)));
        await p.agentVersions.setLibraries("agv_t1", ["lib_drafts"]);
        const v = (await p.agentVersions.findById("agv_t1"))!;
        await p.agentVersions.update({ ...v, status: "published", publishedAt: day(10) });
        const a = (await p.agents.findById("agt_tmp"))!;
        await p.agents.update({ ...a, currentVersionId: "agv_t1" });
        expect(await p.agents.findById("agt_tmp")).toMatchObject({ currentVersionId: "agv_t1" });
        expect((await p.agentVersions.findById("agv_t1"))?.status).toBe("published");
      });
    });

    describe("share requests", () => {
      it("finds a request, the pending one for a subject, and lists the requester's and the inbox with names", async () => {
        expect((await p.shareRequests.findById("shr_3"))?.reason).toBe("Not yet");
        expect((await p.shareRequests.findPending("library", "lib_field"))?.id).toBe("shr_2");
        expect(await p.shareRequests.findPending("library", "lib_runbooks")).toBeNull();
        const mine = await p.shareRequests.listByRequester("ws_oriel", "usr_tom", { limit: 50, cursor: null });
        expect(mine.items.map((r) => [r.id, r.subjectName, r.requesterName])).toEqual([
          ["shr_2", "Field notes", "Tom"],
          ["shr_3", "Field agent", "Tom"],
          ["shr_1", "Runbooks", "Tom"],
        ]);
        const inbox = await p.shareRequests.inbox("ws_oriel", { limit: 50, cursor: null, status: "requested" });
        expect(inbox.items.map((r) => r.id)).toEqual(["shr_4", "shr_2"]);
        expect((await p.shareRequests.inbox("ws_oriel", { limit: 50, cursor: null })).items.map((r) => r.id)).toEqual(["shr_4", "shr_2", "shr_3", "shr_1"]);
      });

      it("inserts and updates a request", async () => {
        await p.shareRequests.insert({ id: "shr_x", workspaceId: "ws_oriel", subjectKind: "agent", subjectId: "agt_new", requestedBy: "usr_lea", status: "requested", reason: null, decidedBy: null, createdAt: day(7), decidedAt: null });
        const r = (await p.shareRequests.findById("shr_x"))!;
        await p.shareRequests.update({ ...r, status: "withdrawn", decidedAt: day(8) });
        expect(await p.shareRequests.findById("shr_x")).toMatchObject({ status: "withdrawn" });
      });
    });

    describe("conversations and messages", () => {
      it("answers the archived conversations of a workspace archived before an instant, and deletes a conversation's messages", async () => {
        const archived = (await p.conversations.findById("cnv_3"))!;
        await p.conversations.update({ ...archived, archivedAt: day(6) });
        expect((await p.conversations.archivedBefore("ws_oriel", day(6))).map((c) => c.id)).toEqual([]);
        expect((await p.conversations.archivedBefore("ws_oriel", day(7))).map((c) => c.id)).toEqual(["cnv_3"]);
        expect((await p.conversations.archivedBefore("ws_brindille", day(7))).map((c) => c.id)).toEqual([]);
        await p.messages.insert({ id: "msg_gone", conversationId: "cnv_3", ordinal: 0, role: "user", body: "Old", status: "complete", refusedReason: null, modelId: null, agentVersionId: null, promptTokens: 0, contextTokens: 0, completionTokens: 0, createdAt: day(5), completedAt: day(5) });
        await p.messages.insert({ id: "msg_gone2", conversationId: "cnv_3", ordinal: 1, role: "assistant", body: "Yes. [1]", status: "complete", refusedReason: null, modelId: "small-4", agentVersionId: "agv_h1", promptTokens: 1, contextTokens: 1, completionTokens: 1, createdAt: day(5), completedAt: day(5) });
        await p.messages.insertCitations([{ id: "cit_gone", messageId: "msg_gone2", index: 1, chunkId: "chk_2", documentId: "doc_expenses", documentTitle: "Expenses", documentVersion: 1, startChar: 12, endChar: 29, quote: "Keep the receipt." }]);
        await p.usage.insert({ id: "use_gone", workspaceId: "ws_oriel", userId: "usr_lea", agentId: "agt_helper", messageId: "msg_gone2", modelId: "small-4", kind: "input", tokens: 1, microsPer1k: 150, costMicros: 0, occurredAt: day(45) });
        expect(await p.messages.deleteByConversation("cnv_3")).toBe(2);
        expect((await p.messages.list("cnv_3", { limit: 50, cursor: null })).items).toEqual([]);
        // The usage row survives without its message, so the month still adds up.
        expect((await p.usage.mine("ws_oriel", "usr_lea", "2026-10")).byKind.input.tokens).toBe(1000);
        await p.conversations.update(archived);
      });

      it("lists every workspace", async () => {
        expect((await p.workspaces.list()).map((w) => w.id)).toEqual(["ws_brindille", "ws_oriel"]);
      });

      it("lists a member's conversations by status, latest first, with the agent's name and a text filter", async () => {
        const active = await p.conversations.list("ws_oriel", "usr_lea", { limit: 50, cursor: null, status: "active" });
        expect(active.items.map((c) => [c.id, c.agentName])).toEqual([
          ["cnv_2", "Handbook helper"],
          ["cnv_1", "Handbook helper"],
        ]);
        expect((await p.conversations.list("ws_oriel", "usr_lea", { limit: 50, cursor: null, status: "archived" })).items.map((c) => c.id)).toEqual(["cnv_3"]);
        expect((await p.conversations.list("ws_oriel", "usr_lea", { limit: 50, cursor: null, status: "active", q: "leave" })).items.map((c) => c.id)).toEqual(["cnv_1"]);
        const first = await p.conversations.list("ws_oriel", "usr_lea", { limit: 1, cursor: null, status: "active" });
        expect((await p.conversations.list("ws_oriel", "usr_lea", { limit: 1, cursor: first.nextCursor, status: "active" })).items.map((c) => c.id)).toEqual(["cnv_1"]);
      });

      it("inserts and updates a conversation", async () => {
        await p.conversations.insert(conversation("cnv_x", "usr_lea", "agt_helper", "New conversation", "active", day(13)));
        const c = (await p.conversations.findById("cnv_x"))!;
        await p.conversations.update({ ...c, title: "Renamed", status: "archived", archivedAt: day(14) });
        expect(await p.conversations.findById("cnv_x")).toMatchObject({ title: "Renamed", status: "archived" });
      });

      it("lists a conversation's messages in order with their citations, paged", async () => {
        const all = await p.messages.list("cnv_1", { limit: 50, cursor: null });
        expect(all.items.map((m) => [m.ordinal, m.role, m.citations.length])).toEqual([
          [0, "user", 0],
          [1, "assistant", 1],
          [2, "user", 0],
        ]);
        const first = await p.messages.list("cnv_1", { limit: 2, cursor: null });
        expect((await p.messages.list("cnv_1", { limit: 2, cursor: first.nextCursor })).items.map((m) => m.id)).toEqual(["msg_3"]);
      });
    });

    describe("writing messages, citations and usage", () => {
      it("inserts a message, updates its status and counts, and inserts its citations", async () => {
        const at = day(20);
        await p.messages.insert({ id: "msg_w1", conversationId: "cnv_5", ordinal: 1, role: "assistant", body: "", status: "streaming", refusedReason: null, modelId: "small-4", agentVersionId: "agv_f1", promptTokens: 12, contextTokens: 0, completionTokens: 0, createdAt: at, completedAt: null });
        await p.messages.update({ id: "msg_w1", conversationId: "cnv_5", ordinal: 1, role: "assistant", body: "Keep the receipt. [1]", status: "complete", refusedReason: null, modelId: "small-4", agentVersionId: "agv_f1", promptTokens: 12, contextTokens: 4, completionTokens: 6, createdAt: at, completedAt: day(21) });
        await p.messages.insertCitations([{ id: "cit_w1", messageId: "msg_w1", index: 1, chunkId: "chk_2", documentId: "doc_expenses", documentTitle: "Expenses", documentVersion: 1, startChar: 12, endChar: 29, quote: "Keep the receipt." }]);
        await p.messages.insertCitations([]);
        const [msg] = (await p.messages.list("cnv_5", { limit: 50, cursor: null })).items.filter((m) => m.id === "msg_w1");
        expect(msg).toMatchObject({ body: "Keep the receipt. [1]", status: "complete", contextTokens: 4, completionTokens: 6, completedAt: day(21) });
        expect(msg?.citations).toEqual([expect.objectContaining({ id: "cit_w1", index: 1, chunkId: "chk_2", quote: "Keep the receipt." })]);
        await p.messages.insert({ id: "msg_w2", conversationId: "cnv_5", ordinal: 2, role: "assistant", body: "No.", status: "refused", refusedReason: "no_sources", modelId: "small-4", agentVersionId: "agv_f1", promptTokens: 0, contextTokens: 0, completionTokens: 0, createdAt: at, completedAt: at });
        expect((await p.messages.list("cnv_5", { limit: 50, cursor: null })).items.map((m) => m.ordinal)).toEqual([0, 1, 2]);
      });

      it("inserts usage rows that the sums then see", async () => {
        expect(await p.usage.spentMicros("ws_oriel", "2026-10")).toBe(150);
        await p.usage.insert({ id: "use_w1", workspaceId: "ws_oriel", userId: "usr_tom", agentId: "agt_field", messageId: "msg_w1", modelId: "small-4", kind: "output", tokens: 6, microsPer1k: 600, costMicros: 4, occurredAt: day(45) });
        expect(await p.usage.spentMicros("ws_oriel", "2026-10")).toBe(154);
        expect((await p.usage.mine("ws_oriel", "usr_tom", "2026-10")).byKind.output).toEqual({ tokens: 6, costMicros: 4 });
      });
    });

    describe("usage and budgets", () => {
      it("sums a month's spend and a member's own usage by kind", async () => {
        expect(await p.usage.spentMicros("ws_oriel", "2026-09")).toBe(150 + 30 + 300 + 700 + 21);
        expect(await p.usage.spentMicros("ws_oriel", "2026-10")).toBe(154);
        expect(await p.usage.spentMicros("ws_brindille", "2026-09")).toBe(0);
        expect(await p.usage.mine("ws_oriel", "usr_lea", "2026-09")).toEqual({
          tokens: 3500,
          costMicros: 480,
          byKind: { input: { tokens: 1000, costMicros: 150 }, cached_input: { tokens: 2000, costMicros: 30 }, output: { tokens: 500, costMicros: 300 } },
        });
      });

      it("groups a month's usage by model, member, agent and day, each with its label", async () => {
        expect(await p.usage.total("ws_oriel", "2026-09")).toEqual({ rows: 5, tokens: 4510, costMicros: 1201 });
        expect(await p.usage.byModel("ws_oriel", "2026-09")).toEqual([
          { key: "large-4", label: "Large 4", tokens: 1010, costMicros: 721 },
          { key: "small-4", label: "Small 4", tokens: 3500, costMicros: 480 },
        ]);
        expect(await p.usage.byMember("ws_oriel", "2026-09")).toEqual([
          { key: "usr_lea", label: "Léa", tokens: 3500, costMicros: 480 },
          { key: "usr_tom", label: "Tom", tokens: 1010, costMicros: 721 },
        ]);
        expect(await p.usage.byAgent("ws_oriel", "2026-09")).toEqual([
          { key: "", label: "", tokens: 10, costMicros: 21 },
          { key: "agt_field", label: "Field agent", tokens: 1000, costMicros: 700 },
          { key: "agt_helper", label: "Handbook helper", tokens: 3500, costMicros: 480 },
        ]);
        expect(await p.usage.byDay("ws_oriel", "2026-09")).toEqual([
          { key: "2026-09-11", label: "2026-09-11", tokens: 3500, costMicros: 480 },
          { key: "2026-09-12", label: "2026-09-12", tokens: 1000, costMicros: 700 },
          { key: "2026-09-13", label: "2026-09-13", tokens: 10, costMicros: 21 },
        ]);
      });

      it("lists the open budgets of months before a given one, across workspaces", async () => {
        expect((await p.budgets.openBefore("2026-09")).map((b) => b.id)).toEqual([]);
        expect((await p.budgets.openBefore("2026-10")).map((b) => b.id).sort()).toEqual(["bud_1", "bud_3"]);
      });

      it("finds a month's budget, lists a workspace's, inserts and updates one", async () => {
        expect((await p.budgets.find("ws_oriel", "2026-09"))?.limitMicros).toBe(2_000_000);
        expect(await p.budgets.find("ws_oriel", "2026-10")).toBeNull();
        expect((await p.budgets.list("ws_oriel")).map((b) => b.month)).toEqual(["2026-09", "2026-08"]);
        await p.budgets.insert({ id: "bud_x", workspaceId: "ws_oriel", month: "2026-10", limitMicros: 3_000_000, status: "open", setBy: "usr_noor", createdAt: day(20) });
        const b = (await p.budgets.find("ws_oriel", "2026-10"))!;
        await p.budgets.update({ ...b, limitMicros: 4_000_000 });
        expect((await p.budgets.find("ws_oriel", "2026-10"))?.limitMicros).toBe(4_000_000);
      });
    });

    describe("schedules and the audit log", () => {
      it("lists a member's schedules newest first with the agent's name, and a schedule's runs latest first", async () => {
        const mine = await p.schedules.list("ws_oriel", "usr_lea", { limit: 50, cursor: null });
        expect(mine.items.map((s) => [s.id, s.agentName])).toEqual([
          ["sch_1", "Handbook helper"],
          ["sch_2", "Handbook helper"],
        ]);
        expect((await p.schedules.runs("sch_1")).map((r) => r.id)).toEqual(["run_1", "run_2"]);
        expect(await p.schedules.runs("sch_2")).toEqual([]);
      });

      it("inserts and updates a schedule", async () => {
        await p.schedules.insert({ id: "sch_x", workspaceId: "ws_oriel", userId: "usr_lea", agentId: "agt_helper", name: "New", prompt: "?", cadence: "once", atMinute: 0, weekday: null, dayOfMonth: null, timezone: "UTC", nextRunAt: day(20), status: "active", createdAt: day(15), lastRunAt: null });
        const s = (await p.schedules.findById("sch_x"))!;
        await p.schedules.update({ ...s, status: "paused", nextRunAt: null });
        expect(await p.schedules.findById("sch_x")).toMatchObject({ status: "paused", nextRunAt: null });
      });

      it("answers the active schedules due at an instant, oldest first, across workspaces", async () => {
        expect((await p.schedules.due(day(13))).map((s) => s.id)).toEqual([]);
        expect((await p.schedules.due(day(14))).map((s) => s.id)).toEqual(["sch_1"]);
        await p.schedules.insert({ id: "sch_due", workspaceId: "ws_brindille", userId: "usr_bob", agentId: "agt_shop", name: "Bob's", prompt: "?", cadence: "daily", atMinute: 0, weekday: null, dayOfMonth: null, timezone: "UTC", nextRunAt: day(12), status: "active", createdAt: day(1), lastRunAt: null });
        expect((await p.schedules.due(day(30))).map((s) => s.id)).toEqual(["sch_due", "sch_1"]);
        // Paused and ended schedules are never due.
        expect((await p.schedules.due(day(60))).map((s) => s.id)).toEqual(["sch_due", "sch_1"]);
      });

      it("inserts and updates a run, which the schedule's runs then show", async () => {
        await p.schedules.insertRun({ id: "run_x", scheduledPromptId: "sch_1", scheduledFor: day(14), startedAt: null, finishedAt: null, status: "queued", conversationId: null, error: null });
        expect((await p.schedules.runs("sch_1")).map((r) => r.id)).toEqual(["run_x", "run_1", "run_2"]);
        await p.schedules.updateRun({ id: "run_x", scheduledPromptId: "sch_1", scheduledFor: day(14), startedAt: day(14), finishedAt: day(14), status: "succeeded", conversationId: "cnv_1", error: null });
        expect((await p.schedules.runs("sch_1"))[0]).toMatchObject({ status: "succeeded", conversationId: "cnv_1", startedAt: day(14) });
        expect((await p.schedules.runs("sch_1")).filter((r) => r.status === "running")).toEqual([]);
      });

      it("lists the audit log latest first with the actor's name, filtered by entity, actor and action", async () => {
        await p.audit.insert({ id: "aud_x", workspaceId: "ws_oriel", actorId: "usr_lea", action: "library.updated", entityKind: "library", entityId: "lib_drafts", before: { name: "Drafts" }, after: { name: "My drafts" }, reason: null, at: day(9) });
        const all = await p.audit.list("ws_oriel", { limit: 50, cursor: null });
        expect(all.items.map((e) => [e.id, e.actorName])).toEqual([
          ["aud_x", "Léa"],
          ["aud_2", "Tom"],
          ["aud_3", null],
          ["aud_1", "Noor"],
        ]);
        expect((await p.audit.list("ws_oriel", { limit: 50, cursor: null, entityKind: "library" })).items.map((e) => e.id)).toEqual(["aud_x", "aud_1"]);
        expect((await p.audit.list("ws_oriel", { limit: 50, cursor: null, entityKind: "library", entityId: "lib_drafts" })).items.map((e) => e.id)).toEqual(["aud_x"]);
        expect((await p.audit.list("ws_oriel", { limit: 50, cursor: null, actorId: "usr_tom" })).items.map((e) => e.id)).toEqual(["aud_2"]);
        expect((await p.audit.list("ws_oriel", { limit: 50, cursor: null, action: "library.created" })).items.map((e) => e.id)).toEqual(["aud_1"]);
        const first = await p.audit.list("ws_oriel", { limit: 2, cursor: null });
        expect((await p.audit.list("ws_oriel", { limit: 2, cursor: first.nextCursor })).items.map((e) => e.id)).toEqual(["aud_3", "aud_1"]);
      });
    });

    describe("the unit of work", () => {
      it("keeps every write of a unit that finishes", async () => {
        await t.unitOfWork.run(async (on) => {
          await on.users.insert(user("usr_unit", "Unit"));
          await on.memberships.insert(membership("mem_unit", "ws_oriel", "usr_unit", "member"));
        });
        expect((await p.memberships.find("ws_oriel", "usr_unit"))?.id).toBe("mem_unit");
      });

      it("drops every write of a unit that throws", async () => {
        await expect(
          t.unitOfWork.run(async (on) => {
            await on.users.insert(user("usr_lost", "Lost"));
            throw new Error("stop");
          }),
        ).rejects.toThrow("stop");
        expect(await p.users.findById("usr_lost")).toBeNull();
      });
    });
  });
}
