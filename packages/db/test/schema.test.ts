import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { connectPglite, rawRows, schema, type Connection } from "../src/index.js";

/*
 * The database refuses what the use cases would refuse. Each test here is one rule that lives in
 * the schema itself: a foreign key, a unique, a check, an enum, the generated search vector.
 */

let conn: Connection;
const NOW = new Date("2026-11-18T18:00:00Z");

/** Drizzle wraps the database's error; the rule's name is in the cause. */
async function refused(run: Promise<unknown>, pattern: RegExp): Promise<void> {
  let message = "no error";
  try {
    await run;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    message = `${err.message} ${err.cause?.message ?? ""}`;
  }
  expect(message).toMatch(pattern);
}

beforeAll(async () => {
  conn = await connectPglite();
  const db = conn.db;
  await db.insert(schema.workspaces).values({ id: "ws_1", slug: "oriel", name: "Oriel", tools: { groundedAnswers: true, scheduledPrompts: true, uploads: true }, retentionDays: 90, createdAt: NOW });
  await db.insert(schema.users).values({ id: "usr_1", email: "lea@example.com", name: "Léa", passwordHash: "scrypt$x", createdAt: NOW });
  await db.insert(schema.models).values({ id: "mdl_large", name: "Large", contextTokens: 128000, enabled: true });
  await db.insert(schema.libraries).values({ id: "lib_1", workspaceId: "ws_1", ownerId: "usr_1", slug: "handbook", name: "Handbook", description: "", visibility: "private", createdAt: NOW, updatedAt: NOW });
  await db.insert(schema.documents).values({ id: "doc_1", libraryId: "lib_1", title: "Leave policy", sourceName: "leave.md", mime: "text/markdown", byteSize: 40, charCount: 40, body: "# Leave\n\nEveryone gets 25 days of leave.", status: "indexed", version: 1, uploadedBy: "usr_1", createdAt: NOW, indexedAt: NOW });
});

afterAll(async () => {
  await conn.close();
});

describe("the schema", () => {
  test("applies the migration and has the twenty-two tables", async () => {
    const rows = await rawRows<{ n: string }>(conn.db, sql`select count(*)::text as n from information_schema.tables where table_schema = 'public' and table_name <> '__drizzle_migrations'`);
    expect(Number(rows[0]?.n)).toBe(22);
  });

  test("a membership needs a real user and a real workspace, once", async () => {
    await refused(conn.db.insert(schema.memberships).values({ id: "mem_x", workspaceId: "ws_1", userId: "usr_nobody", role: "member", status: "active", createdAt: NOW }), /foreign key/);
    await conn.db.insert(schema.memberships).values({ id: "mem_1", workspaceId: "ws_1", userId: "usr_1", role: "member", status: "active", createdAt: NOW });
    await refused(conn.db.insert(schema.memberships).values({ id: "mem_2", workspaceId: "ws_1", userId: "usr_1", role: "admin", status: "active", createdAt: NOW }), /unique/);
  });

  test("a chunk's span must be ordered and its tokens positive, and ordinals are unique per document", async () => {
    const base = { documentId: "doc_1", headingPath: ["Leave"], headingText: "Leave", body: "Everyone gets 25 days of leave.", tokenCount: 7 };
    await refused(conn.db.insert(schema.chunks).values({ id: "chk_x", ordinal: 0, startChar: 10, endChar: 10, ...base }), /check/);
    await refused(conn.db.insert(schema.chunks).values({ id: "chk_y", ordinal: 0, startChar: 9, endChar: 40, ...base, tokenCount: 0 }), /check/);
    await conn.db.insert(schema.chunks).values({ id: "chk_1", ordinal: 0, startChar: 9, endChar: 40, ...base });
    await refused(conn.db.insert(schema.chunks).values({ id: "chk_2", ordinal: 0, startChar: 9, endChar: 40, ...base }), /unique/);
  });

  test("the search vector is generated from the heading path and the body and answers a query", async () => {
    const hits = await rawRows<{ id: string; rank: number }>(conn.db, sql`
      select id, ts_rank_cd(tsv, websearch_to_tsquery('english', 'days of leave')) as rank
      from chunks where tsv @@ websearch_to_tsquery('english', 'days of leave')`);
    expect(hits.map((r) => r.id)).toEqual(["chk_1"]);
    expect(hits[0]!.rank).toBeGreaterThan(0);
    const miss = await rawRows<{ id: string }>(conn.db, sql`select id from chunks where tsv @@ websearch_to_tsquery('english', 'invoices')`);
    expect(miss).toEqual([]);
  });

  test("a price's range must be ordered and its amount non-negative", async () => {
    await refused(conn.db.insert(schema.modelPrices).values({ id: "prc_x", modelId: "mdl_large", kind: "input", microsPer1k: -1, validFrom: NOW, validTo: null }), /check/);
    await refused(conn.db.insert(schema.modelPrices).values({ id: "prc_y", modelId: "mdl_large", kind: "input", microsPer1k: 700, validFrom: NOW, validTo: NOW }), /check/);
    await conn.db.insert(schema.modelPrices).values({ id: "prc_1", modelId: "mdl_large", kind: "input", microsPer1k: 700, validFrom: NOW, validTo: null });
  });

  test("a status column refuses a value outside its enum", async () => {
    await refused(conn.db.execute(sql`update documents set status = 'lost' where id = 'doc_1'`), /enum/);
  });

  test("a budget month is unique per workspace and written as YYYY-MM", async () => {
    await refused(conn.db.insert(schema.budgets).values({ id: "bud_x", workspaceId: "ws_1", month: "November", limitMicros: 1, status: "open", setBy: "usr_1", createdAt: NOW }), /check/);
    await conn.db.insert(schema.budgets).values({ id: "bud_1", workspaceId: "ws_1", month: "2026-11", limitMicros: 50_000_000, status: "open", setBy: "usr_1", createdAt: NOW });
    await refused(conn.db.insert(schema.budgets).values({ id: "bud_2", workspaceId: "ws_1", month: "2026-11", limitMicros: 1, status: "open", setBy: "usr_1", createdAt: NOW }), /unique/);
  });

  test("removing a document keeps its citations with their quote but no chunk", async () => {
    const db = conn.db;
    await db.insert(schema.agents).values({ id: "agt_1", workspaceId: "ws_1", ownerId: "usr_1", slug: "helper", name: "Helper", visibility: "private", status: "active", createdAt: NOW });
    await db.insert(schema.agentVersions).values({ id: "agv_1", agentId: "agt_1", version: 1, name: "Helper", description: "", instructions: "Answer from the handbook.", modelId: "mdl_large", maxContextTokens: 4000, status: "published", createdBy: "usr_1", createdAt: NOW, publishedAt: NOW });
    await db.insert(schema.conversations).values({ id: "cnv_1", workspaceId: "ws_1", userId: "usr_1", agentId: "agt_1", agentVersionId: "agv_1", title: "Leave", status: "active", messageCount: 1, tokenTotal: 10, createdAt: NOW, lastMessageAt: NOW });
    await db.insert(schema.messages).values({ id: "msg_1", conversationId: "cnv_1", ordinal: 0, role: "assistant", body: "Everyone gets 25 days of leave. [1]", status: "complete", modelId: "mdl_large", agentVersionId: "agv_1", promptTokens: 3, contextTokens: 7, completionTokens: 8, createdAt: NOW, completedAt: NOW });
    await db.insert(schema.citations).values({ id: "cit_1", messageId: "msg_1", index: 1, chunkId: "chk_1", documentId: "doc_1", documentTitle: "Leave policy", documentVersion: 1, startChar: 9, endChar: 40, quote: "Everyone gets 25 days of leave." });
    await db.delete(schema.documents).where(sql`id = 'doc_1'`);
    const [cit] = await db.select().from(schema.citations);
    expect(cit).toMatchObject({ chunkId: null, documentId: null, quote: "Everyone gets 25 days of leave.", documentTitle: "Leave policy" });
  });
});
