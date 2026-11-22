import type { Page, PageQuery } from "./cursor.js";
import type {
  Actor,
  Agent,
  AgentVersion,
  AuditEntry,
  Budget,
  Chunk,
  Citation,
  Conversation,
  ConversationStatus,
  Document,
  DocumentStatus,
  Invitation,
  InvitationStatus,
  Library,
  Membership,
  MembershipStatus,
  Message,
  Model,
  ModelPriceRow,
  PublicUser,
  Role,
  ScheduledPrompt,
  ScheduledRun,
  Session,
  ShareRequest,
  ShareStatus,
  ShareSubjectKind,
  UsageEvent,
  User,
  Workspace,
} from "./entities.js";
import type { PriceKind } from "./money.js";
import type { RetrievedChunk } from "./grounding/pack.js";
import type { Answerer } from "./grounding/compose.js";
import type { RateLimiter } from "./grounding/rate.js";

/*
 * The ports: what the use cases need from the outside world, as interfaces. `packages/db`
 * implements them over Drizzle (node-postgres on the server, PGlite in tests and in the browser);
 * `inMemoryPortsCreator` implements them over arrays for the use-case tests and the app's
 * component tests. A use case never sees which one it has. Every list that can grow takes a
 * cursor and answers a page; `test/port-contract.ts` is the behaviour both adapters must share.
 */

export interface WorkspaceRepository {
  findById(id: string): Promise<Workspace | null>;
  update(workspace: Workspace): Promise<void>;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  insert(user: User): Promise<void>;
}

export interface MemberFilter extends PageQuery {
  status?: MembershipStatus | undefined;
  role?: Role | undefined;
  /** Matches the user's name or email, case-insensitively. */
  q?: string | undefined;
}

export type MemberRow = Membership & { user: PublicUser };

export interface MembershipRepository {
  findById(id: string): Promise<Membership | null>;
  find(workspaceId: string, userId: string): Promise<Membership | null>;
  /** Every membership of the user with its workspace, oldest first: what the workspace switcher shows. */
  listByUser(userId: string): Promise<(Membership & { workspace: Workspace })[]>;
  /** The workspace's members by the user's name. */
  list(workspaceId: string, filter: MemberFilter): Promise<Page<MemberRow>>;
  insert(membership: Membership): Promise<void>;
  update(membership: Membership): Promise<void>;
  countActiveAdmins(workspaceId: string): Promise<number>;
}

export interface SessionRepository {
  insert(session: Session): Promise<void>;
  findById(id: string): Promise<Session | null>;
  /** The session behind the token's hash when it has not expired at `now`. */
  findActive(tokenHash: string, now: Date): Promise<Session | null>;
  update(session: Session): Promise<void>;
  delete(id: string): Promise<void>;
  /** Ends every session the user has in the workspace; answers how many. */
  deleteByUser(userId: string, workspaceId: string): Promise<number>;
}

export interface InvitationFilter extends PageQuery {
  status?: InvitationStatus | undefined;
}

export interface InvitationRepository {
  findById(id: string): Promise<Invitation | null>;
  findByTokenHash(tokenHash: string): Promise<Invitation | null>;
  /** The `sent` invitation for the email in the workspace, if any. */
  findPending(workspaceId: string, email: string): Promise<Invitation | null>;
  /** Newest first. */
  list(workspaceId: string, filter: InvitationFilter): Promise<Page<Invitation>>;
  insert(invitation: Invitation): Promise<void>;
  update(invitation: Invitation): Promise<void>;
}

export interface ModelRepository {
  /** By id. */
  list(): Promise<Model[]>;
  findById(id: string): Promise<Model | null>;
  /** Every price row, in force or not; `priceInForce` picks. */
  prices(): Promise<ModelPriceRow[]>;
}

/** `own`: the user's; `shared`: visible to the workspace; `all`: everything in the workspace (admins). */
export type Scope = "own" | "shared" | "all";
export type LibrarySort = "name" | "newest" | "updated";

export interface LibraryFilter extends PageQuery {
  scope: Scope;
  userId: string;
  q?: string | undefined;
  sort: LibrarySort;
}

export type LibraryRow = Library & { ownerName: string; documentCount: number; indexedCount: number };

export interface LibraryRepository {
  findById(id: string): Promise<Library | null>;
  findBySlug(workspaceId: string, slug: string): Promise<Library | null>;
  /** The libraries with these ids, by id; missing ids are skipped. */
  findMany(ids: readonly string[]): Promise<Library[]>;
  /** The subset of `ids` the actor may read, by id: the SQL twin of `canReadLibrary`, so the retrieval filter runs in the database. */
  readableIds(actor: Actor, ids: readonly string[]): Promise<string[]>;
  list(workspaceId: string, filter: LibraryFilter): Promise<Page<LibraryRow>>;
  insert(library: Library): Promise<void>;
  update(library: Library): Promise<void>;
  /** Removes the library with its documents and chunks; citations keep their quotes. */
  delete(id: string): Promise<void>;
}

export type DocumentSort = "newest" | "title";

export interface DocumentFilter extends PageQuery {
  status?: DocumentStatus | undefined;
  q?: string | undefined;
  sort: DocumentSort;
}

/** A document as a list shows it: everything but the text. */
export type DocumentSummary = Omit<Document, "body">;

export interface DocumentRepository {
  findById(id: string): Promise<Document | null>;
  list(libraryId: string, filter: DocumentFilter): Promise<Page<DocumentSummary>>;
  insert(document: Document): Promise<void>;
  update(document: Document): Promise<void>;
  /** Removes the document with its chunks; citations keep their quotes. */
  delete(id: string): Promise<void>;
}

export interface ChunkSearch {
  libraryIds: readonly string[];
  question: string;
  limit: number;
}

export interface ChunkRepository {
  /** By ordinal. */
  listByDocument(documentId: string): Promise<Chunk[]>;
  /** The document's chunks become exactly these. */
  replaceForDocument(documentId: string, chunks: readonly Chunk[]): Promise<void>;
  /**
   * Full-text search over the indexed documents of the libraries: the chunks matching the question,
   * best first, ties by (documentId, ordinal), at most `limit`. The document's title counts most,
   * the heading path next, the body last; a chunk holding the question's phrase verbatim scores a
   * bonus. A question of stop words only matches nothing.
   */
  search(query: ChunkSearch): Promise<RetrievedChunk[]>;
}

export type AgentSort = "name" | "newest";

export interface AgentFilter extends PageQuery {
  scope: Scope;
  userId: string;
  q?: string | undefined;
  sort: AgentSort;
}

export type AgentRow = Agent & { ownerName: string; currentVersion: number | null; versionCount: number };

export interface AgentRepository {
  findById(id: string): Promise<Agent | null>;
  findBySlug(workspaceId: string, slug: string): Promise<Agent | null>;
  list(workspaceId: string, filter: AgentFilter): Promise<Page<AgentRow>>;
  insert(agent: Agent): Promise<void>;
  update(agent: Agent): Promise<void>;
}

export interface AgentVersionRepository {
  findById(id: string): Promise<AgentVersion | null>;
  /** By version number. */
  listByAgent(agentId: string): Promise<AgentVersion[]>;
  insert(version: AgentVersion): Promise<void>;
  update(version: AgentVersion): Promise<void>;
  /** The ids of the libraries the version may read, by id. */
  librariesOf(versionId: string): Promise<string[]>;
  setLibraries(versionId: string, libraryIds: readonly string[]): Promise<void>;
}

export interface ShareFilter extends PageQuery {
  status?: ShareStatus | undefined;
}

export type ShareRow = ShareRequest & { subjectName: string; requesterName: string };

export interface ShareRequestRepository {
  findById(id: string): Promise<ShareRequest | null>;
  /** The one `requested` request for the subject, if any. */
  findPending(kind: ShareSubjectKind, subjectId: string): Promise<ShareRequest | null>;
  /** Newest first. */
  listByRequester(workspaceId: string, userId: string, query: PageQuery): Promise<Page<ShareRow>>;
  /** Newest first. */
  inbox(workspaceId: string, filter: ShareFilter): Promise<Page<ShareRow>>;
  insert(request: ShareRequest): Promise<void>;
  update(request: ShareRequest): Promise<void>;
}

export interface ConversationFilter extends PageQuery {
  status: ConversationStatus;
  /** Matches the title, case-insensitively. */
  q?: string | undefined;
}

export type ConversationRow = Conversation & { agentName: string };

export interface ConversationRepository {
  findById(id: string): Promise<Conversation | null>;
  /** The member's own, latest message first. */
  list(workspaceId: string, userId: string, filter: ConversationFilter): Promise<Page<ConversationRow>>;
  insert(conversation: Conversation): Promise<void>;
  update(conversation: Conversation): Promise<void>;
}

export type MessageWithCitations = Message & { citations: Citation[] };

export interface MessageRepository {
  /** By ordinal, with each message's citations by index. */
  list(conversationId: string, query: PageQuery): Promise<Page<MessageWithCitations>>;
  insert(message: Message): Promise<void>;
  update(message: Message): Promise<void>;
  insertCitations(citations: readonly Citation[]): Promise<void>;
}

export interface UsageTotals {
  tokens: number;
  costMicros: number;
}

export interface UsageGroup extends UsageTotals {
  key: string;
  label: string;
}

export interface UsageRepository {
  insert(event: UsageEvent): Promise<void>;
  /** The month's cost in micro-dollars, every row together. */
  spentMicros(workspaceId: string, month: string): Promise<number>;
  mine(workspaceId: string, userId: string, month: string): Promise<UsageTotals & { byKind: Record<PriceKind, UsageTotals> }>;
  total(workspaceId: string, month: string): Promise<UsageTotals & { rows: number }>;
  /** Each group by key; the label is the model's name, the member's name, the agent's name (empty for none), the day. */
  byModel(workspaceId: string, month: string): Promise<UsageGroup[]>;
  byMember(workspaceId: string, month: string): Promise<UsageGroup[]>;
  byAgent(workspaceId: string, month: string): Promise<UsageGroup[]>;
  byDay(workspaceId: string, month: string): Promise<UsageGroup[]>;
}

export interface BudgetRepository {
  find(workspaceId: string, month: string): Promise<Budget | null>;
  /** Latest month first. */
  list(workspaceId: string): Promise<Budget[]>;
  insert(budget: Budget): Promise<void>;
  update(budget: Budget): Promise<void>;
}

export type ScheduleRow = ScheduledPrompt & { agentName: string };

export interface ScheduleRepository {
  findById(id: string): Promise<ScheduledPrompt | null>;
  /** The member's own, newest first. */
  list(workspaceId: string, userId: string, query: PageQuery): Promise<Page<ScheduleRow>>;
  insert(schedule: ScheduledPrompt): Promise<void>;
  update(schedule: ScheduledPrompt): Promise<void>;
  /** Latest first. */
  runs(scheduleId: string): Promise<ScheduledRun[]>;
}

export interface AuditFilter extends PageQuery {
  entityKind?: string | undefined;
  entityId?: string | undefined;
  actorId?: string | undefined;
  action?: string | undefined;
}

export type AuditRow = AuditEntry & { actorName: string | null };

export interface AuditRepository {
  insert(entry: AuditEntry): Promise<void>;
  /** Latest first. */
  list(workspaceId: string, filter: AuditFilter): Promise<Page<AuditRow>>;
}

export interface Ports {
  workspaces: WorkspaceRepository;
  users: UserRepository;
  memberships: MembershipRepository;
  sessions: SessionRepository;
  invitations: InvitationRepository;
  models: ModelRepository;
  libraries: LibraryRepository;
  documents: DocumentRepository;
  chunks: ChunkRepository;
  agents: AgentRepository;
  agentVersions: AgentVersionRepository;
  shareRequests: ShareRequestRepository;
  conversations: ConversationRepository;
  messages: MessageRepository;
  usage: UsageRepository;
  budgets: BudgetRepository;
  schedules: ScheduleRepository;
  audit: AuditRepository;
}

/** Runs `work` so that either every write in it lands or none does. Inside, write through the ports given, never the outer ones. */
export interface UnitOfWork {
  run<T>(work: (ports: Ports) => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  /** A new id with the prefix: `lib_` + random alphanumerics. */
  id(prefix: string): string;
  /** `length` lower-case alphanumerics, unpredictable. */
  token(length: number): string;
}

/** Everything a use-case factory takes. */
export interface Deps {
  ports: Ports;
  unitOfWork: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  sessionHours: number;
  /** The model, or its stand-in; the extractive answerer by default. */
  answerer?: Answerer | undefined;
  /** The member's rate limit; the default bucket over the clock when not given. */
  rateLimiter?: RateLimiter | undefined;
  /** Milliseconds between the pieces of a streamed answer; none by default. */
  streamDelayMs?: number | undefined;
}
