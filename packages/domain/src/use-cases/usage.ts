import type { Actor, BudgetStatus } from "../entities.js";
import type { PriceKind } from "../money.js";
import type { Deps, UsageGroup, UsageTotals } from "../ports.js";
import { forbidden, invalid, ok, type Result } from "../result.js";
import { isMonth } from "../time.js";
import { canAdmin } from "../access.js";

/*
 * The usage report: a month's tokens and cost by model, by member, by agent and by day, next to
 * the month's budget. Each grouping is its own query over the usage rows, so the reconciliation
 * line can say whether they agree with each other and with the plain sum, to the micro-dollar.
 */

export interface UsageReport {
  month: string;
  total: UsageTotals & { rows: number };
  byModel: UsageGroup[];
  byMember: UsageGroup[];
  byAgent: UsageGroup[];
  byDay: UsageGroup[];
  budget: { limitMicros: number; spentMicros: number; remainingMicros: number; status: BudgetStatus } | null;
  reconciliation: { rows: number; byModel: number; byMember: number; byAgent: number; byDay: number; agree: boolean };
}

export interface MyUsage extends UsageTotals {
  month: string;
  byKind: Record<PriceKind, UsageTotals>;
}

const sumCost = (groups: UsageGroup[]) => groups.reduce((n, g) => n + g.costMicros, 0);

export function usageUseCasesCreator(deps: Deps) {
  const { ports } = deps;

  return {
    async report(actor: Actor, month: string): Promise<Result<UsageReport>> {
      if (!canAdmin(actor, actor.workspaceId)) return forbidden("only an admin reads the usage report");
      if (!isMonth(month)) return invalid("the month must be written YYYY-MM");
      const ws = actor.workspaceId;
      const [total, byModel, byMember, byAgent, byDay, budget] = await Promise.all([
        ports.usage.total(ws, month),
        ports.usage.byModel(ws, month),
        ports.usage.byMember(ws, month),
        ports.usage.byAgent(ws, month),
        ports.usage.byDay(ws, month),
        ports.budgets.find(ws, month),
      ]);
      const sums = { rows: total.costMicros, byModel: sumCost(byModel), byMember: sumCost(byMember), byAgent: sumCost(byAgent), byDay: sumCost(byDay) };
      return ok({
        month,
        total,
        byModel,
        byMember,
        byAgent,
        byDay,
        budget: budget ? { limitMicros: budget.limitMicros, spentMicros: total.costMicros, remainingMicros: Math.max(0, budget.limitMicros - total.costMicros), status: budget.status } : null,
        reconciliation: { ...sums, agree: [sums.byModel, sums.byMember, sums.byAgent, sums.byDay].every((s) => s === sums.rows) },
      });
    },

    async mine(actor: Actor, month: string): Promise<Result<MyUsage>> {
      if (!isMonth(month)) return invalid("the month must be written YYYY-MM");
      const mine = await ports.usage.mine(actor.workspaceId, actor.userId, month);
      return ok({ month, ...mine });
    },
  };
}
