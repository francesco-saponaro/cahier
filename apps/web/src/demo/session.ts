import { appRouter, createContext, type AppRouter } from "@cahier/api";
import { cryptoIdGeneratorCreator, tokenHashOf, type Ports, type UseCases } from "@cahier/domain";
import type { ApiLinks } from "../api/client";
import type { StoredSession } from "../auth/session";
import { inProcessLink } from "./link";

/*
 * The demo's session and transport. The database is made when the page opens, so the session
 * row the server would still hold is gone after a reload; the demo writes it back from the copy
 * the browser kept, for a user the seed knows, with an active membership, while it is live. Then
 * the links call the router in-process with the same context the server builds from a header.
 */

const ids = cryptoIdGeneratorCreator();

/** Puts the stored session back into a fresh database. Answers whether it did. */
export async function restoreSession(ports: Ports, stored: StoredSession, now: Date): Promise<boolean> {
  const expiresAt = new Date(stored.expiresAt);
  if (!(expiresAt.getTime() > now.getTime())) return false;
  const user = await ports.users.findById(stored.user.id);
  if (!user) return false;
  const membership = await ports.memberships.find(stored.workspace.id, user.id);
  if (!membership || membership.status !== "active") return false;
  await ports.sessions.insert({ id: ids.id("ses"), tokenHash: tokenHashOf(stored.token), userId: user.id, workspaceId: stored.workspace.id, createdAt: now, expiresAt });
  return true;
}

/** The links of the demo: every call waits for the database, then runs the procedure here. */
export function demoLinks(useCases: () => Promise<UseCases>, token: string | null): ApiLinks {
  return [
    inProcessLink<AppRouter>({
      router: appRouter,
      createContext: async () => createContext({ useCases: await useCases(), authorization: token ? `Bearer ${token}` : undefined }),
    }),
  ];
}
