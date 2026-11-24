"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "./SessionProvider";

/** A screen only an admin sees: a member who lands on it is sent to the chat. The API refuses them anyway; this spares the empty screen. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { session, ready } = useSession();
  const router = useRouter();
  const allowed = session?.role === "admin";
  useEffect(() => {
    if (ready && session && !allowed) router.replace("/chat");
  }, [ready, session, allowed, router]);
  if (!ready || !session || !allowed) return null;
  return <>{children}</>;
}
