import { describe, expect, test } from "vitest";
import { DAY, LEA, NOOR, NOW, TOM, failure, unwrap, world } from "./harness.js";

describe("conversations", () => {
  test("a member lists and reads only their own, by status; an admin sees nobody else's", async () => {
    const { useCases } = world();
    expect(unwrap(await useCases.conversations.list(LEA, { limit: 50, cursor: null, status: "active" })).items.map((c) => c.title)).toEqual(["Expenses abroad", "Leave rules"]);
    expect(unwrap(await useCases.conversations.list(LEA, { limit: 50, cursor: null, status: "archived" })).items.map((c) => c.title)).toEqual(["Old chat"]);
    const one = unwrap(await useCases.conversations.get(LEA, "cnv_1"));
    expect(one.conversation.title).toBe("Leave rules");
    expect(one.agentName).toBe("Handbook helper");
    expect(failure(await useCases.conversations.get(TOM, "cnv_1")).code).toBe("not_found");
    expect(failure(await useCases.conversations.get(NOOR, "cnv_1")).code).toBe("not_found");
    expect(failure(await useCases.conversations.get(LEA, "cnv_4")).code).toBe("not_found");
  });

  test("creating takes an agent the member may use and records the version that will answer", async () => {
    const { useCases, store } = world();
    const made = unwrap(await useCases.conversations.create(LEA, "agt_helper"));
    expect(made).toMatchObject({ workspaceId: "ws_oriel", userId: "usr_lea", agentId: "agt_helper", agentVersionId: "agv_h1", title: "New conversation", status: "active", messageCount: 0, tokenTotal: 0, createdAt: NOW, lastMessageAt: NOW });
    expect(store.auditLog.at(-1)).toMatchObject({ action: "conversation.created", entityId: made.id, after: { agentId: "agt_helper", agentVersionId: "agv_h1" } });
    expect(failure(await useCases.conversations.create(LEA, "agt_field")).code).toBe("not_found");
    expect(failure(await useCases.conversations.create(LEA, "agt_old")).reason).toBe("agent_unusable");
    expect(failure(await useCases.conversations.create(LEA, "agt_new")).reason).toBe("agent_unusable");
    expect(failure(await useCases.conversations.create(NOOR, "agt_field")).reason).toBe("agent_unusable");
  });

  test("renaming, archiving and restoring are the owner's, with the transitions enforced", async () => {
    const { useCases, store, clock } = world();
    expect(unwrap(await useCases.conversations.rename(LEA, "cnv_1", "  Leave, again ")).title).toBe("Leave, again");
    expect(failure(await useCases.conversations.rename(LEA, "cnv_1", " ")).code).toBe("invalid");
    expect(failure(await useCases.conversations.rename(TOM, "cnv_1", "Mine")).code).toBe("not_found");
    clock.advance(DAY);
    const archived = unwrap(await useCases.conversations.archive(LEA, "cnv_1"));
    expect(archived).toMatchObject({ status: "archived", archivedAt: new Date(NOW.getTime() + DAY) });
    expect(store.auditLog.at(-1)).toMatchObject({ action: "conversation.archived", entityId: "cnv_1" });
    expect(failure(await useCases.conversations.archive(LEA, "cnv_1")).reason).toBe("forbidden_transition");
    const restored = unwrap(await useCases.conversations.restore(LEA, "cnv_1"));
    expect(restored).toMatchObject({ status: "active", archivedAt: null });
    expect(failure(await useCases.conversations.restore(LEA, "cnv_1")).reason).toBe("forbidden_transition");
  });

  test("messages are listed in order with their citations, for the owner only", async () => {
    const { useCases } = world();
    const page = unwrap(await useCases.messages.list(LEA, "cnv_1", { limit: 50, cursor: null }));
    expect(page.items.map((m) => [m.ordinal, m.role, m.citations.map((c) => c.quote)])).toEqual([
      [0, "user", []],
      [1, "assistant", ["Everyone earns 25 days."]],
      [2, "user", []],
    ]);
    expect(failure(await useCases.messages.list(TOM, "cnv_1", { limit: 50, cursor: null })).code).toBe("not_found");
  });
});

describe("schedules", () => {
  const input = { agentId: "agt_helper", name: "Friday digest", prompt: "What changed this week?", cadence: "weekly" as const, atMinute: 17 * 60, weekday: 5, dayOfMonth: null, timezone: "Europe/Paris" };

  test("a member lists their own schedules and reads one with its runs", async () => {
    const { useCases } = world();
    expect(unwrap(await useCases.schedules.list(LEA, { limit: 50, cursor: null })).items.map((s) => [s.name, s.agentName])).toEqual([
      ["Monday recap", "Handbook helper"],
      ["Ended one", "Handbook helper"],
    ]);
    const one = unwrap(await useCases.schedules.get(LEA, "sch_1"));
    expect(one.schedule.name).toBe("Monday recap");
    expect(one.runs.map((r) => r.status)).toEqual(["succeeded", "failed"]);
    expect(failure(await useCases.schedules.get(TOM, "sch_1")).code).toBe("not_found");
  });

  test("creating computes the next run from now in the schedule's time zone and needs the tool on and a usable agent", async () => {
    const { useCases, store } = world();
    const made = unwrap(await useCases.schedules.create(LEA, input));
    // Sunday 20 September 2026 at 20:00 in Paris: the coming Friday at 17:00 CEST is 15:00 UTC.
    expect(made).toMatchObject({ workspaceId: "ws_oriel", userId: "usr_lea", agentId: "agt_helper", name: "Friday digest", cadence: "weekly", atMinute: 1020, weekday: 5, dayOfMonth: null, timezone: "Europe/Paris", status: "active", nextRunAt: new Date("2026-09-25T15:00:00Z"), createdAt: NOW, lastRunAt: null });
    expect(store.auditLog.at(-1)).toMatchObject({ action: "schedule.created", entityId: made.id });
    expect(failure(await useCases.schedules.create(LEA, { ...input, agentId: "agt_field" })).code).toBe("not_found");
    expect(failure(await useCases.schedules.create(LEA, { ...input, agentId: "agt_old" })).reason).toBe("agent_unusable");
    expect(failure(await useCases.schedules.create(LEA, { ...input, weekday: null })).code).toBe("invalid");
    expect(failure(await useCases.schedules.create(LEA, { ...input, cadence: "monthly", dayOfMonth: 31 })).code).toBe("invalid");
    expect(failure(await useCases.schedules.create(LEA, { ...input, atMinute: 1440 })).code).toBe("invalid");
    expect(failure(await useCases.schedules.create(LEA, { ...input, timezone: "Mars/Olympus" })).code).toBe("invalid");
    expect(failure(await useCases.schedules.create(LEA, { ...input, prompt: "" })).code).toBe("invalid");
    store.workspaces.find((w) => w.id === "ws_oriel")!.tools.scheduledPrompts = false;
    expect(failure(await useCases.schedules.create(LEA, input)).reason).toBe("tool_off");
  });

  test("pausing clears the next run, resuming computes it again, ending is final", async () => {
    const { useCases, store } = world();
    const paused = unwrap(await useCases.schedules.pause(LEA, "sch_1"));
    expect(paused).toMatchObject({ status: "paused", nextRunAt: null });
    expect(failure(await useCases.schedules.pause(LEA, "sch_1")).reason).toBe("forbidden_transition");
    const resumed = unwrap(await useCases.schedules.resume(LEA, "sch_1"));
    expect(resumed).toMatchObject({ status: "active", nextRunAt: new Date("2026-09-21T06:30:00Z") });
    const ended = unwrap(await useCases.schedules.end(LEA, "sch_1"));
    expect(ended).toMatchObject({ status: "ended", nextRunAt: null });
    expect(failure(await useCases.schedules.resume(LEA, "sch_1")).reason).toBe("forbidden_transition");
    expect(store.auditLog.slice(-3).map((a) => a.action)).toEqual(["schedule.paused", "schedule.resumed", "schedule.ended"]);
    expect(failure(await useCases.schedules.pause(TOM, "sch_1")).code).toBe("not_found");
  });
});
