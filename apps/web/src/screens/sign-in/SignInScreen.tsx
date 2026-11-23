"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTRPCClient } from "../../api/trpc";
import { describe } from "../../api/errors";
import { useSession } from "../../auth/SessionProvider";
import { homeFor } from "../../auth/session";
import { Mark } from "../../ui/Mark";
import { SignInForm, type SignInValues } from "./SignInForm";

export function SignInScreen() {
  const client = useTRPCClient();
  const { session, ready, signIn } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (ready && session) router.replace(homeFor(session.role));
  }, [ready, session, router]);

  async function submit(values: SignInValues): Promise<string | null> {
    try {
      const result = await client.auth.signIn.mutate(values);
      signIn(result);
      router.replace(homeFor(result.role));
      return null;
    } catch (error) {
      const failure = describe(error);
      if (failure.code === "UNAUTHORIZED") return "Wrong email or password.";
      if (failure.code === "TOO_MANY_REQUESTS") return "Too many attempts from this address. Wait a minute and try again.";
      return failure.message;
    }
  }

  return (
    <main className="gate">
      <section className="side">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Mark size={28} />
          <span style={{ fontWeight: 600, fontSize: 18 }}>Cahier</span>
        </div>
        <div>
          <h1>Answers from your team&apos;s own documents, with the page they came from.</h1>
          <p className="muted" style={{ marginTop: 12, maxWidth: 440 }}>
            Keep libraries of handbooks, policies and notes, build agents that read some of them, and ask. Every line of an answer carries a citation that opens the page at the exact passage.
          </p>
        </div>
        <p className="muted small">The demo workspace is Oriel, a fictional company; its documents and people are made up.</p>
      </section>
      <section className="sheet">
        <SignInForm onSubmit={submit} />
      </section>
    </main>
  );
}
