import type { Deps } from "../ports.js";
import { auditUseCasesCreator } from "./audit.js";
import { authUseCasesCreator } from "./auth.js";
import { membersUseCasesCreator } from "./members.js";
import { settingsUseCasesCreator } from "./settings.js";
import { usageUseCasesCreator } from "./usage.js";

export { auditRecorder, auditUseCasesCreator, type AuditInput } from "./audit.js";
export { authUseCasesCreator, tokenHashOf, type AcceptInvitationInput, type Me, type SignInInput, type SignedIn } from "./auth.js";
export { membersUseCasesCreator, type InviteInput } from "./members.js";
export { RETENTION_RANGE, settingsUseCasesCreator, type BudgetInput, type Settings, type SettingsUpdate } from "./settings.js";
export { usageUseCasesCreator, type MyUsage, type UsageReport } from "./usage.js";

/** Every use case, built once over one set of dependencies: what the router and the tests hold. */
export function useCasesCreator(deps: Deps) {
  return {
    auth: authUseCasesCreator(deps),
    members: membersUseCasesCreator(deps),
    settings: settingsUseCasesCreator(deps),
    usage: usageUseCasesCreator(deps),
    audit: auditUseCasesCreator(deps),
  };
}

export type UseCases = ReturnType<typeof useCasesCreator>;
