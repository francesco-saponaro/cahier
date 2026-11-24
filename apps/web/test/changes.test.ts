import { describe, expect, test } from "vitest";
import { actionWords, changes } from "../src/screens/admin/changes";

/* An audit row's before and after as lines a person can read, and its action in words. */

describe("the changes of an audit row", () => {
  test("lists each field that differs, with both values", () => {
    expect(changes({ status: "requested" }, { status: "approved" })).toEqual([{ field: "status", before: "requested", after: "approved" }]);
    expect(changes({ tools: { uploads: true, groundedAnswers: true }, retentionDays: 90 }, { tools: { uploads: false, groundedAnswers: true }, retentionDays: 90 })).toEqual([
      { field: "tools.uploads", before: "true", after: "false" },
    ]);
  });

  test("a creation has only afters, a removal only befores, and nothing when both are empty", () => {
    expect(changes(null, { name: "Runbooks", visibility: "private" })).toEqual([
      { field: "name", before: null, after: "Runbooks" },
      { field: "visibility", before: null, after: "private" },
    ]);
    expect(changes({ version: 2 }, null)).toEqual([{ field: "version", before: "2", after: null }]);
    expect(changes(null, null)).toEqual([]);
  });

  test("prints a long value short and a date as a date", () => {
    const long = "x".repeat(200);
    expect(changes(null, { text: long })[0]?.after).toHaveLength(81);
    expect(changes(null, { at: "2026-11-24T18:00:00.000Z" })[0]?.after).toBe("2026-11-24T18:00:00.000Z");
  });
});

describe("an action in words", () => {
  test("says the entity and what happened to it", () => {
    expect(actionWords("share.approved")).toBe("Share approved");
    expect(actionWords("agent_version.rolled_back")).toBe("Agent version rolled back");
    expect(actionWords("membership.role_changed")).toBe("Membership role changed");
    expect(actionWords("budget.set")).toBe("Budget set");
  });
});
