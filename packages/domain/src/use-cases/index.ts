import type { Deps } from "../ports.js";
import { auditUseCasesCreator } from "./audit.js";
import { authUseCasesCreator } from "./auth.js";
import { membersUseCasesCreator } from "./members.js";
import { settingsUseCasesCreator } from "./settings.js";
import { usageUseCasesCreator } from "./usage.js";
import { librariesUseCasesCreator } from "./libraries.js";
import { agentsUseCasesCreator } from "./agents.js";
import { sharesUseCasesCreator } from "./shares.js";
import { conversationsUseCasesCreator } from "./conversations.js";
import { schedulesUseCasesCreator } from "./schedules.js";
import { ingestionUseCasesCreator } from "./ingestion.js";
import { messagesUseCasesCreator } from "./messages.js";

export { auditRecorder, auditUseCasesCreator, type AuditInput } from "./audit.js";
export { authUseCasesCreator, tokenHashOf, type AcceptInvitationInput, type Me, type SignInInput, type SignedIn } from "./auth.js";
export { membersUseCasesCreator, type InviteInput } from "./members.js";
export { RETENTION_RANGE, settingsUseCasesCreator, type BudgetInput, type Settings, type SettingsUpdate } from "./settings.js";
export { usageUseCasesCreator, type MyUsage, type UsageReport } from "./usage.js";
export { DESCRIPTION_MAX, NAME_MAX, cleanName, freshSlug, librariesUseCasesCreator, slugify, type LibraryInput } from "./libraries.js";
export { CONTEXT_MIN, INSTRUCTIONS_MAX, agentsUseCasesCreator, type VersionInput, type VersionWithLibraries } from "./agents.js";
export { sharesUseCasesCreator, type InboxRow, type SubjectRef } from "./shares.js";
export { TITLE_MAX, conversationsUseCasesCreator } from "./conversations.js";
export { PROMPT_MAX, checkSchedule, schedulesUseCasesCreator, type ScheduleInput } from "./schedules.js";
export { TEXT_MAX, ingestionUseCasesCreator, type Ingested, type ReplaceInput, type UploadInput } from "./ingestion.js";
export { QUESTION_MAX, RETRIEVE_LIMIT, messagesUseCasesCreator, type Prepared, type SendEvent } from "./messages.js";

/** Every use case, built once over one set of dependencies: what the router and the tests hold. */
export function useCasesCreator(deps: Deps) {
  const { libraries, documents } = librariesUseCasesCreator(deps);
  const { conversations, messages } = conversationsUseCasesCreator(deps);
  return {
    conversations,
    messages: { ...messages, ...messagesUseCasesCreator(deps) },
    schedules: schedulesUseCasesCreator(deps),
    auth: authUseCasesCreator(deps),
    libraries,
    documents: { ...documents, ...ingestionUseCasesCreator(deps) },
    agents: agentsUseCasesCreator(deps),
    shares: sharesUseCasesCreator(deps),
    members: membersUseCasesCreator(deps),
    settings: settingsUseCasesCreator(deps),
    usage: usageUseCasesCreator(deps),
    audit: auditUseCasesCreator(deps),
  };
}

export type UseCases = ReturnType<typeof useCasesCreator>;
