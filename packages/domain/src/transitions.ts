import type {
  AgentStatus,
  AgentVersionStatus,
  BudgetStatus,
  ConversationStatus,
  DocumentStatus,
  InvitationStatus,
  MembershipStatus,
  MessageStatus,
  RunStatus,
  ScheduleStatus,
  ShareStatus,
  Visibility,
} from "./entities.js";
import { fail, ok, type Result } from "./result.js";

/*
 * The state machines as tables: for each state, the states it may move to. A use case asks `move`
 * before writing, so a forbidden transition is a conflict and never a row. The tables are data on
 * purpose: they are what `docs/domain.md` shows and what a reader takes in on one screen.
 */

export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

export const documentTransitions: TransitionTable<DocumentStatus> = {
  uploaded: ["processing"],
  processing: ["indexed", "failed"],
  indexed: ["processing"],
  failed: ["processing"],
};

/** `retired → published` is a roll-back, and only the roll-back use case takes that step. */
export const agentVersionTransitions: TransitionTable<AgentVersionStatus> = {
  draft: ["published"],
  published: ["retired"],
  retired: ["published"],
};

export const agentTransitions: TransitionTable<AgentStatus> = {
  active: ["archived"],
  archived: [],
};

export const shareTransitions: TransitionTable<ShareStatus> = {
  requested: ["approved", "declined", "withdrawn"],
  approved: [],
  declined: [],
  withdrawn: [],
};

export const visibilityTransitions: TransitionTable<Visibility> = {
  private: ["workspace"],
  workspace: ["private"],
};

export const invitationTransitions: TransitionTable<InvitationStatus> = {
  sent: ["accepted", "revoked", "expired"],
  accepted: [],
  revoked: [],
  expired: [],
};

export const membershipTransitions: TransitionTable<MembershipStatus> = {
  active: ["suspended"],
  suspended: ["active"],
};

export const conversationTransitions: TransitionTable<ConversationStatus> = {
  active: ["archived"],
  archived: ["active", "deleted"],
  deleted: [],
};

/** `refused` is created terminal; nothing moves into it. */
export const messageTransitions: TransitionTable<MessageStatus> = {
  streaming: ["complete", "failed"],
  complete: [],
  failed: [],
  refused: [],
};

export const scheduleTransitions: TransitionTable<ScheduleStatus> = {
  active: ["paused", "ended"],
  paused: ["active", "ended"],
  ended: [],
};

export const runTransitions: TransitionTable<RunStatus> = {
  queued: ["running", "skipped", "cancelled"],
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
  skipped: [],
  cancelled: [],
};

export const budgetTransitions: TransitionTable<BudgetStatus> = {
  open: ["closed"],
  closed: [],
};

export function canMove<S extends string>(table: TransitionTable<S>, from: S, to: S): boolean {
  return table[from].includes(to);
}

/** The next state, or a conflict saying which move was refused. */
export function move<S extends string>(table: TransitionTable<S>, entity: string, from: S, to: S): Result<S> {
  if (!canMove(table, from, to)) return fail("conflict", `a ${entity} cannot go from ${from} to ${to}`, "forbidden_transition");
  return ok(to);
}
