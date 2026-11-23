import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireSession } from "../../../auth/RequireSession";
import { BuilderScreen } from "../../../screens/agents/BuilderScreen";
import { Shell } from "../../../ui/Shell";

export const metadata: Metadata = { title: "Agent · Cahier" };

export default function AgentEditPage() {
  return (
    <RequireSession>
      <Shell title="Agent">
        <Suspense fallback={null}>
          <BuilderScreen />
        </Suspense>
      </Shell>
    </RequireSession>
  );
}
