import { z } from "zod";
import { CONTEXT_MIN, DESCRIPTION_MAX, INSTRUCTIONS_MAX, MAX_PAGE_SIZE, NAME_MAX, PROMPT_MAX, RETENTION_RANGE, TITLE_MAX } from "@cahier/domain";

/*
 * Every procedure's input as a zod schema. The web app imports these for its forms, so what the
 * form refuses and what the API refuses are one definition. The limits come from the domain's
 * constants; the rules that need the database (a slug taken, a library the member may not read)
 * stay in the use cases and come back as tRPC errors.
 */

export const id = z.string().min(1).max(64);
export const page = z.object({
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: z.string().max(512).nullish(),
});
const paged = <T extends z.ZodRawShape>(shape: T) => page.extend(shape);

export const email = z.string().trim().min(3).max(254).email();
export const password = z.string().min(1).max(200);
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "a month is written YYYY-MM");
export const role = z.enum(["member", "admin"]);
export const scope = z.enum(["own", "shared", "all"]);
export const q = z.string().trim().max(100).optional();

export const signIn = z.object({ email, password });
export const acceptInvitation = z.object({ token: z.string().min(1).max(200), name: z.string().trim().min(1).max(NAME_MAX), password });
export const switchWorkspace = z.object({ workspaceId: id });

export const conversationList = paged({ status: z.enum(["active", "archived"]), q });
export const conversationCreate = z.object({ agentId: id });
export const conversationRename = z.object({ id, title: z.string().trim().min(1).max(TITLE_MAX) });
export const messageList = paged({ conversationId: id });

export const libraryList = paged({ scope, q, sort: z.enum(["name", "newest", "updated"]) });
export const libraryFields = z.object({ name: z.string().max(NAME_MAX), description: z.string().max(DESCRIPTION_MAX) });
export const libraryUpdate = z.object({ id, name: z.string().max(NAME_MAX).optional(), description: z.string().max(DESCRIPTION_MAX).optional() });

export const documentList = paged({ libraryId: id, status: z.enum(["uploaded", "processing", "indexed", "failed"]).optional(), q, sort: z.enum(["newest", "title"]) });

export const agentList = paged({ scope, q, sort: z.enum(["name", "newest"]) });
export const versionFields = z.object({
  name: z.string().max(NAME_MAX),
  description: z.string().max(DESCRIPTION_MAX),
  instructions: z.string().max(INSTRUCTIONS_MAX),
  modelId: id,
  maxContextTokens: z.number().int().min(CONTEXT_MIN).max(1_000_000),
  libraryIds: z.array(id).max(20),
});
export const agentSaveDraft = versionFields.extend({ agentId: id });
export const versionRef = z.object({ versionId: id });

export const shareSubject = z.object({ kind: z.enum(["library", "agent"]), id });
export const shareInbox = paged({ status: z.enum(["requested", "approved", "declined", "withdrawn"]).optional() });
export const shareDecline = z.object({ id, reason: z.string().trim().min(1).max(500) });

export const scheduleCreate = z.object({
  agentId: id,
  name: z.string().trim().min(1).max(NAME_MAX),
  prompt: z.string().trim().min(1).max(PROMPT_MAX),
  cadence: z.enum(["once", "daily", "weekly", "monthly"]),
  atMinute: z.number().int().min(0).max(1439),
  weekday: z.number().int().min(0).max(6).nullable(),
  dayOfMonth: z.number().int().min(1).max(28).nullable(),
  timezone: z.string().min(1).max(64),
});

export const monthInput = z.object({ month });

export const memberList = paged({ status: z.enum(["active", "suspended"]).optional(), role: role.optional(), q });
export const invitationList = paged({ status: z.enum(["sent", "accepted", "revoked", "expired"]).optional() });
export const invite = z.object({ email, role });
export const membershipRef = z.object({ membershipId: id });
export const setRole = membershipRef.extend({ role });

export const settingsUpdate = z.object({
  tools: z.object({ groundedAnswers: z.boolean().optional(), scheduledPrompts: z.boolean().optional(), uploads: z.boolean().optional() }).optional(),
  retentionDays: z.number().int().min(RETENTION_RANGE.min).max(RETENTION_RANGE.max).optional(),
});
export const budgetSet = z.object({ month, limitMicros: z.number().int().min(0).max(1_000_000_000_000) });

export const auditList = paged({ entityKind: z.string().max(40).optional(), entityId: id.optional(), actorId: id.optional(), action: z.string().max(60).optional() });

export const byId = z.object({ id });
