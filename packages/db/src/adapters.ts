import { and, asc, count, desc, eq, getTableColumns, gt, ilike, inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import {
  decodeCursor,
  encodeCursor,
  phraseOf,
  queryWords,
  type AgentRow,
  type AuditRow,
  type ConversationRow,
  type LibraryRow,
  type MemberRow,
  type Page,
  type PageQuery,
  type Ports,
  type RetrievedChunk,
  type ShareRow,
  type UnitOfWork,
  type UsageTotals,
} from "@cahier/domain";
import type { PriceKind } from "@cahier/domain";
import type { Db } from "./db.js";
import * as schema from "./schema.js";

/*
 * The ports over Drizzle: the same queries against PostgreSQL under docker compose and against
 * PGlite in the tests and in the browser. They pass the contract test the in-memory adapters
 * pass, so a list means the same thing in both. Lists page by keyset: the cursor names the last
 * row's sort key and id, and the query asks for the rows after it with one row comparison, which
 * an index can walk; no offset is ever counted.
 */

type Key = { kind: "text" | "time" | "number"; expr: SQL | AnyColumn };

/** The SQL twin of `keysetPage`: a `where` for the cursor, the `orderBy`, and a `page` that cuts the rows and makes the next cursor. */
function keyset<T extends { id: string }>(key: Key, idCol: AnyColumn, direction: "asc" | "desc", query: PageQuery, keyOf: (row: T) => string | number) {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const keyExpr = key.kind === "text" ? sql`lower(${key.expr}) collate "C"` : sql`${key.expr}`;
  let where: SQL | undefined;
  if (cursor) {
    const value = key.kind === "time" ? sql`${new Date(Number(cursor.key)).toISOString()}::timestamptz` : key.kind === "number" ? sql`${Number(cursor.key)}` : sql`${String(cursor.key)}`;
    where = direction === "asc" ? sql`(${keyExpr}, ${idCol}) > (${value}, ${cursor.id})` : sql`(${keyExpr}, ${idCol}) < (${value}, ${cursor.id})`;
  }
  const order = direction === "asc" ? [asc(keyExpr), asc(idCol)] : [desc(keyExpr), desc(idCol)];
  return {
    where,
    orderBy: order,
    limit: query.limit + 1,
    page(rows: T[]): Page<T> {
      const items = rows.slice(0, query.limit);
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > query.limit && last ? encodeCursor({ key: keyOf(last), id: last.id }) : null };
    },
  };
}

const fold = (s: string) => s.toLowerCase();
const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);
const contains = (col: AnyColumn, q: string | undefined): SQL | undefined => (q ? ilike(col, `%${escapeLike(q)}%`) : undefined);
const num = (expr: SQL) => expr.mapWith(Number);

function monthRange(month: string): [Date, Date] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return [new Date(Date.UTC(y, m - 1, 1)), new Date(Date.UTC(y, m, 1))];
}

export function drizzlePortsCreator(db: Db): { ports: Ports; unitOfWork: UnitOfWork } {
  const one = async <T>(rows: Promise<T[]>): Promise<T | null> => (await rows)[0] ?? null;
  const scopeWhere = (table: typeof schema.libraries | typeof schema.agents, scope: "own" | "shared" | "all", userId: string): SQL | undefined =>
    scope === "all" ? undefined : scope === "own" ? eq(table.ownerId, userId) : eq(table.visibility, "workspace");

  const usageWhere = (workspaceId: string, month: string) => {
    const [from, to] = monthRange(month);
    return and(eq(schema.usageEvents.workspaceId, workspaceId), sql`${schema.usageEvents.occurredAt} >= ${from.toISOString()}::timestamptz`, sql`${schema.usageEvents.occurredAt} < ${to.toISOString()}::timestamptz`);
  };
  const totals = { tokens: num(sql`coalesce(sum(${schema.usageEvents.tokens}), 0)`), costMicros: num(sql`coalesce(sum(${schema.usageEvents.costMicros}), 0)`) };
  const group = (key: SQL | AnyColumn, label: SQL | AnyColumn) => ({ key: sql<string>`${key}`, label: sql<string>`${label}`, ...totals });
  const day = sql`to_char(${schema.usageEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const agentKey = sql`coalesce(${schema.usageEvents.agentId}, '')`;
  const agentLabel = sql`coalesce(${schema.agents.name}, '')`;

  const ports: Ports = {
    workspaces: {
      findById: (id) => one(db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id))),
      update: async (w) => {
        await db.update(schema.workspaces).set({ name: w.name, slug: w.slug, tools: w.tools, retentionDays: w.retentionDays }).where(eq(schema.workspaces.id, w.id));
      },
    },
    users: {
      findById: (id) => one(db.select().from(schema.users).where(eq(schema.users.id, id))),
      findByEmail: (email) => one(db.select().from(schema.users).where(eq(schema.users.email, email))),
      insert: async (u) => {
        await db.insert(schema.users).values(u);
      },
    },
    memberships: {
      findById: (id) => one(db.select().from(schema.memberships).where(eq(schema.memberships.id, id))),
      find: (workspaceId, userId) => one(db.select().from(schema.memberships).where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)))),
      listByUser: async (userId) => {
        const rows = await db
          .select({ ...getTableColumns(schema.memberships), workspace: getTableColumns(schema.workspaces) })
          .from(schema.memberships)
          .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
          .where(eq(schema.memberships.userId, userId))
          .orderBy(asc(schema.memberships.createdAt), asc(schema.memberships.id));
        return rows;
      },
      list: async (workspaceId, filter) => {
        const k = keyset<MemberRow>({ kind: "text", expr: schema.users.name }, schema.memberships.id, "asc", filter, (m) => fold(m.user.name));
        const { passwordHash: _hash, ...publicColumns } = getTableColumns(schema.users);
        const rows = await db
          .select({ ...getTableColumns(schema.memberships), user: publicColumns })
          .from(schema.memberships)
          .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
          .where(
            and(
              eq(schema.memberships.workspaceId, workspaceId),
              filter.status ? eq(schema.memberships.status, filter.status) : undefined,
              filter.role ? eq(schema.memberships.role, filter.role) : undefined,
              filter.q ? or(contains(schema.users.name, filter.q), contains(schema.users.email, filter.q)) : undefined,
              k.where,
            ),
          )
          .orderBy(...k.orderBy)
          .limit(k.limit);
        return k.page(rows);
      },
      insert: async (m) => {
        await db.insert(schema.memberships).values(m);
      },
      update: async (m) => {
        await db.update(schema.memberships).set({ role: m.role, status: m.status }).where(eq(schema.memberships.id, m.id));
      },
      countActiveAdmins: async (workspaceId) => {
        const [row] = await db.select({ n: count() }).from(schema.memberships).where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "admin"), eq(schema.memberships.status, "active")));
        return row?.n ?? 0;
      },
    },
    sessions: {
      insert: async (s) => {
        await db.insert(schema.sessions).values(s);
      },
      findById: (id) => one(db.select().from(schema.sessions).where(eq(schema.sessions.id, id))),
      findActive: (tokenHash, now) => one(db.select().from(schema.sessions).where(and(eq(schema.sessions.tokenHash, tokenHash), gt(schema.sessions.expiresAt, now)))),
      update: async (s) => {
        await db.update(schema.sessions).set({ workspaceId: s.workspaceId, expiresAt: s.expiresAt }).where(eq(schema.sessions.id, s.id));
      },
      delete: async (id) => {
        await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
      },
      deleteByUser: async (userId, workspaceId) => {
        const deleted = await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, userId), eq(schema.sessions.workspaceId, workspaceId))).returning({ id: schema.sessions.id });
        return deleted.length;
      },
    },
    invitations: {
      findById: (id) => one(db.select().from(schema.invitations).where(eq(schema.invitations.id, id))),
      findByTokenHash: (tokenHash) => one(db.select().from(schema.invitations).where(eq(schema.invitations.tokenHash, tokenHash))),
      findPending: (workspaceId, email) => one(db.select().from(schema.invitations).where(and(eq(schema.invitations.workspaceId, workspaceId), eq(schema.invitations.email, email), eq(schema.invitations.status, "sent")))),
      list: async (workspaceId, filter) => {
        const k = keyset<schema.InvitationRow>({ kind: "time", expr: schema.invitations.createdAt }, schema.invitations.id, "desc", filter, (i) => i.createdAt.getTime());
        const rows = await db
          .select()
          .from(schema.invitations)
          .where(and(eq(schema.invitations.workspaceId, workspaceId), filter.status ? eq(schema.invitations.status, filter.status) : undefined, k.where))
          .orderBy(...k.orderBy)
          .limit(k.limit);
        return k.page(rows);
      },
      insert: async (i) => {
        await db.insert(schema.invitations).values(i);
      },
      update: async (i) => {
        await db.update(schema.invitations).set({ status: i.status, acceptedUserId: i.acceptedUserId, expiresAt: i.expiresAt }).where(eq(schema.invitations.id, i.id));
      },
    },
    models: {
      list: () => db.select().from(schema.models).orderBy(asc(schema.models.id)),
      findById: (id) => one(db.select().from(schema.models).where(eq(schema.models.id, id))),
      prices: () => db.select().from(schema.modelPrices),
    },
    libraries: {
      findById: (id) => one(db.select().from(schema.libraries).where(eq(schema.libraries.id, id))),
      findBySlug: (workspaceId, slug) => one(db.select().from(schema.libraries).where(and(eq(schema.libraries.workspaceId, workspaceId), eq(schema.libraries.slug, slug)))),
      findMany: (ids) => (ids.length === 0 ? Promise.resolve([]) : db.select().from(schema.libraries).where(inArray(schema.libraries.id, [...ids])).orderBy(asc(schema.libraries.id))),
      // The SQL twin of `canReadLibrary`: same workspace, and own, shared or the admin's.
      readableIds: async (actor, ids) => {
        if (ids.length === 0) return [];
        const rows = await db
          .select({ id: schema.libraries.id })
          .from(schema.libraries)
          .where(
            and(
              inArray(schema.libraries.id, [...ids]),
              eq(schema.libraries.workspaceId, actor.workspaceId),
              actor.role === "admin" ? undefined : or(eq(schema.libraries.ownerId, actor.userId), eq(schema.libraries.visibility, "workspace")),
            ),
          )
          .orderBy(sql`${schema.libraries.id} collate "C"`);
        return rows.map((r) => r.id);
      },
      list: async (workspaceId, filter) => {
        const key: Key = filter.sort === "name" ? { kind: "text", expr: schema.libraries.name } : { kind: "time", expr: filter.sort === "newest" ? schema.libraries.createdAt : schema.libraries.updatedAt };
        const direction = filter.sort === "name" ? "asc" : "desc";
        const k = keyset<LibraryRow>(key, schema.libraries.id, direction, filter, (l) => (filter.sort === "name" ? fold(l.name) : filter.sort === "newest" ? l.createdAt.getTime() : l.updatedAt.getTime()));
        const rows = await db
          .select({
            ...getTableColumns(schema.libraries),
            ownerName: schema.users.name,
            documentCount: num(sql`(select count(*) from ${schema.documents} where ${schema.documents.libraryId} = ${schema.libraries.id})`),
            indexedCount: num(sql`(select count(*) from ${schema.documents} where ${schema.documents.libraryId} = ${schema.libraries.id} and ${schema.documents.status} = 'indexed')`),
          })
          .from(schema.libraries)
          .innerJoin(schema.users, eq(schema.users.id, schema.libraries.ownerId))
          .where(and(eq(schema.libraries.workspaceId, workspaceId), scopeWhere(schema.libraries, filter.scope, filter.userId), contains(schema.libraries.name, filter.q), k.where))
          .orderBy(...k.orderBy)
          .limit(k.limit);
        return k.page(rows);
      },
      insert: async (l) => {
        await db.insert(schema.libraries).values(l);
      },
      update: async (l) => {
        await db.update(schema.libraries).set({ name: l.name, slug: l.slug, description: l.description, visibility: l.visibility, updatedAt: l.updatedAt }).where(eq(schema.libraries.id, l.id));
      },
      delete: async (id) => {
        await db.delete(schema.libraries).where(eq(schema.libraries.id, id));
      },
    },
    documents: {
      findById: (id) => one(db.select().from(schema.documents).where(eq(schema.documents.id, id))),
      list: async (libraryId, filter) => {
        const { body: _body, ...summary } = getTableColumns(schema.documents);
        const key: Key = filter.sort === "title" ? { kind: "text", expr: schema.documents.title } : { kind: "time", expr: schema.documents.createdAt };
        const k = keyset<Omit<schema.DocumentRow, "body">>(key, schema.documents.id, filter.sort === "title" ? "asc" : "desc", filter, (d) => (filter.sort === "title" ? fold(d.title) : d.createdAt.getTime()));
        const rows = await db
          .select(summary)
          .from(schema.documents)
          .where(and(eq(schema.documents.libraryId, libraryId), filter.status ? eq(schema.documents.status, filter.status) : undefined, contains(schema.documents.title, filter.q), k.where))
          .orderBy(...k.orderBy)
          .limit(k.limit);
        return k.page(rows);
      },
      insert: async (d) => {
        await db.insert(schema.documents).values(d);
      },
      update: async (d) => {
        await db.update(schema.documents).set({ title: d.title, sourceName: d.sourceName, mime: d.mime, byteSize: d.byteSize, charCount: d.charCount, body: d.body, status: d.status, error: d.error, version: d.version, indexedAt: d.indexedAt }).where(eq(schema.documents.id, d.id));
      },
      delete: async (id) => {
        await db.delete(schema.documents).where(eq(schema.documents.id, id));
      },
    },
    chunks: {
      listByDocument: async (documentId) => {
        const { tsv: _tsv, ...columns } = getTableColumns(schema.chunks);
        return db.select(columns).from(schema.chunks).where(eq(schema.chunks.documentId, documentId)).orderBy(asc(schema.chunks.ordinal));
      },
      replaceForDocument: async (documentId, chunks) => {
        await db.delete(schema.chunks).where(eq(schema.chunks.documentId, documentId));
        if (chunks.length > 0) await db.insert(schema.chunks).values(chunks.map((c) => ({ ...c })));
      },
      search: async ({ libraryIds, question, limit }) => {
        const words = queryWords(question);
        if (libraryIds.length === 0 || limit <= 0 || words.length === 0) return [];
        const phrase = phraseOf(question);
        // Any of the words, each stemmed by the database: a question has more words than a passage needs to hold.
        const query = sql`(${sql.join(words.map((w) => sql`plainto_tsquery('english', ${w})`), sql` || `)})`;
        // The title weighted A on top of the stored vector (heading path B, body D), ranked with cover density normalised to [0, 1).
        const vector = sql`(setweight(to_tsvector('english', ${schema.documents.title}), 'A') || ${schema.chunks.tsv})`;
        const bonus = phrase ? sql`(case when ${schema.chunks.body} ilike ${`%${escapeLike(phrase)}%`} then 0.5 else 0 end)` : sql`0`;
        const score = sql`ts_rank_cd(${vector}, ${query}, 32) + ${bonus}`;
        const rows = await db
          .select({
            chunkId: schema.chunks.id,
            documentId: schema.chunks.documentId,
            documentTitle: schema.documents.title,
            documentVersion: schema.documents.version,
            ordinal: schema.chunks.ordinal,
            headingPath: schema.chunks.headingPath,
            startChar: schema.chunks.startChar,
            endChar: schema.chunks.endChar,
            tokenCount: schema.chunks.tokenCount,
            body: schema.chunks.body,
            score: num(score),
          })
          .from(schema.chunks)
          .innerJoin(schema.documents, eq(schema.documents.id, schema.chunks.documentId))
          .where(and(inArray(schema.documents.libraryId, [...libraryIds]), eq(schema.documents.status, "indexed"), sql`${vector} @@ ${query}`))
          .orderBy(desc(score), asc(schema.chunks.documentId), asc(schema.chunks.ordinal))
          .limit(limit);
        return rows satisfies RetrievedChunk[];
      },
    },
    agents: {
      findById: (id) => one(db.select().from(schema.agents).where(eq(schema.agents.id, id))),
      findBySlug: (workspaceId, slug) => one(db.select().from(schema.agents).where(and(eq(schema.agents.workspaceId, workspaceId), eq(schema.agents.slug, slug)))),
      list: async (workspaceId, filter) => {
        const key: Key = filter.sort === "name" ? { kind: "text", expr: schema.agents.name } : { kind: "time", expr: schema.agents.createdAt };
        const k = keyset<AgentRow>(key, schema.agents.id, filter.sort === "name" ? "asc" : "desc", filter, (a) => (filter.sort === "name" ? fold(a.name) : a.createdAt.getTime()));
        const current = sql`(select ${schema.agentVersions.version} from ${schema.agentVersions} where ${schema.agentVersions.id} = ${schema.agents.currentVersionId})`;
        const rows = await db
          .select({
            ...getTableColumns(schema.agents),
            ownerName: schema.users.name,
            currentVersion: sql<number | null>`${current}`.mapWith((v: unknown) => (v === null ? null : Number(v))),
            versionCount: num(sql`(select count(*) from ${schema.agentVersions} where ${schema.agentVersions.agentId} = ${schema.agents.id})`),
          })
          .from(schema.agents)
          .innerJoin(schema.users, eq(schema.users.id, schema.agents.ownerId))
          .where(and(eq(schema.agents.workspaceId, workspaceId), scopeWhere(schema.agents, filter.scope, filter.userId), contains(schema.agents.name, filter.q), k.where))
          .orderBy(...k.orderBy)
          .limit(k.limit);
        return k.page(rows);
      },
      insert: async (a) => {
        await db.insert(schema.agents).values(a);
      },
      update: async (a) => {
        await db.update(schema.agents).set({ name: a.name, slug: a.slug, visibility: a.visibility, status: a.status, currentVersionId: a.currentVersionId, archivedAt: a.archivedAt }).where(eq(schema.agents.id, a.id));
      },
    },
    agentVersions: {
      findById: (id) => one(db.select().from(schema.agentVersions).where(eq(schema.agentVersions.id, id))),
      listByAgent: (agentId) => db.select().from(schema.agentVersions).where(eq(schema.agentVersions.agentId, agentId)).orderBy(asc(schema.agentVersions.version)),
      insert: async (v) => {
        await db.insert(schema.agentVersions).values(v);
      },
      update: async (v) => {
        await db
          .update(schema.agentVersions)
          .set({ name: v.name, description: v.description, instructions: v.instructions, modelId: v.modelId, maxContextTokens: v.maxContextTokens, status: v.status, publishedAt: v.publishedAt })
          .where(eq(schema.agentVersions.id, v.id));
      },
      librariesOf: async (versionId) => {
        const rows = await db.select({ libraryId: schema.agentVersionLibraries.libraryId }).from(schema.agentVersionLibraries).where(eq(schema.agentVersionLibraries.agentVersionId, versionId)).orderBy(asc(schema.agentVersionLibraries.libraryId));
        return rows.map((r) => r.libraryId);
      },
      setLibraries: async (versionId, libraryIds) => {
        await db.delete(schema.agentVersionLibraries).where(eq(schema.agentVersionLibraries.agentVersionId, versionId));
        const unique = [...new Set(libraryIds)];
        if (unique.length > 0) await db.insert(schema.agentVersionLibraries).values(unique.map((libraryId) => ({ agentVersionId: versionId, libraryId })));
      },
    },
    shareRequests: {
      findById: (id) => one(db.select().from(schema.shareRequests).where(eq(schema.shareRequests.id, id))),
      findPending: (kind, subjectId) => one(db.select().from(schema.shareRequests).where(and(eq(schema.shareRequests.subjectKind, kind), eq(schema.shareRequests.subjectId, subjectId), eq(schema.shareRequests.status, "requested")))),
      listByRequester: (workspaceId, userId, query) => shareRows(and(eq(schema.shareRequests.workspaceId, workspaceId), eq(schema.shareRequests.requestedBy, userId)), query),
      inbox: (workspaceId, filter) => shareRows(and(eq(schema.shareRequests.workspaceId, workspaceId), filter.status ? eq(schema.shareRequests.status, filter.status) : undefined), filter),
      insert: async (r) => {
        await db.insert(schema.shareRequests).values(r);
      },
      update: async (r) => {
        await db.update(schema.shareRequests).set({ status: r.status, reason: r.reason, decidedBy: r.decidedBy, decidedAt: r.decidedAt }).where(eq(schema.shareRequests.id, r.id));
      },
    },
    conversations: {
      findById: (id) => one(db.select().from(schema.conversations).where(eq(schema.conversations.id, id))),
      list: async (workspaceId, userId, filter) => {
        const k = keyset<ConversationRow>({ kind: "time", expr: schema.conversations.lastMessageAt }, schema.conversations.id, "desc", filter, (c) => c.lastMessageAt.getTime());
        const rows = await db
          .select({ ...getTableColumns(schema.conversations), agentName: schema.agents.name })
          .from(schema.conversations)
          .innerJoin(schema.agents, eq(schema.agents.id, schema.conversations.agentId))
          .where(and(eq(schema.conversations.workspaceId, workspaceId), eq(schema.conversations.userId, userId), eq(schema.conversations.status, filter.status), contains(schema.conversations.title, filter.q), k.where))
          .orderBy(...k.orderBy)
          .limit(k.limit);
        return k.page(rows);
      },
      insert: async (c) => {
        await db.insert(schema.conversations).values(c);
      },
      update: async (c) => {
        await db
          .update(schema.conversations)
          .set({ title: c.title, status: c.status, messageCount: c.messageCount, tokenTotal: c.tokenTotal, lastMessageAt: c.lastMessageAt, archivedAt: c.archivedAt, agentVersionId: c.agentVersionId })
          .where(eq(schema.conversations.id, c.id));
      },
    },
    messages: {
      list: async (conversationId, query) => {
        const k = keyset<schema.MessageRow>({ kind: "number", expr: schema.messages.ordinal }, schema.messages.id, "asc", query, (m) => m.ordinal);
        const rows = await db
          .select()
          .from(schema.messages)
          .where(and(eq(schema.messages.conversationId, conversationId), k.where))
          .orderBy(...k.orderBy)
          .limit(k.limit);
        const page = k.page(rows);
        const ids = page.items.map((m) => m.id);
        const citations = ids.length === 0 ? [] : await db.select().from(schema.citations).where(inArray(schema.citations.messageId, ids)).orderBy(asc(schema.citations.index));
        return { items: page.items.map((m) => ({ ...m, citations: citations.filter((c) => c.messageId === m.id) })), nextCursor: page.nextCursor };
      },
      insert: async (m) => {
        await db.insert(schema.messages).values(m);
      },
      update: async (m) => {
        await db
          .update(schema.messages)
          .set({ body: m.body, status: m.status, refusedReason: m.refusedReason, modelId: m.modelId, agentVersionId: m.agentVersionId, promptTokens: m.promptTokens, contextTokens: m.contextTokens, completionTokens: m.completionTokens, completedAt: m.completedAt })
          .where(eq(schema.messages.id, m.id));
      },
      insertCitations: async (citations) => {
        if (citations.length > 0) await db.insert(schema.citations).values(citations.map((c) => ({ ...c })));
      },
    },
    usage: {
      insert: async (u) => {
        await db.insert(schema.usageEvents).values(u);
      },
      spentMicros: async (workspaceId, month) => {
        const [row] = await db.select({ costMicros: totals.costMicros }).from(schema.usageEvents).where(usageWhere(workspaceId, month));
        return row?.costMicros ?? 0;
      },
      mine: async (workspaceId, userId, month) => {
        const rows = await db
          .select({ kind: schema.usageEvents.kind, ...totals })
          .from(schema.usageEvents)
          .where(and(usageWhere(workspaceId, month), eq(schema.usageEvents.userId, userId)))
          .groupBy(schema.usageEvents.kind);
        const kinds: PriceKind[] = ["input", "cached_input", "output"];
        const byKind = Object.fromEntries(kinds.map((k) => [k, { tokens: 0, costMicros: 0 }])) as Record<PriceKind, UsageTotals>;
        for (const r of rows) byKind[r.kind] = { tokens: r.tokens, costMicros: r.costMicros };
        return { tokens: rows.reduce((n, r) => n + r.tokens, 0), costMicros: rows.reduce((n, r) => n + r.costMicros, 0), byKind };
      },
      total: async (workspaceId, month) => {
        const [row] = await db.select({ rows: count(), ...totals }).from(schema.usageEvents).where(usageWhere(workspaceId, month));
        return row ?? { rows: 0, tokens: 0, costMicros: 0 };
      },
      byModel: (workspaceId, month) =>
        db
          .select(group(schema.usageEvents.modelId, schema.models.name))
          .from(schema.usageEvents)
          .innerJoin(schema.models, eq(schema.models.id, schema.usageEvents.modelId))
          .where(usageWhere(workspaceId, month))
          .groupBy(schema.usageEvents.modelId, schema.models.name)
          .orderBy(asc(schema.usageEvents.modelId)),
      byMember: (workspaceId, month) =>
        db
          .select(group(schema.usageEvents.userId, schema.users.name))
          .from(schema.usageEvents)
          .innerJoin(schema.users, eq(schema.users.id, schema.usageEvents.userId))
          .where(usageWhere(workspaceId, month))
          .groupBy(schema.usageEvents.userId, schema.users.name)
          .orderBy(asc(schema.usageEvents.userId)),
      byAgent: (workspaceId, month) =>
        db
          .select(group(agentKey, agentLabel))
          .from(schema.usageEvents)
          .leftJoin(schema.agents, eq(schema.agents.id, schema.usageEvents.agentId))
          .where(usageWhere(workspaceId, month))
          .groupBy(agentKey, agentLabel)
          .orderBy(asc(agentKey)),
      byDay: (workspaceId, month) => db.select(group(day, day)).from(schema.usageEvents).where(usageWhere(workspaceId, month)).groupBy(day).orderBy(asc(day)),
    },
    budgets: {
      find: (workspaceId, month) => one(db.select().from(schema.budgets).where(and(eq(schema.budgets.workspaceId, workspaceId), eq(schema.budgets.month, month)))),
      list: (workspaceId) => db.select().from(schema.budgets).where(eq(schema.budgets.workspaceId, workspaceId)).orderBy(desc(schema.budgets.month)),
      insert: async (b) => {
        await db.insert(schema.budgets).values(b);
      },
      update: async (b) => {
        await db.update(schema.budgets).set({ limitMicros: b.limitMicros, status: b.status, setBy: b.setBy }).where(eq(schema.budgets.id, b.id));
      },
    },
    schedules: {
      findById: (id) => one(db.select().from(schema.scheduledPrompts).where(eq(schema.scheduledPrompts.id, id))),
      list: async (workspaceId, userId, query) => {
        const k = keyset<schema.ScheduledPromptRow & { agentName: string }>({ kind: "time", expr: schema.scheduledPrompts.createdAt }, schema.scheduledPrompts.id, "desc", query, (s) => s.createdAt.getTime());
        const rows = await db
          .select({ ...getTableColumns(schema.scheduledPrompts), agentName: schema.agents.name })
          .from(schema.scheduledPrompts)
          .innerJoin(schema.agents, eq(schema.agents.id, schema.scheduledPrompts.agentId))
          .where(and(eq(schema.scheduledPrompts.workspaceId, workspaceId), eq(schema.scheduledPrompts.userId, userId), k.where))
          .orderBy(...k.orderBy)
          .limit(k.limit);
        return k.page(rows);
      },
      insert: async (s) => {
        await db.insert(schema.scheduledPrompts).values(s);
      },
      update: async (s) => {
        await db
          .update(schema.scheduledPrompts)
          .set({ name: s.name, prompt: s.prompt, cadence: s.cadence, atMinute: s.atMinute, weekday: s.weekday, dayOfMonth: s.dayOfMonth, timezone: s.timezone, nextRunAt: s.nextRunAt, status: s.status, lastRunAt: s.lastRunAt })
          .where(eq(schema.scheduledPrompts.id, s.id));
      },
      runs: (scheduleId) => db.select().from(schema.scheduledRuns).where(eq(schema.scheduledRuns.scheduledPromptId, scheduleId)).orderBy(desc(schema.scheduledRuns.scheduledFor), desc(schema.scheduledRuns.id)),
    },
    audit: {
      insert: async (e) => {
        await db.insert(schema.auditLog).values(e);
      },
      list: async (workspaceId, filter) => {
        const k = keyset<AuditRow>({ kind: "time", expr: schema.auditLog.at }, schema.auditLog.id, "desc", filter, (e) => e.at.getTime());
        const rows = await db
          .select({ ...getTableColumns(schema.auditLog), actorName: schema.users.name })
          .from(schema.auditLog)
          .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorId))
          .where(
            and(
              eq(schema.auditLog.workspaceId, workspaceId),
              filter.entityKind ? eq(schema.auditLog.entityKind, filter.entityKind) : undefined,
              filter.entityId ? eq(schema.auditLog.entityId, filter.entityId) : undefined,
              filter.actorId ? eq(schema.auditLog.actorId, filter.actorId) : undefined,
              filter.action ? eq(schema.auditLog.action, filter.action) : undefined,
              k.where,
            ),
          )
          .orderBy(...k.orderBy)
          .limit(k.limit);
        return k.page(rows);
      },
    },
  };

  async function shareRows(where: SQL | undefined, query: PageQuery): Promise<Page<ShareRow>> {
    const k = keyset<ShareRow>({ kind: "time", expr: schema.shareRequests.createdAt }, schema.shareRequests.id, "desc", query, (r) => r.createdAt.getTime());
    const rows = await db
      .select({
        ...getTableColumns(schema.shareRequests),
        subjectName: sql<string>`coalesce(${schema.libraries.name}, ${schema.agents.name}, '')`,
        requesterName: schema.users.name,
      })
      .from(schema.shareRequests)
      .innerJoin(schema.users, eq(schema.users.id, schema.shareRequests.requestedBy))
      .leftJoin(schema.libraries, and(eq(schema.shareRequests.subjectKind, "library"), eq(schema.libraries.id, schema.shareRequests.subjectId)))
      .leftJoin(schema.agents, and(eq(schema.shareRequests.subjectKind, "agent"), eq(schema.agents.id, schema.shareRequests.subjectId)))
      .where(and(where, k.where))
      .orderBy(...k.orderBy)
      .limit(k.limit);
    return k.page(rows);
  }

  const unitOfWork: UnitOfWork = {
    run: (work) => db.transaction((tx) => work(drizzlePortsCreator(tx as unknown as Db).ports)),
  };

  return { ports, unitOfWork };
}
