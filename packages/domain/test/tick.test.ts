import { describe, expect, test } from "vitest";
import { DAY, LEA, NOW, TOM, failure, unwrap, world } from "./harness.js";

/*
 * The tick: what the server runs every minute and the demo on an interval. It closes the budgets
 * of past months, deletes archived conversations past the workspace's retention, and runs the
 * scheduled prompts that are due, each as a conversation with the member's own rights.
 */

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n, 10));

describe("schedules.tick", () => {
  test("runs a due schedule as a conversation of the member, records the run and computes the next time", async () => {
    const { useCases, store, clock } = world((s) => {
      s.scheduledPrompts.find((x) => x.id === "sch_1")!.prompt = "How many days do I earn?";
    });
    const before = store.conversations.length;
    const result = await useCases.schedules.tick();
    expect(result.runs).toEqual([{ scheduleId: "sch_1", runId: "run_x1", status: "succeeded" }]);
    const run = store.scheduledRuns.find((r) => r.id === "run_x1")!;
    expect(run).toMatchObject({ scheduledPromptId: "sch_1", scheduledFor: day(14), startedAt: NOW, finishedAt: NOW, status: "succeeded", error: null });
    const conversation = store.conversations.find((c) => c.id === run.conversationId)!;
    expect(conversation).toMatchObject({ userId: "usr_lea", agentId: "agt_helper", status: "active", messageCount: 2, title: "Monday recap" });
    expect(store.conversations.length).toBe(before + 1);
    const answer = store.messages.find((m) => m.conversationId === conversation.id && m.role === "assistant")!;
    expect(answer).toMatchObject({ status: "complete", body: "Everyone earns 25 days. [1]" });
    const schedule = store.scheduledPrompts.find((x) => x.id === "sch_1")!;
    expect(schedule.lastRunAt).toEqual(NOW);
    expect(schedule.nextRunAt!.getTime()).toBeGreaterThan(clock.now().getTime());
    expect(schedule.nextRunAt!.getUTCDay()).toBe(1); // weekly on Monday
    expect(unwrap(await useCases.schedules.get(LEA, "sch_1")).runs[0]!.id).toBe("run_x1");
    // Nothing is due any more.
    expect((await useCases.schedules.tick()).runs).toEqual([]);
  });

  test("a refused or failed answer makes the run failed with the reason; a run already running makes the next one skipped", async () => {
    const { useCases, store } = world(); // "What was decided?" finds nothing in the small world
    const first = await useCases.schedules.tick();
    expect(first.runs).toEqual([{ scheduleId: "sch_1", runId: "run_x1", status: "failed" }]);
    expect(store.scheduledRuns.find((r) => r.id === "run_x1")).toMatchObject({ status: "failed", error: "no_sources" });
    expect(store.conversations.find((c) => c.id === store.scheduledRuns.find((r) => r.id === "run_x1")!.conversationId)).toBeDefined();
    const schedule = store.scheduledPrompts.find((x) => x.id === "sch_1")!;
    schedule.nextRunAt = day(15);
    store.scheduledRuns.push({ id: "run_stuck", scheduledPromptId: "sch_1", scheduledFor: day(15), startedAt: day(15), finishedAt: null, status: "running", conversationId: null, error: null });
    const second = await useCases.schedules.tick();
    expect(second.runs).toEqual([{ scheduleId: "sch_1", runId: "run_x2", status: "skipped" }]);
    expect(store.scheduledRuns.find((r) => r.id === "run_x2")).toMatchObject({ status: "skipped", error: "the previous run is still running" });
    expect(store.scheduledPrompts.find((x) => x.id === "sch_1")!.nextRunAt!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  test("a schedule whose tool has been switched off, or whose member is suspended, gets a skipped run", async () => {
    const { useCases, store } = world((s) => {
      s.workspaces[0]!.tools.scheduledPrompts = false;
    });
    expect((await useCases.schedules.tick()).runs).toEqual([{ scheduleId: "sch_1", runId: "run_x1", status: "skipped" }]);
    expect(store.scheduledRuns.find((r) => r.id === "run_x1")?.error).toBe("scheduled prompts are switched off in this workspace");
    store.workspaces[0]!.tools.scheduledPrompts = true;
    store.memberships.find((m) => m.id === "mem_lea")!.status = "suspended";
    store.scheduledPrompts.find((x) => x.id === "sch_1")!.nextRunAt = day(15);
    expect((await useCases.schedules.tick()).runs).toEqual([{ scheduleId: "sch_1", runId: "run_x2", status: "skipped" }]);
    expect(store.scheduledRuns.find((r) => r.id === "run_x2")?.error).toBe("the member is no longer active");
  });

  test("a once schedule ends after its run", async () => {
    const { useCases, store } = world((s) => {
      const once = s.scheduledPrompts.find((x) => x.id === "sch_1")!;
      once.cadence = "once";
      once.prompt = "How many days do I earn?";
    });
    await useCases.schedules.tick();
    expect(store.scheduledPrompts.find((x) => x.id === "sch_1")).toMatchObject({ status: "ended", nextRunAt: null });
    expect(store.auditLog.filter((a) => a.action === "schedule.ended" && a.entityId === "sch_1")).toHaveLength(1);
  });

  test("closes the open budgets of past months and audits it", async () => {
    const { useCases, store, clock } = world();
    expect((await useCases.schedules.tick()).closedBudgets).toBe(0);
    clock.advance(12 * DAY); // 2 October
    expect((await useCases.schedules.tick()).closedBudgets).toBe(2);
    expect(store.budgets.filter((b) => b.month === "2026-09").map((b) => b.status)).toEqual(["closed", "closed"]);
    expect(store.auditLog.filter((a) => a.action === "budget.closed")).toHaveLength(2);
    expect((await useCases.schedules.tick()).closedBudgets).toBe(0);
  });

  test("deletes archived conversations past the workspace's retention, keeping their counts and usage", async () => {
    const { useCases, store } = world((s) => {
      s.conversations.find((c) => c.id === "cnv_3")!.archivedAt = day(5);
      s.workspaces[0]!.retentionDays = 10; // 20 September minus 10 days is the 10th; the 6th is past it
      s.messages.push({ id: "msg_old", conversationId: "cnv_3", ordinal: 0, role: "user", body: "Old question", status: "complete", refusedReason: null, modelId: null, agentVersionId: null, promptTokens: 0, contextTokens: 0, completionTokens: 0, createdAt: day(5), completedAt: day(5) });
    });
    const result = await useCases.schedules.tick();
    expect(result.deletedConversations).toBe(1);
    expect(store.conversations.find((c) => c.id === "cnv_3")).toMatchObject({ status: "deleted", messageCount: 2, tokenTotal: 100 });
    expect(store.messages.filter((m) => m.conversationId === "cnv_3")).toEqual([]);
    expect(store.auditLog.find((a) => a.action === "conversation.deleted")).toMatchObject({ entityId: "cnv_3", actorId: null, reason: "retention", after: { status: "deleted", messagesRemoved: 1 } });
    expect(failure(await useCases.conversations.get(LEA, "cnv_3")).code).toBe("not_found");
    expect((await useCases.schedules.tick()).deletedConversations).toBe(0);
  });
});

describe("schedules.runNow", () => {
  test("runs the member's own schedule at once, whatever its next time, and answers the run", async () => {
    const { useCases, store } = world((s) => {
      s.scheduledPrompts.find((x) => x.id === "sch_3")!.prompt = "How many days do I earn?";
    });
    // Tom's schedule is paused and on the Field agent, which reads the Runbooks (shared) and his Field notes.
    const run = unwrap(await useCases.schedules.runNow(TOM, "sch_3"));
    expect(run).toMatchObject({ scheduledPromptId: "sch_3", status: "failed", error: "no_sources", scheduledFor: NOW });
    expect(store.scheduledPrompts.find((x) => x.id === "sch_3")).toMatchObject({ status: "paused", nextRunAt: day(30), lastRunAt: NOW }); // the next time is untouched
    expect(failure(await useCases.schedules.runNow(LEA, "sch_3")).code).toBe("not_found");
    expect(failure(await useCases.schedules.runNow(LEA, "sch_2"))).toMatchObject({ code: "conflict", reason: "forbidden_transition" });
    const leas = unwrap(await useCases.schedules.runNow(LEA, "sch_1"));
    expect(leas.status).toBe("failed"); // "What was decided?" finds nothing
    expect(store.scheduledPrompts.find((x) => x.id === "sch_1")!.nextRunAt).toEqual(day(14)); // untouched
  });
});
