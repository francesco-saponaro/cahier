import type { Actor, AuditEntry } from "../entities.js";
import type { Page } from "../cursor.js";
import type { AuditFilter, AuditRow, Deps, Ports } from "../ports.js";
import { forbidden, ok, type Result } from "../result.js";
import { canAdmin } from "../access.js";

/*
 * Every change lands in the audit log: who did what to which entity, the fields before and after,
 * and a reason when a person gave one. `auditRecorder` makes the function every other use case calls, through
 * the ports of the unit of work it is in, so the audit row commits with the change or not at all.
 */

export interface AuditInput {
  workspaceId: string;
  actorId: string | null;
  action: string;
  entityKind: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

export function auditRecorder(deps: Pick<Deps, "ids" | "clock">) {
  return async (on: Ports, input: AuditInput): Promise<AuditEntry> => {
    const entry: AuditEntry = {
      id: deps.ids.id("aud"),
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: input.action,
      entityKind: input.entityKind,
      entityId: input.entityId,
      before: input.before ?? null,
      after: input.after ?? null,
      reason: input.reason ?? null,
      at: deps.clock.now(),
    };
    await on.audit.insert(entry);
    return entry;
  };
}

export function auditUseCasesCreator(deps: Deps) {
  return {
    async list(actor: Actor, filter: AuditFilter): Promise<Result<Page<AuditRow>>> {
      if (!canAdmin(actor, actor.workspaceId)) return forbidden("only an admin reads the audit log");
      return ok(await deps.ports.audit.list(actor.workspaceId, filter));
    },
  };
}
