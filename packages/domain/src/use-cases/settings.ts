import type { Actor, Budget, Workspace, WorkspaceTools } from "../entities.js";
import type { Deps } from "../ports.js";
import { fail, forbidden, invalid, ok, type Result } from "../result.js";
import { isMonth, monthOf } from "../time.js";
import { canAdmin } from "../access.js";
import { auditRecorder } from "./audit.js";

/*
 * The workspace's settings: which tools are on, how long archived conversations are kept, and
 * the monthly budget. A budget is a row per month; this month's can be raised in place, next
 * month's set ahead, a past month is closed and stays as it was spent.
 */

export interface Settings {
  workspace: Workspace;
  tools: WorkspaceTools;
  retentionDays: number;
  budgets: Budget[];
}

export interface SettingsUpdate {
  tools?: { [K in keyof WorkspaceTools]?: boolean | undefined } | undefined;
  retentionDays?: number | undefined;
}

export interface BudgetInput {
  month: string;
  limitMicros: number;
}

export const RETENTION_RANGE = { min: 1, max: 3650 };

export function settingsUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids } = deps;
  const audit = auditRecorder(deps);

  async function workspaceOf(actor: Actor): Promise<Result<Workspace>> {
    if (!canAdmin(actor, actor.workspaceId)) return forbidden("only an admin reads the settings");
    const workspace = await ports.workspaces.findById(actor.workspaceId);
    return workspace ? ok(workspace) : fail("not_found", "workspace not found");
  }

  return {
    async get(actor: Actor): Promise<Result<Settings>> {
      const found = await workspaceOf(actor);
      if (!found.ok) return found;
      const budgets = await ports.budgets.list(actor.workspaceId);
      return ok({ workspace: found.value, tools: found.value.tools, retentionDays: found.value.retentionDays, budgets });
    },

    async update(actor: Actor, input: SettingsUpdate): Promise<Result<Workspace>> {
      const found = await workspaceOf(actor);
      if (!found.ok) return found;
      const workspace = found.value;
      const retentionDays = input.retentionDays ?? workspace.retentionDays;
      if (!Number.isInteger(retentionDays) || retentionDays < RETENTION_RANGE.min || retentionDays > RETENTION_RANGE.max) {
        return invalid(`retention must be between ${RETENTION_RANGE.min} and ${RETENTION_RANGE.max} days`);
      }
      const tools: WorkspaceTools = {
        groundedAnswers: input.tools?.groundedAnswers ?? workspace.tools.groundedAnswers,
        scheduledPrompts: input.tools?.scheduledPrompts ?? workspace.tools.scheduledPrompts,
        uploads: input.tools?.uploads ?? workspace.tools.uploads,
      };
      const updated: Workspace = { ...workspace, tools, retentionDays };
      await unitOfWork.run(async (on) => {
        await on.workspaces.update(updated);
        await audit(on, {
          workspaceId: actor.workspaceId, actorId: actor.userId, action: "workspace.updated", entityKind: "workspace", entityId: workspace.id,
          before: { tools: workspace.tools, retentionDays: workspace.retentionDays }, after: { tools: updated.tools, retentionDays: updated.retentionDays },
        });
      });
      return ok(updated);
    },

    async setBudget(actor: Actor, input: BudgetInput): Promise<Result<Budget>> {
      const found = await workspaceOf(actor);
      if (!found.ok) return found;
      if (!isMonth(input.month)) return invalid("the month must be written YYYY-MM");
      if (!Number.isInteger(input.limitMicros) || input.limitMicros < 0) return invalid("the limit must be a whole number of micro-dollars, zero or more");
      const now = clock.now();
      if (input.month < monthOf(now)) return fail("rule", "a past month's budget cannot be changed", "past_month");
      const existing = await ports.budgets.find(actor.workspaceId, input.month);
      if (existing?.status === "closed") return fail("conflict", "the month is closed", "month_closed");
      const budget: Budget = existing
        ? { ...existing, limitMicros: input.limitMicros, setBy: actor.userId }
        : { id: ids.id("bud"), workspaceId: actor.workspaceId, month: input.month, limitMicros: input.limitMicros, status: "open", setBy: actor.userId, createdAt: now };
      await unitOfWork.run(async (on) => {
        if (existing) await on.budgets.update(budget);
        else await on.budgets.insert(budget);
        await audit(on, {
          workspaceId: actor.workspaceId, actorId: actor.userId, action: "budget.set", entityKind: "budget", entityId: budget.id,
          before: existing ? { limitMicros: existing.limitMicros } : null, after: { month: input.month, limitMicros: input.limitMicros },
        });
      });
      return ok(budget);
    },
  };
}
