import { describe, expect, test } from "vitest";
import { LEA, NOOR, NOW, failure, unwrap, world } from "./harness.js";

describe("settings", () => {
  test("an admin reads the tools, the retention and the budgets, and a member may not", async () => {
    const { useCases } = world();
    const settings = unwrap(await useCases.settings.get(NOOR));
    expect(settings.workspace.name).toBe("Oriel");
    expect(settings.tools).toEqual({ groundedAnswers: true, scheduledPrompts: true, uploads: true });
    expect(settings.retentionDays).toBe(90);
    expect(settings.budgets.map((b) => [b.month, b.limitMicros, b.status])).toEqual([
      ["2026-09", 2_000_000, "open"],
      ["2026-08", 1_000_000, "closed"],
    ]);
    expect(failure(await useCases.settings.get(LEA)).code).toBe("forbidden");
  });

  test("updating the tools or the retention audits before and after", async () => {
    const { useCases, store } = world();
    const updated = unwrap(await useCases.settings.update(NOOR, { tools: { uploads: false }, retentionDays: 30 }));
    expect(updated.tools).toEqual({ groundedAnswers: true, scheduledPrompts: true, uploads: false });
    expect(updated.retentionDays).toBe(30);
    expect(store.auditLog.at(-1)).toMatchObject({
      action: "workspace.updated",
      entityId: "ws_oriel",
      before: { tools: { groundedAnswers: true, scheduledPrompts: true, uploads: true }, retentionDays: 90 },
      after: { tools: { groundedAnswers: true, scheduledPrompts: true, uploads: false }, retentionDays: 30 },
    });
    expect(failure(await useCases.settings.update(NOOR, { retentionDays: 0 })).code).toBe("invalid");
    expect(failure(await useCases.settings.update(NOOR, { retentionDays: 4000 })).code).toBe("invalid");
  });

  test("a budget is set for this month or a later one, raised in place, never for a past or closed month", async () => {
    const { useCases, store } = world();
    const raised = unwrap(await useCases.settings.setBudget(NOOR, { month: "2026-09", limitMicros: 5_000_000 }));
    expect(raised).toMatchObject({ id: "bud_1", limitMicros: 5_000_000, status: "open" });
    const next = unwrap(await useCases.settings.setBudget(NOOR, { month: "2026-10", limitMicros: 3_000_000 }));
    expect(next).toMatchObject({ workspaceId: "ws_oriel", month: "2026-10", limitMicros: 3_000_000, status: "open", setBy: "usr_noor", createdAt: NOW });
    expect(store.auditLog.slice(-2).map((a) => [a.action, a.before, a.after])).toEqual([
      ["budget.set", { limitMicros: 2_000_000 }, { month: "2026-09", limitMicros: 5_000_000 }],
      ["budget.set", null, { month: "2026-10", limitMicros: 3_000_000 }],
    ]);
    expect(failure(await useCases.settings.setBudget(NOOR, { month: "2026-08", limitMicros: 1 })).reason).toBe("past_month");
    expect(failure(await useCases.settings.setBudget(NOOR, { month: "2026-13", limitMicros: 1 })).code).toBe("invalid");
    expect(failure(await useCases.settings.setBudget(NOOR, { month: "2026-11", limitMicros: -1 })).code).toBe("invalid");
  });
});

describe("usage", () => {
  test("the report groups the month four ways, reads the budget, and the groups reconcile to the micro-dollar", async () => {
    const { useCases } = world();
    const report = unwrap(await useCases.usage.report(NOOR, "2026-09"));
    expect(report.total).toEqual({ rows: 5, tokens: 4510, costMicros: 1201 });
    expect(report.byModel.map((g) => g.label)).toEqual(["Large 4", "Small 4"]);
    expect(report.byMember.map((g) => [g.label, g.costMicros])).toEqual([
      ["Léa", 480],
      ["Tom", 721],
    ]);
    expect(report.byAgent.map((g) => g.label)).toEqual(["", "Field agent", "Handbook helper"]);
    expect(report.byDay.map((g) => g.key)).toEqual(["2026-09-11", "2026-09-12", "2026-09-13"]);
    expect(report.budget).toEqual({ limitMicros: 2_000_000, spentMicros: 1201, remainingMicros: 1_998_799, status: "open" });
    expect(report.reconciliation).toEqual({ rows: 1201, byModel: 1201, byMember: 1201, byAgent: 1201, byDay: 1201, agree: true });
  });

  test("a month without usage or budget is an empty report, and a member may not read it", async () => {
    const { useCases } = world();
    const report = unwrap(await useCases.usage.report(NOOR, "2026-07"));
    expect(report.total).toEqual({ rows: 0, tokens: 0, costMicros: 0 });
    expect(report.budget).toBeNull();
    expect(report.reconciliation.agree).toBe(true);
    expect(failure(await useCases.usage.report(LEA, "2026-09")).code).toBe("forbidden");
    expect(failure(await useCases.usage.report(NOOR, "September")).code).toBe("invalid");
  });

  test("a member reads their own month by kind", async () => {
    const { useCases } = world();
    expect(unwrap(await useCases.usage.mine(LEA, "2026-09"))).toEqual({
      month: "2026-09",
      tokens: 3500,
      costMicros: 480,
      byKind: { input: { tokens: 1000, costMicros: 150 }, cached_input: { tokens: 2000, costMicros: 30 }, output: { tokens: 500, costMicros: 300 } },
    });
  });
});

describe("audit", () => {
  test("an admin lists the log with the actor's name, filtered; a member may not", async () => {
    const { useCases } = world();
    const page = unwrap(await useCases.audit.list(NOOR, { limit: 50, cursor: null, entityKind: "library" }));
    expect(page.items.map((e) => [e.action, e.actorName])).toEqual([["library.created", "Noor"]]);
    expect(failure(await useCases.audit.list(LEA, { limit: 50, cursor: null })).code).toBe("forbidden");
  });
});
