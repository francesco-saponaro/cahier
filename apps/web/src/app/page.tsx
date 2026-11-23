"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "../auth/SessionProvider";
import { homeFor } from "../auth/session";

/** The root only decides where to go: the chat when signed in, the sign-in page otherwise. */
export default function Home() {
  const { session, ready } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (ready) router.replace(session ? homeFor(session.role) : "/sign-in");
  }, [ready, session, router]);
  return null;
}
