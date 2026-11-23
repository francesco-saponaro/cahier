"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "./SessionProvider";

/** A screen only a signed-in person sees: with no session it goes to the sign-in page and renders nothing meanwhile. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { session, ready } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (ready && !session) router.replace("/sign-in");
  }, [ready, session, router]);
  if (!ready || !session) return null;
  return <>{children}</>;
}
