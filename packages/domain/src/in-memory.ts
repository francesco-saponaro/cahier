import { keysetPage, type Page, type PageQuery } from "./cursor.js";
import type {
  Agent,
  AgentVersion,
  AuditEntry,
  Budget,
  Chunk,
  Citation,
  Conversation,
  Document,
  Invitation,
  Library,
  Membership,
  Message,
  Model,
  ModelPriceRow,
  PublicUser,
  ScheduledPrompt,
  ScheduledRun,
  Session,
  ShareRequest,
  UsageEvent,
  User,
  Workspace,
} from "./entities.js";
import type { PriceKind } from "./money.js";
import type { Ports, UnitOfWork, UsageGroup, UsageTotals } from "./ports.js";
import type { RetrievedChunk } from "./grounding/pack.js";
import { phraseOf, queryTerms, stem } from "./grounding/terms.js";
import { tokenize } from "./text/tokens.js";
import { canReadLibrary } from "./access.js";

/*
 * The ports over arrays. The default adapter in a use-case test, and what the app's component
 * tests use: no database, no I/O. It follows the same contract test as the Drizzle adapters, so
 * what a filter, a sort, a page or a sum means is the same in both.
 */

export interface MemoryStore {
  workspaces: Workspace[];
  users: User[];
  memberships: Membership[];
  sessions: Session[];
  invitations: Invitation[];
  models: Model[];
  modelPrices: ModelPriceRow[];
  libraries: Library[];
  documents: Document[];
  chunks: Chunk[];
  agents: Agent[];
  agentVersions: AgentVersion[];
  agentVersionLibraries: { agentVersionId: string; libraryId: string }[];
  shareRequests: ShareRequest[];
  conversations: Conversation[];
  messages: Message[];
  citations: Citation[];
  usageEvents: UsageEvent[];
  budgets: Budget[];
  scheduledPrompts: ScheduledPrompt[];
  scheduledRuns: ScheduledRun[];
  auditLog: AuditEntry[];
}

export function emptyStore(): MemoryStore {
  return {
    workspaces: [], users: [], memberships: [], sessions: [], invitations: [], models: [], modelPrices: [], libraries: [], documents: [], chunks: [],
    agents: [], agentVersions: [], agentVersionLibraries: [], shareRequests: [], conversations: [], messages: [], citations: [], usageEvents: [],
    budgets: [], scheduledPrompts: [], scheduledRuns: [], auditLog: [],
  };
}

export function publicUser(user: User): PublicUser {
  const { passwordHash: _hash, ...rest } = user;
  return rest;
}

/** ASCII case folding, the same thing `lower()` does to the text these filters match. */
const fold = (s: string) => s.toLowerCase();
const has = (text: string, q: string | undefined) => q === undefined || q === "" || fold(text).includes(fold(q));
const monthOf = (d: Date) => d.toISOString().slice(0, 7);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

function replaceById<T extends { id: string }>(items: T[], item: T): void {
  const i = items.findIndex((x) => x.id === item.id);
  if (i === -1) throw new Error(`no row ${item.id} to update`);
  items[i] = { ...item };
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function groupUsage(rows: UsageEvent[], key: (u: UsageEvent) => string, label: (key: string) => string): UsageGroup[] {
  const groups = new Map<string, UsageTotals>();
  for (const u of rows) {
    const k = key(u);
    const g = groups.get(k) ?? { tokens: 0, costMicros: 0 };
    groups.set(k, { tokens: g.tokens + u.tokens, costMicros: g.costMicros + u.costMicros });
  }
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, t]) => ({ key: k, label: label(k), ...t }));
}

export function inMemoryPortsCreator(store: MemoryStore = emptyStore()): { ports: Ports; unitOfWork: UnitOfWork; store: MemoryStore } {
  const userName = (id: string | null) => (id === null ? null : (store.users.find((u) => u.id === id)?.name ?? null));
  const libraryVisible = (userId: string, scope: "own" | "shared" | "all") => (l: { ownerId: string; visibility: string }) =>
    scope === "all" ? true : scope === "own" ? l.ownerId === userId : l.visibility === "workspace";
  const monthRows = (workspaceId: string, month: string) => store.usageEvents.filter((u) => u.workspaceId === workspaceId && monthOf(u.occurredAt) === month);
  const sum = (rows: UsageEvent[]): UsageTotals => rows.reduce((t, u) => ({ tokens: t.tokens + u.tokens, costMicros: t.costMicros + u.costMicros }), { tokens: 0, costMicros: 0 });

  const ports: Ports = {
    workspaces: {
      findById: async (id) => store.workspaces.find((w) => w.id === id) ?? null,
      update: async (w) => replaceById(store.workspaces, w),
    },
    users: {
      findById: async (id) => store.users.find((u) => u.id === id) ?? null,
      findByEmail: async (email) => store.users.find((u) => u.email === email) ?? null,
      insert: async (u) => {
        store.users.push({ ...u });
      },
    },
    memberships: {
      findById: async (id) => store.memberships.find((m) => m.id === id) ?? null,
      find: async (workspaceId, userId) => store.memberships.find((m) => m.workspaceId === workspaceId && m.userId === userId) ?? null,
      listByUser: async (userId) =>
        store.memberships
          .filter((m) => m.userId === userId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || byId(a, b))
          .map((m) => ({ ...m, workspace: store.workspaces.find((w) => w.id === m.workspaceId)! })),
      list: async (workspaceId, filter) => {
        const rows = store.memberships
          .filter((m) => m.workspaceId === workspaceId && (!filter.status || m.status === filter.status) && (!filter.role || m.role === filter.role))
          .map((m) => ({ ...m, user: publicUser(store.users.find((u) => u.id === m.userId)!) }))
          .filter((m) => has(m.user.name, filter.q) || has(m.user.email, filter.q));
        return keysetPage(rows, { key: (m) => fold(m.user.name), direction: "asc" }, filter);
      },
      insert: async (m) => {
        store.memberships.push({ ...m });
      },
      update: async (m) => replaceById(store.memberships, m),
      countActiveAdmins: async (workspaceId) => store.memberships.filter((m) => m.workspaceId === workspaceId && m.role === "admin" && m.status === "active").length,
    },
    sessions: {
      insert: async (s) => {
        store.sessions.push({ ...s });
      },
      findById: async (id) => store.sessions.find((s) => s.id === id) ?? null,
      findActive: async (tokenHash, now) => store.sessions.find((s) => s.tokenHash === tokenHash && s.expiresAt.getTime() > now.getTime()) ?? null,
      update: async (s) => replaceById(store.sessions, s),
      delete: async (id) => {
        store.sessions = store.sessions.filter((s) => s.id !== id);
      },
      deleteByUser: async (userId, workspaceId) => {
        const before = store.sessions.length;
        store.sessions = store.sessions.filter((s) => !(s.userId === userId && s.workspaceId === workspaceId));
        return before - store.sessions.length;
      },
    },
    invitations: {
      findById: async (id) => store.invitations.find((i) => i.id === id) ?? null,
      findByTokenHash: async (tokenHash) => store.invitations.find((i) => i.tokenHash === tokenHash) ?? null,
      findPending: async (workspaceId, email) => store.invitations.find((i) => i.workspaceId === workspaceId && i.email === email && i.status === "sent") ?? null,
      list: async (workspaceId, filter) =>
        keysetPage(
          store.invitations.filter((i) => i.workspaceId === workspaceId && (!filter.status || i.status === filter.status)),
          { key: (i) => i.createdAt.getTime(), direction: "desc" },
          filter,
        ),
      insert: async (i) => {
        store.invitations.push({ ...i });
      },
      update: async (i) => replaceById(store.invitations, i),
    },
    models: {
      list: async () => [...store.models].sort(byId),
      findById: async (id) => store.models.find((m) => m.id === id) ?? null,
      prices: async () => [...store.modelPrices],
    },
    libraries: {
      findById: async (id) => store.libraries.find((l) => l.id === id) ?? null,
      findBySlug: async (workspaceId, slug) => store.libraries.find((l) => l.workspaceId === workspaceId && l.slug === slug) ?? null,
      findMany: async (ids) => store.libraries.filter((l) => ids.includes(l.id)).sort(byId),
      readableIds: async (actor, ids) =>
        store.libraries
          .filter((l) => ids.includes(l.id) && canReadLibrary(actor, l))
          .map((l) => l.id)
          .sort(),
      list: async (workspaceId, filter) => {
        const rows = store.libraries
          .filter((l) => l.workspaceId === workspaceId && libraryVisible(filter.userId, filter.scope)(l) && has(l.name, filter.q))
          .map((l) => {
            const docs = store.documents.filter((d) => d.libraryId === l.id);
            return { ...l, ownerName: userName(l.ownerId) ?? "", documentCount: docs.length, indexedCount: docs.filter((d) => d.status === "indexed").length };
          });
        const order = filter.sort === "name" ? { key: (l: Library) => fold(l.name), direction: "asc" as const } : filter.sort === "newest" ? { key: (l: Library) => l.createdAt.getTime(), direction: "desc" as const } : { key: (l: Library) => l.updatedAt.getTime(), direction: "desc" as const };
        return keysetPage(rows, order, filter);
      },
      insert: async (l) => {
        store.libraries.push({ ...l });
      },
      update: async (l) => replaceById(store.libraries, l),
      delete: async (id) => {
        for (const d of store.documents.filter((d) => d.libraryId === id)) await ports.documents.delete(d.id);
        store.libraries = store.libraries.filter((l) => l.id !== id);
        store.agentVersionLibraries = store.agentVersionLibraries.filter((x) => x.libraryId !== id);
      },
    },
    documents: {
      findById: async (id) => store.documents.find((d) => d.id === id) ?? null,
      list: async (libraryId, filter) => {
        const rows = store.documents
          .filter((d) => d.libraryId === libraryId && (!filter.status || d.status === filter.status) && has(d.title, filter.q))
          .map(({ body: _body, ...rest }) => rest);
        const order = filter.sort === "title" ? { key: (d: { title: string }) => fold(d.title), direction: "asc" as const } : { key: (d: { createdAt: Date }) => d.createdAt.getTime(), direction: "desc" as const };
        return keysetPage(rows, order, filter);
      },
      insert: async (d) => {
        store.documents.push({ ...d });
      },
      update: async (d) => replaceById(store.documents, d),
      delete: async (id) => {
        store.chunks = store.chunks.filter((c) => c.documentId !== id);
        store.documents = store.documents.filter((d) => d.id !== id);
        for (const c of store.citations) if (c.documentId === id) Object.assign(c, { documentId: null, chunkId: null });
      },
    },
    chunks: {
      listByDocument: async (documentId) => store.chunks.filter((c) => c.documentId === documentId).sort((a, b) => a.ordinal - b.ordinal),
      replaceForDocument: async (documentId, chunks) => {
        const gone = new Set(store.chunks.filter((c) => c.documentId === documentId).map((c) => c.id));
        store.chunks = [...store.chunks.filter((c) => c.documentId !== documentId), ...chunks.map((c) => ({ ...c }))];
        // What the database's `on delete set null` does: the citation keeps its quote, not its chunk.
        for (const c of store.citations) if (c.chunkId !== null && gone.has(c.chunkId)) c.chunkId = null;
      },
      search: async ({ libraryIds, question, limit }) => {
        const terms = queryTerms(question);
        if (terms.length === 0 || libraryIds.length === 0 || limit <= 0) return [];
        const phrase = phraseOf(question)?.toLowerCase() ?? null;
        const documents = new Map(store.documents.filter((d) => libraryIds.includes(d.libraryId) && d.status === "indexed").map((d) => [d.id, d]));
        const stems = (text: string) => new Set(tokenize(text).filter((p) => /^[\p{L}\p{N}]/u.test(p)).map((w) => stem(w)));
        const hits: RetrievedChunk[] = [];
        for (const c of store.chunks) {
          const d = documents.get(c.documentId);
          if (!d) continue;
          // The weights of the search vector: the title A, the heading path B, the body D.
          const weighted: [Set<string>, number][] = [[stems(d.title), 1], [stems(c.headingText), 0.4], [stems(c.body), 0.1]];
          let score = 0;
          for (const t of terms) {
            const best = weighted.find(([s]) => s.has(t));
            if (best) score += best[1];
          }
          if (score === 0) continue;
          score = score / (score + 1) + (phrase && c.body.toLowerCase().includes(phrase) ? 0.5 : 0);
          hits.push({ chunkId: c.id, documentId: c.documentId, documentTitle: d.title, documentVersion: d.version, ordinal: c.ordinal, headingPath: c.headingPath, startChar: c.startChar, endChar: c.endChar, tokenCount: c.tokenCount, body: c.body, score });
        }
        return hits.sort((a, b) => b.score - a.score || (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0) || a.ordinal - b.ordinal).slice(0, limit);
      },
    },
    agents: {
      findById: async (id) => store.agents.find((a) => a.id === id) ?? null,
      findBySlug: async (workspaceId, slug) => store.agents.find((a) => a.workspaceId === workspaceId && a.slug === slug) ?? null,
      list: async (workspaceId, filter) => {
        const rows = store.agents
          .filter((a) => a.workspaceId === workspaceId && libraryVisible(filter.userId, filter.scope)(a) && has(a.name, filter.q))
          .map((a) => {
            const versions = store.agentVersions.filter((v) => v.agentId === a.id);
            return { ...a, ownerName: userName(a.ownerId) ?? "", currentVersion: versions.find((v) => v.id === a.currentVersionId)?.version ?? null, versionCount: versions.length };
          });
        const order = filter.sort === "name" ? { key: (a: Agent) => fold(a.name), direction: "asc" as const } : { key: (a: Agent) => a.createdAt.getTime(), direction: "desc" as const };
        return keysetPage(rows, order, filter);
      },
      insert: async (a) => {
        store.agents.push({ ...a });
      },
      update: async (a) => replaceById(store.agents, a),
    },
    agentVersions: {
      findById: async (id) => store.agentVersions.find((v) => v.id === id) ?? null,
      listByAgent: async (agentId) => store.agentVersions.filter((v) => v.agentId === agentId).sort((a, b) => a.version - b.version),
      insert: async (v) => {
        store.agentVersions.push({ ...v });
      },
      update: async (v) => replaceById(store.agentVersions, v),
      librariesOf: async (versionId) => store.agentVersionLibraries.filter((x) => x.agentVersionId === versionId).map((x) => x.libraryId).sort(),
      setLibraries: async (versionId, libraryIds) => {
        store.agentVersionLibraries = store.agentVersionLibraries.filter((x) => x.agentVersionId !== versionId);
        for (const libraryId of new Set(libraryIds)) store.agentVersionLibraries.push({ agentVersionId: versionId, libraryId });
      },
    },
    shareRequests: {
      findById: async (id) => store.shareRequests.find((r) => r.id === id) ?? null,
      findPending: async (kind, subjectId) => store.shareRequests.find((r) => r.subjectKind === kind && r.subjectId === subjectId && r.status === "requested") ?? null,
      listByRequester: async (workspaceId, userId, query) => shareRows(store.shareRequests.filter((r) => r.workspaceId === workspaceId && r.requestedBy === userId), query),
      inbox: async (workspaceId, filter) => shareRows(store.shareRequests.filter((r) => r.workspaceId === workspaceId && (!filter.status || r.status === filter.status)), filter),
      insert: async (r) => {
        store.shareRequests.push({ ...r });
      },
      update: async (r) => replaceById(store.shareRequests, r),
    },
    conversations: {
      findById: async (id) => store.conversations.find((c) => c.id === id) ?? null,
      list: async (workspaceId, userId, filter) => {
        const rows = store.conversations
          .filter((c) => c.workspaceId === workspaceId && c.userId === userId && c.status === filter.status && has(c.title, filter.q))
          .map((c) => ({ ...c, agentName: store.agents.find((a) => a.id === c.agentId)?.name ?? "" }));
        return keysetPage(rows, { key: (c) => c.lastMessageAt.getTime(), direction: "desc" }, filter);
      },
      insert: async (c) => {
        store.conversations.push({ ...c });
      },
      update: async (c) => replaceById(store.conversations, c),
    },
    messages: {
      list: async (conversationId, query) => {
        const rows = store.messages
          .filter((m) => m.conversationId === conversationId)
          .map((m) => ({ ...m, citations: store.citations.filter((c) => c.messageId === m.id).sort((a, b) => a.index - b.index).map((c) => ({ ...c })) }));
        return keysetPage(rows, { key: (m) => m.ordinal, direction: "asc" }, query);
      },
      insert: async (m) => {
        store.messages.push({ ...m });
      },
      update: async (m) => replaceById(store.messages, m),
      insertCitations: async (citations) => {
        store.citations.push(...citations.map((c) => ({ ...c })));
      },
    },
    usage: {
      insert: async (u) => {
        store.usageEvents.push({ ...u });
      },
      spentMicros: async (workspaceId, month) => sum(monthRows(workspaceId, month)).costMicros,
      mine: async (workspaceId, userId, month) => {
        const rows = monthRows(workspaceId, month).filter((u) => u.userId === userId);
        const kinds: PriceKind[] = ["input", "cached_input", "output"];
        const byKind = Object.fromEntries(kinds.map((k) => [k, sum(rows.filter((u) => u.kind === k))])) as Record<PriceKind, UsageTotals>;
        return { ...sum(rows), byKind };
      },
      total: async (workspaceId, month) => {
        const rows = monthRows(workspaceId, month);
        return { rows: rows.length, ...sum(rows) };
      },
      byModel: async (workspaceId, month) => groupUsage(monthRows(workspaceId, month), (u) => u.modelId, (k) => store.models.find((m) => m.id === k)?.name ?? k),
      byMember: async (workspaceId, month) => groupUsage(monthRows(workspaceId, month), (u) => u.userId, (k) => userName(k) ?? k),
      byAgent: async (workspaceId, month) => groupUsage(monthRows(workspaceId, month), (u) => u.agentId ?? "", (k) => (k === "" ? "" : (store.agents.find((a) => a.id === k)?.name ?? k))),
      byDay: async (workspaceId, month) => groupUsage(monthRows(workspaceId, month), (u) => dayOf(u.occurredAt), (k) => k),
    },
    budgets: {
      find: async (workspaceId, month) => store.budgets.find((b) => b.workspaceId === workspaceId && b.month === month) ?? null,
      list: async (workspaceId) => store.budgets.filter((b) => b.workspaceId === workspaceId).sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0)),
      insert: async (b) => {
        store.budgets.push({ ...b });
      },
      update: async (b) => replaceById(store.budgets, b),
    },
    schedules: {
      findById: async (id) => store.scheduledPrompts.find((s) => s.id === id) ?? null,
      list: async (workspaceId, userId, query) => {
        const rows = store.scheduledPrompts
          .filter((s) => s.workspaceId === workspaceId && s.userId === userId)
          .map((s) => ({ ...s, agentName: store.agents.find((a) => a.id === s.agentId)?.name ?? "" }));
        return keysetPage(rows, { key: (s) => s.createdAt.getTime(), direction: "desc" }, query);
      },
      insert: async (s) => {
        store.scheduledPrompts.push({ ...s });
      },
      update: async (s) => replaceById(store.scheduledPrompts, s),
      runs: async (scheduleId) => store.scheduledRuns.filter((r) => r.scheduledPromptId === scheduleId).sort((a, b) => b.scheduledFor.getTime() - a.scheduledFor.getTime() || -byId(a, b)),
    },
    audit: {
      insert: async (e) => {
        store.auditLog.push({ ...e });
      },
      list: async (workspaceId, filter) => {
        const rows = store.auditLog
          .filter(
            (e) =>
              e.workspaceId === workspaceId &&
              (!filter.entityKind || e.entityKind === filter.entityKind) &&
              (!filter.entityId || e.entityId === filter.entityId) &&
              (!filter.actorId || e.actorId === filter.actorId) &&
              (!filter.action || e.action === filter.action),
          )
          .map((e) => ({ ...e, actorName: userName(e.actorId) }));
        return keysetPage(rows, { key: (e) => e.at.getTime(), direction: "desc" }, filter);
      },
    },
  };

  function shareRows(rows: ShareRequest[], query: PageQuery): Page<ShareRequest & { subjectName: string; requesterName: string }> {
    const named = rows.map((r) => ({
      ...r,
      subjectName: (r.subjectKind === "library" ? store.libraries.find((l) => l.id === r.subjectId)?.name : store.agents.find((a) => a.id === r.subjectId)?.name) ?? "",
      requesterName: userName(r.requestedBy) ?? "",
    }));
    return keysetPage(named, { key: (r) => r.createdAt.getTime(), direction: "desc" }, query);
  }

  // A unit of work over arrays: a copy of the store before, put back if the work throws.
  const unitOfWork: UnitOfWork = {
    async run(work) {
      const snapshot = structuredClone(store);
      try {
        return await work(ports);
      } catch (e) {
        Object.assign(store, snapshot);
        throw e;
      }
    },
  };

  return { ports, unitOfWork, store };
}
