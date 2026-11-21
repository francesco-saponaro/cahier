import type { ModelPrice } from "./money.js";

/*
 * The entities, one interface per table, with the same names as the columns in `packages/db`
 * (a test there checks the two agree). The domain never sees a row that is not one of these.
 */

export type Role = "member" | "admin";
export type MembershipStatus = "active" | "suspended";
export type InvitationStatus = "sent" | "accepted" | "revoked" | "expired";
export type Visibility = "private" | "workspace";
export type DocumentStatus = "uploaded" | "processing" | "indexed" | "failed";
export type AgentStatus = "active" | "archived";
export type AgentVersionStatus = "draft" | "published" | "retired";
export type ShareSubjectKind = "library" | "agent";
export type ShareStatus = "requested" | "approved" | "declined" | "withdrawn";
export type ConversationStatus = "active" | "archived" | "deleted";
export type MessageRole = "user" | "assistant";
export type MessageStatus = "streaming" | "complete" | "failed" | "refused";
export type RefusedReason = "budget_exhausted" | "rate_limited" | "tool_off" | "no_sources" | "no_price";
export type BudgetStatus = "open" | "closed";
export type Cadence = "once" | "daily" | "weekly" | "monthly";
export type ScheduleStatus = "active" | "paused" | "ended";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";

export interface WorkspaceTools {
  groundedAnswers: boolean;
  scheduledPrompts: boolean;
  uploads: boolean;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  tools: WorkspaceTools;
  retentionDays: number;
  createdAt: Date;
}

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
}

/** A user as the screens show them: never the password hash. */
export type PublicUser = Omit<User, "passwordHash">;

export interface Membership {
  id: string;
  workspaceId: string;
  userId: string;
  role: Role;
  status: MembershipStatus;
  createdAt: Date;
}

export interface Session {
  id: string;
  tokenHash: string;
  userId: string;
  workspaceId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  role: Role;
  tokenHash: string;
  status: InvitationStatus;
  invitedBy: string;
  acceptedUserId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface Model {
  id: string;
  name: string;
  contextTokens: number;
  enabled: boolean;
}

export type ModelPriceRow = ModelPrice & { id: string };

export interface Library {
  id: string;
  workspaceId: string;
  ownerId: string;
  slug: string;
  name: string;
  description: string;
  visibility: Visibility;
  createdAt: Date;
  updatedAt: Date;
}

export interface Document {
  id: string;
  libraryId: string;
  title: string;
  sourceName: string;
  mime: string;
  byteSize: number;
  charCount: number;
  body: string;
  status: DocumentStatus;
  error: string | null;
  version: number;
  uploadedBy: string;
  createdAt: Date;
  indexedAt: Date | null;
}

export interface Chunk {
  id: string;
  documentId: string;
  ordinal: number;
  headingPath: string[];
  headingText: string;
  startChar: number;
  endChar: number;
  tokenCount: number;
  body: string;
}

export interface Agent {
  id: string;
  workspaceId: string;
  ownerId: string;
  slug: string;
  name: string;
  visibility: Visibility;
  status: AgentStatus;
  currentVersionId: string | null;
  createdAt: Date;
  archivedAt: Date | null;
}

export interface AgentVersion {
  id: string;
  agentId: string;
  version: number;
  name: string;
  description: string;
  instructions: string;
  modelId: string;
  maxContextTokens: number;
  status: AgentVersionStatus;
  createdBy: string;
  createdAt: Date;
  publishedAt: Date | null;
}

export interface ShareRequest {
  id: string;
  workspaceId: string;
  subjectKind: ShareSubjectKind;
  subjectId: string;
  requestedBy: string;
  status: ShareStatus;
  reason: string | null;
  decidedBy: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export interface Conversation {
  id: string;
  workspaceId: string;
  userId: string;
  agentId: string;
  agentVersionId: string;
  title: string;
  status: ConversationStatus;
  messageCount: number;
  tokenTotal: number;
  createdAt: Date;
  lastMessageAt: Date;
  archivedAt: Date | null;
}

export interface Message {
  id: string;
  conversationId: string;
  ordinal: number;
  role: MessageRole;
  body: string;
  status: MessageStatus;
  refusedReason: RefusedReason | null;
  modelId: string | null;
  agentVersionId: string | null;
  promptTokens: number;
  contextTokens: number;
  completionTokens: number;
  createdAt: Date;
  completedAt: Date | null;
}

export interface Citation {
  id: string;
  messageId: string;
  index: number;
  chunkId: string | null;
  documentId: string | null;
  documentTitle: string;
  documentVersion: number;
  startChar: number;
  endChar: number;
  quote: string;
}

export interface UsageEvent {
  id: string;
  workspaceId: string;
  userId: string;
  agentId: string | null;
  messageId: string | null;
  modelId: string;
  kind: ModelPrice["kind"];
  tokens: number;
  microsPer1k: number;
  costMicros: number;
  occurredAt: Date;
}

export interface Budget {
  id: string;
  workspaceId: string;
  month: string;
  limitMicros: number;
  status: BudgetStatus;
  setBy: string;
  createdAt: Date;
}

export interface ScheduledPrompt {
  id: string;
  workspaceId: string;
  userId: string;
  agentId: string;
  name: string;
  prompt: string;
  cadence: Cadence;
  atMinute: number;
  weekday: number | null;
  dayOfMonth: number | null;
  timezone: string;
  nextRunAt: Date | null;
  status: ScheduleStatus;
  createdAt: Date;
  lastRunAt: Date | null;
}

export interface ScheduledRun {
  id: string;
  scheduledPromptId: string;
  scheduledFor: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  status: RunStatus;
  conversationId: string | null;
  error: string | null;
}

export interface AuditEntry {
  id: string;
  workspaceId: string;
  actorId: string | null;
  action: string;
  entityKind: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  at: Date;
}

/** Who is asking: the session's user in the session's workspace, with the role the membership gives them. */
export interface Actor {
  userId: string;
  workspaceId: string;
  role: Role;
}
