import { describe, expectTypeOf, test } from "vitest";
import type { Agent, AgentVersion, AuditEntry, Budget, Chunk, Citation, Conversation, Document, Invitation, Library, Membership, Message, Model, ModelPriceRow, ScheduledPrompt, ScheduledRun, Session, ShareRequest, UsageEvent, User, Workspace } from "@cahier/domain";
import { portContract, type Fixture } from "../../domain/test/port-contract.js";
import { drizzlePortsCreator } from "../src/adapters.js";
import { connectPglite } from "../src/migrate.js";
import { seedDatabase } from "../src/seed.js";
import * as schema from "../src/schema.js";

/*
 * The Drizzle adapters pass the same contract test as the in-memory ones, on PGlite, loaded
 * with the same fixture. And the rows Drizzle infers from the schema are the domain's entities,
 * field for field, so no mapping sits between the two.
 */

portContract("drizzle", async (data: Fixture) => {
  const conn = await connectPglite();
  await seedDatabase(conn.db, data);
  // The seed never carries sessions (they are opened by signing in); the fixture does.
  if (data.sessions.length > 0) await conn.db.insert(schema.sessions).values(data.sessions);
  const { ports, unitOfWork } = drizzlePortsCreator(conn.db);
  return { ports, unitOfWork, close: conn.close };
});

/** True when each type is assignable to the other: the same fields with the same types, whatever the alias names. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("the rows and the entities", () => {
  test("are the same types, table by table", () => {
    expectTypeOf<Same<schema.WorkspaceRow, Workspace>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.UserRow, User>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.MembershipRow, Membership>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.SessionRow, Session>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.InvitationRow, Invitation>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.ModelRow, Model>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.ModelPriceRow, ModelPriceRow>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.LibraryRow, Library>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.DocumentRow, Document>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.ChunkRow, Chunk>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.AgentRow, Agent>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.AgentVersionRow, AgentVersion>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.ShareRequestRow, ShareRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.ConversationRow, Conversation>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.MessageRow, Message>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.CitationRow, Citation>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.UsageEventRow, UsageEvent>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.BudgetRow, Budget>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.ScheduledPromptRow, ScheduledPrompt>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.ScheduledRunRow, ScheduledRun>>().toEqualTypeOf<true>();
    expectTypeOf<Same<schema.AuditEntryRow, AuditEntry>>().toEqualTypeOf<true>();
  });
});
