"use client";

import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SignedIn } from "@cahier/domain";
import { createApiClient, linksFor } from "../api/client";
import { isUnauthorized } from "../api/errors";
import { TRPCProvider } from "../api/trpc";
import { browserStorage, clearSession, readSession, writeSession, type StoredSession } from "./session";

/*
 * Who is signed in, for the whole app: the stored session, a tRPC client built with its token,
 * and a query client that forgets everything when the person changes. An UNAUTHORIZED answer
 * from any call drops the session, so a suspended member or an expired token lands on the
 * sign-in page on the next screen.
 */

interface SessionContextValue {
  session: StoredSession | null;
  /** True until the storage has been read, so a screen never redirects on the first render. */
  ready: boolean;
  signIn: (result: SignedIn) => void;
  signOut: () => Promise<void>;
  replace: (session: StoredSession) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function toStored(result: SignedIn): StoredSession {
  return {
    token: result.token,
    expiresAt: result.expiresAt.toISOString(),
    user: { id: result.user.id, name: result.user.name, email: result.user.email },
    workspace: { id: result.workspace.id, slug: result.workspace.slug, name: result.workspace.name },
    role: result.role,
  };
}

export function SessionProvider({ children, initial }: { children: ReactNode; initial?: StoredSession | null }) {
  const [session, setSession] = useState<StoredSession | null>(initial ?? null);
  const [ready, setReady] = useState(initial !== undefined);

  useEffect(() => {
    if (initial !== undefined) return;
    setSession(readSession(browserStorage(), new Date()));
    setReady(true);
  }, [initial]);

  const drop = useCallback(() => {
    clearSession(browserStorage());
    setSession(null);
  }, []);

  // One query client per token: when the person changes, nothing of the previous one is kept.
  const token = session?.token ?? null;
  const queryClient = useMemo(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: (error) => isUnauthorized(error) && drop() }),
        defaultOptions: { queries: { retry: (count, error) => !isUnauthorized(error) && count < 2, staleTime: 5_000, refetchOnWindowFocus: false } },
      }),
    [drop, token],
  );
  const client = useMemo(() => createApiClient(linksFor(token)), [token]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      ready,
      signIn: (result) => {
        const stored = toStored(result);
        writeSession(browserStorage(), stored);
        setSession(stored);
      },
      replace: (next) => {
        writeSession(browserStorage(), next);
        setSession(next);
      },
      signOut: async () => {
        try {
          await client.auth.signOut.mutate();
        } catch {
          // The row may be gone already; the local copy goes either way.
        }
        drop();
      },
    }),
    [session, ready, client, drop],
  );

  return (
    <SessionContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={client} queryClient={queryClient}>
          {children}
        </TRPCProvider>
      </QueryClientProvider>
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession needs a SessionProvider");
  return value;
}
