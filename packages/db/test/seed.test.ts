import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { count } from "drizzle-orm";
import { costMicros, priceInForce, verifyPassword } from "@cahier/domain";
import { connectPglite, schema, type Connection } from "../src/index.js";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, generateSeed, seedDatabase, type SeedData } from "../src/seed.js";

/*
 * The seed is the data every test, the server's first start and the browser demo see. These
 * tests are the invariants the real use cases will have to keep: spans that resolve, citations
 * that quote the document, usage that adds up at the price in force, rights that hold.
 */

const NOW = new Date("2026-11-18T18:00:00Z");
let data: SeedData;

beforeAll(async () => {
  data = await generateSeed({ seed: 1, now: NOW });
});

const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
const month = (d: Date) => d.toISOString().slice(0, 7);

describe("generateSeed", () => {
  test("is the same data for the same seed and different data for another", async () => {
    expect(await generateSeed({ seed: 1, now: NOW })).toEqual(data);
    const other = await generateSeed({ seed: 2, now: NOW });
    expect(other.conversations.map((c) => c.title)).not.toEqual(data.conversations.map((c) => c.title));
  });

  test("produces between 10,000 and 20,000 rows, with every table filled", () => {
    const tables = Object.entries(data) as [keyof SeedData, unknown[]][];
    const total = tables.reduce((n, [, rows]) => n + rows.length, 0);
    expect(total).toBeGreaterThanOrEqual(10_000);
    expect(total).toBeLessThanOrEqual(20_000);
    for (const [name, rows] of tables) expect(rows.length, name).toBeGreaterThan(0);
  });

  test("seeds two workspaces and the three demo accounts in Oriel with the demo password", async () => {
    expect(data.workspaces.map((w) => w.slug).sort()).toEqual(["brindille", "oriel"]);
    const oriel = data.workspaces.find((w) => w.slug === "oriel")!;
    for (const account of DEMO_ACCOUNTS) {
      const user = data.users.find((u) => u.email === account.email);
      expect(user, account.email).toBeDefined();
      const membership = data.memberships.find((m) => m.userId === user!.id && m.workspaceId === oriel.id);
      expect(membership?.role, account.email).toBe(account.role);
      expect(membership?.status).toBe("active");
      expect(await verifyPassword(DEMO_PASSWORD, user!.passwordHash)).toBe(true);
    }
  });

  test("emails are unique and lower-case; a user belongs to a workspace once; every workspace has an active admin", () => {
    const emails = data.users.map((u) => u.email);
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails.every((e) => e === e.toLowerCase())).toBe(true);
    const pairs = data.memberships.map((m) => `${m.workspaceId}:${m.userId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const w of data.workspaces) {
      expect(data.memberships.some((m) => m.workspaceId === w.id && m.role === "admin" && m.status === "active"), w.slug).toBe(true);
    }
  });

  test("every price range is ordered and no two ranges of a model and kind overlap", () => {
    for (const p of data.modelPrices) {
      if (p.validTo) expect(p.validTo.getTime()).toBeGreaterThan(p.validFrom.getTime());
      const others = data.modelPrices.filter((o) => o !== p && o.modelId === p.modelId && o.kind === p.kind);
      for (const o of others) {
        const pEnd = p.validTo?.getTime() ?? Infinity;
        const oEnd = o.validTo?.getTime() ?? Infinity;
        expect(p.validFrom.getTime() >= oEnd || o.validFrom.getTime() >= pEnd).toBe(true);
      }
    }
  });

  test("every indexed document is chunked by the chunker: bodies are the text at their spans, in order, covering the document", () => {
    const docs = byId(data.documents);
    const grouped = new Map<string, typeof data.chunks>();
    for (const c of data.chunks) grouped.set(c.documentId, [...(grouped.get(c.documentId) ?? []), c]);
    for (const d of data.documents) {
      const chunks = (grouped.get(d.id) ?? []).sort((a, b) => a.ordinal - b.ordinal);
      if (d.status !== "indexed") {
        expect(chunks, d.title).toHaveLength(0);
        continue;
      }
      expect(chunks.length, d.title).toBeGreaterThan(0);
      expect(d.charCount).toBe(d.body.length);
      const covered = new Array<boolean>(d.body.length).fill(false);
      chunks.forEach((c, i) => {
        expect(c.ordinal).toBe(i);
        expect(d.body.slice(c.startChar, c.endChar)).toBe(c.body);
        expect(c.headingText).toBe(c.headingPath.join(" > "));
        for (let k = c.startChar; k < c.endChar; k++) covered[k] = true;
      });
      for (let k = 0; k < d.body.length; k++) if (!/\s/u.test(d.body[k]!)) expect(covered[k]).toBe(true);
    }
    expect(docs.size).toBe(data.documents.length);
  });

  test("the hand-written corpus is in the right workspace's libraries", () => {
    const libs = byId(data.libraries);
    const ws = byId(data.workspaces);
    const leave = data.documents.find((d) => d.title === "Leave and time off")!;
    expect(ws.get(libs.get(leave.libraryId)!.workspaceId)!.slug).toBe("oriel");
    const hygiene = data.documents.find((d) => d.title === "Hygiene rules")!;
    expect(ws.get(libs.get(hygiene.libraryId)!.workspaceId)!.slug).toBe("brindille");
  });

  test("an agent's current version is one of its own published versions, and only one version of an agent is published", () => {
    const versions = byId(data.agentVersions);
    for (const a of data.agents) {
      const own = data.agentVersions.filter((v) => v.agentId === a.id);
      expect(own.length, a.name).toBeGreaterThan(0);
      expect(new Set(own.map((v) => v.version)).size).toBe(own.length);
      const published = own.filter((v) => v.status === "published");
      expect(published.length).toBeLessThanOrEqual(1);
      if (a.currentVersionId) {
        const v = versions.get(a.currentVersionId)!;
        expect(v.agentId).toBe(a.id);
        expect(v.status).toBe("published");
      } else {
        expect(published).toHaveLength(0);
      }
    }
  });

  test("a version only reads libraries of its agent's workspace that its author may read", () => {
    const libs = byId(data.libraries);
    const agents = byId(data.agents);
    for (const v of data.agentVersions) {
      const agent = agents.get(v.agentId)!;
      for (const link of data.agentVersionLibraries.filter((l) => l.agentVersionId === v.id)) {
        const lib = libs.get(link.libraryId)!;
        expect(lib.workspaceId).toBe(agent.workspaceId);
        expect(lib.ownerId === v.createdBy || lib.visibility === "workspace").toBe(true);
      }
    }
  });

  test("a library or agent shared with the workspace has an approved share request or an admin owner; pending requests are one per subject", () => {
    const admins = new Set(data.memberships.filter((m) => m.role === "admin").map((m) => `${m.workspaceId}:${m.userId}`));
    const approved = new Set(data.shareRequests.filter((r) => r.status === "approved").map((r) => `${r.subjectKind}:${r.subjectId}`));
    for (const lib of data.libraries) {
      if (lib.visibility === "workspace") expect(approved.has(`library:${lib.id}`) || admins.has(`${lib.workspaceId}:${lib.ownerId}`), lib.name).toBe(true);
    }
    for (const a of data.agents) {
      if (a.visibility === "workspace") expect(approved.has(`agent:${a.id}`) || admins.has(`${a.workspaceId}:${a.ownerId}`), a.name).toBe(true);
    }
    const pending = data.shareRequests.filter((r) => r.status === "requested").map((r) => `${r.subjectKind}:${r.subjectId}`);
    expect(new Set(pending).size).toBe(pending.length);
    expect(pending.length).toBeGreaterThan(0);
    for (const r of data.shareRequests) {
      if (r.status === "requested") expect(r.decidedBy).toBeNull();
      else if (r.status !== "withdrawn") expect(r.decidedBy).not.toBeNull();
    }
  });

  test("a conversation belongs to a member of its workspace who may use its agent, with the version that is the agent's", () => {
    const agents = byId(data.agents);
    const versions = byId(data.agentVersions);
    const members = new Set(data.memberships.map((m) => `${m.workspaceId}:${m.userId}`));
    for (const c of data.conversations) {
      const agent = agents.get(c.agentId)!;
      expect(agent.workspaceId).toBe(c.workspaceId);
      expect(members.has(`${c.workspaceId}:${c.userId}`)).toBe(true);
      expect(agent.ownerId === c.userId || agent.visibility === "workspace").toBe(true);
      expect(versions.get(c.agentVersionId)!.agentId).toBe(c.agentId);
    }
  });

  test("messages alternate user and assistant with contiguous ordinals, and the counts on the conversation agree", () => {
    const grouped = new Map<string, typeof data.messages>();
    for (const m of data.messages) grouped.set(m.conversationId, [...(grouped.get(m.conversationId) ?? []), m]);
    for (const c of data.conversations) {
      const msgs = (grouped.get(c.id) ?? []).sort((a, b) => a.ordinal - b.ordinal);
      if (c.status === "deleted") {
        expect(msgs).toHaveLength(0);
        expect(c.messageCount).toBeGreaterThan(0);
        continue;
      }
      expect(msgs.length).toBe(c.messageCount);
      msgs.forEach((m, i) => {
        expect(m.ordinal).toBe(i);
        expect(m.role).toBe(i % 2 === 0 ? "user" : "assistant");
        expect((m.status === "refused") === (m.refusedReason !== null)).toBe(true);
        if (m.role === "user") expect(m.status).toBe("complete");
      });
      expect(c.tokenTotal).toBe(msgs.reduce((n, m) => n + m.promptTokens + m.contextTokens + m.completionTokens, 0));
      expect(c.lastMessageAt.getTime()).toBe(Math.max(...msgs.map((m) => m.createdAt.getTime())));
    }
  });

  test("every citation quotes the document at its span, sits inside its chunk, and the member could read that library", () => {
    const docs = byId(data.documents);
    const chunks = byId(data.chunks);
    const msgs = byId(data.messages);
    const convs = byId(data.conversations);
    const libs = byId(data.libraries);
    const indexes = new Map<string, number[]>();
    for (const cit of data.citations) {
      const doc = docs.get(cit.documentId!)!;
      expect(doc.body.slice(cit.startChar, cit.endChar)).toBe(cit.quote);
      expect(cit.documentTitle).toBe(doc.title);
      expect(cit.documentVersion).toBe(doc.version);
      const chunk = chunks.get(cit.chunkId!)!;
      expect(chunk.documentId).toBe(doc.id);
      expect(cit.startChar).toBeGreaterThanOrEqual(chunk.startChar);
      expect(cit.endChar).toBeLessThanOrEqual(chunk.endChar);
      const message = msgs.get(cit.messageId)!;
      expect(message.role).toBe("assistant");
      expect(message.body).toContain(`${cit.quote} [${cit.index}]`);
      const conv = convs.get(message.conversationId)!;
      const lib = libs.get(doc.libraryId)!;
      expect(lib.workspaceId).toBe(conv.workspaceId);
      expect(lib.ownerId === conv.userId || lib.visibility === "workspace").toBe(true);
      indexes.set(cit.messageId, [...(indexes.get(cit.messageId) ?? []), cit.index]);
    }
    for (const [, list] of indexes) expect([...list].sort((a, b) => a - b)).toEqual(list.map((_, i) => i + 1));
    const cited = new Set(data.citations.map((c) => c.messageId));
    for (const m of data.messages) {
      if (m.role !== "assistant") continue;
      expect(cited.has(m.id), m.id).toBe(m.status === "complete");
    }
  });

  test("usage rows cost tokens at the price in force when they happened, and add up to the message's tokens", () => {
    const msgs = byId(data.messages);
    const convs = byId(data.conversations);
    const perMessage = new Map<string, { input: number; cached_input: number; output: number }>();
    for (const u of data.usageEvents) {
      const price = priceInForce(data.modelPrices, u.modelId, u.kind, u.occurredAt);
      expect(price, `${u.modelId} ${u.kind} ${u.occurredAt.toISOString()}`).not.toBeNull();
      expect(u.microsPer1k).toBe(price!.microsPer1k);
      expect(u.costMicros).toBe(costMicros(u.tokens, u.microsPer1k));
      if (u.messageId === null) continue; // retention deleted the message; the usage stays
      const m = msgs.get(u.messageId)!;
      const c = convs.get(m.conversationId)!;
      expect(u.workspaceId).toBe(c.workspaceId);
      expect(u.userId).toBe(c.userId);
      expect(u.agentId).toBe(c.agentId);
      expect(u.modelId).toBe(m.modelId);
      expect(u.occurredAt.getTime()).toBe(m.createdAt.getTime());
      const acc = perMessage.get(m.id) ?? { input: 0, cached_input: 0, output: 0 };
      acc[u.kind] += u.tokens;
      perMessage.set(m.id, acc);
    }
    for (const m of data.messages) {
      if (m.role !== "assistant" || m.status === "refused") continue;
      const acc = perMessage.get(m.id);
      expect(acc, m.id).toBeDefined();
      expect(acc).toEqual({ input: m.promptTokens, cached_input: m.contextTokens, output: m.completionTokens });
    }
  });

  test("every workspace month with usage has a budget, usage stays under it, and the past months are closed", () => {
    const spent = new Map<string, number>();
    for (const u of data.usageEvents) {
      const key = `${u.workspaceId}:${month(u.occurredAt)}`;
      spent.set(key, (spent.get(key) ?? 0) + u.costMicros);
    }
    const budgets = new Map(data.budgets.map((b) => [`${b.workspaceId}:${b.month}`, b]));
    expect(new Set(data.budgets.map((b) => `${b.workspaceId}:${b.month}`)).size).toBe(data.budgets.length);
    for (const [key, micros] of spent) {
      const b = budgets.get(key);
      expect(b, key).toBeDefined();
      expect(micros).toBeLessThanOrEqual(b!.limitMicros);
    }
    for (const b of data.budgets) expect(b.status).toBe(b.month < month(NOW) ? "closed" : "open");
  });

  test("a scheduled prompt belongs to a member who may use its agent, its runs are in time order, and a run's conversation is the member's", () => {
    const agents = byId(data.agents);
    const convs = byId(data.conversations);
    for (const s of data.scheduledPrompts) {
      const agent = agents.get(s.agentId)!;
      expect(agent.workspaceId).toBe(s.workspaceId);
      expect(agent.ownerId === s.userId || agent.visibility === "workspace").toBe(true);
      if (s.cadence === "weekly") expect(s.weekday).not.toBeNull();
      if (s.cadence === "monthly") expect(s.dayOfMonth).not.toBeNull();
      if (s.status === "active") expect(s.nextRunAt).not.toBeNull();
      const runs = data.scheduledRuns.filter((r) => r.scheduledPromptId === s.id).sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
      for (const r of runs) {
        if (r.status === "succeeded") {
          const c = convs.get(r.conversationId!)!;
          expect(c.userId).toBe(s.userId);
          expect(c.agentId).toBe(s.agentId);
          expect(r.finishedAt).not.toBeNull();
        }
        if (r.status === "failed") expect(r.error).not.toBeNull();
      }
    }
  });

  test("audit rows name an actor who is a member of the workspace, or nobody for the system", () => {
    const members = new Set(data.memberships.map((m) => `${m.workspaceId}:${m.userId}`));
    for (const a of data.auditLog) {
      if (a.actorId) expect(members.has(`${a.workspaceId}:${a.actorId}`), a.action).toBe(true);
      expect(a.at.getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
    const actions = new Set(data.auditLog.map((a) => a.action));
    for (const expected of ["share.approved", "agent.published", "invitation.sent", "membership.suspended", "document.indexed"]) expect(actions.has(expected), expected).toBe(true);
  });
});

describe("seedDatabase", () => {
  let conn: Connection;

  beforeAll(async () => {
    conn = await connectPglite();
    await seedDatabase(conn.db, data);
  });

  afterAll(async () => {
    await conn.close();
  });

  test("loads every row of the seed into PGlite, so the constraints agree with the generator", async () => {
    const tables = {
      workspaces: schema.workspaces,
      users: schema.users,
      memberships: schema.memberships,
      invitations: schema.invitations,
      models: schema.models,
      modelPrices: schema.modelPrices,
      libraries: schema.libraries,
      documents: schema.documents,
      chunks: schema.chunks,
      agents: schema.agents,
      agentVersions: schema.agentVersions,
      agentVersionLibraries: schema.agentVersionLibraries,
      shareRequests: schema.shareRequests,
      conversations: schema.conversations,
      messages: schema.messages,
      citations: schema.citations,
      usageEvents: schema.usageEvents,
      budgets: schema.budgets,
      scheduledPrompts: schema.scheduledPrompts,
      scheduledRuns: schema.scheduledRuns,
      auditLog: schema.auditLog,
    } as const;
    for (const [name, table] of Object.entries(tables)) {
      const [row] = await conn.db.select({ n: count() }).from(table);
      expect(row?.n, name).toBe(data[name as keyof SeedData].length);
    }
  });

  test("is safe to run twice", async () => {
    await seedDatabase(conn.db, data);
    const [row] = await conn.db.select({ n: count() }).from(schema.messages);
    expect(row?.n).toBe(data.messages.length);
  });
});
