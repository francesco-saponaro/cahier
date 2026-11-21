import { describe, expect, test } from "vitest";
import {
  agentTransitions,
  agentVersionTransitions,
  budgetTransitions,
  canMove,
  conversationTransitions,
  documentTransitions,
  invitationTransitions,
  membershipTransitions,
  messageTransitions,
  move,
  runTransitions,
  scheduleTransitions,
  shareTransitions,
  visibilityTransitions,
} from "../src/transitions.js";

describe("the transition tables", () => {
  test("a document is processed from uploaded and re-indexed from indexed or failed", () => {
    expect(canMove(documentTransitions, "uploaded", "processing")).toBe(true);
    expect(canMove(documentTransitions, "processing", "indexed")).toBe(true);
    expect(canMove(documentTransitions, "processing", "failed")).toBe(true);
    expect(canMove(documentTransitions, "indexed", "processing")).toBe(true);
    expect(canMove(documentTransitions, "failed", "processing")).toBe(true);
    expect(canMove(documentTransitions, "uploaded", "indexed")).toBe(false);
    expect(canMove(documentTransitions, "indexed", "uploaded")).toBe(false);
  });

  test("an agent version is published from draft, retired from published, and republished only from retired", () => {
    expect(canMove(agentVersionTransitions, "draft", "published")).toBe(true);
    expect(canMove(agentVersionTransitions, "published", "retired")).toBe(true);
    expect(canMove(agentVersionTransitions, "retired", "published")).toBe(true);
    expect(canMove(agentVersionTransitions, "draft", "retired")).toBe(false);
    expect(canMove(agentVersionTransitions, "published", "draft")).toBe(false);
  });

  test("the terminal states have no way out", () => {
    expect(agentTransitions.archived).toEqual([]);
    expect(shareTransitions.approved).toEqual([]);
    expect(shareTransitions.declined).toEqual([]);
    expect(shareTransitions.withdrawn).toEqual([]);
    expect(invitationTransitions.accepted).toEqual([]);
    expect(invitationTransitions.revoked).toEqual([]);
    expect(invitationTransitions.expired).toEqual([]);
    expect(conversationTransitions.deleted).toEqual([]);
    expect(messageTransitions.complete).toEqual([]);
    expect(messageTransitions.refused).toEqual([]);
    expect(scheduleTransitions.ended).toEqual([]);
    expect(runTransitions.succeeded).toEqual([]);
    expect(budgetTransitions.closed).toEqual([]);
  });

  test("memberships, visibility and schedules go back and forth; a conversation is restored only from archived", () => {
    expect(canMove(membershipTransitions, "active", "suspended")).toBe(true);
    expect(canMove(membershipTransitions, "suspended", "active")).toBe(true);
    expect(canMove(visibilityTransitions, "private", "workspace")).toBe(true);
    expect(canMove(visibilityTransitions, "workspace", "private")).toBe(true);
    expect(canMove(scheduleTransitions, "active", "paused")).toBe(true);
    expect(canMove(scheduleTransitions, "paused", "active")).toBe(true);
    expect(canMove(scheduleTransitions, "paused", "ended")).toBe(true);
    expect(canMove(conversationTransitions, "active", "archived")).toBe(true);
    expect(canMove(conversationTransitions, "archived", "active")).toBe(true);
    expect(canMove(conversationTransitions, "archived", "deleted")).toBe(true);
    expect(canMove(conversationTransitions, "active", "deleted")).toBe(false);
  });

  test("a run is queued, then running, then done, or skipped and cancelled while still queued", () => {
    expect(canMove(runTransitions, "queued", "running")).toBe(true);
    expect(canMove(runTransitions, "running", "succeeded")).toBe(true);
    expect(canMove(runTransitions, "running", "failed")).toBe(true);
    expect(canMove(runTransitions, "queued", "skipped")).toBe(true);
    expect(canMove(runTransitions, "queued", "cancelled")).toBe(true);
    expect(canMove(runTransitions, "running", "skipped")).toBe(false);
  });

  test("move answers the next state, or a conflict naming the refused step", () => {
    expect(move(shareTransitions, "share request", "requested", "approved")).toEqual({ ok: true, value: "approved" });
    const refused = move(shareTransitions, "share request", "approved", "declined");
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("conflict");
      expect(refused.error.message).toBe("a share request cannot go from approved to declined");
      expect(refused.error.reason).toBe("forbidden_transition");
    }
  });
});
