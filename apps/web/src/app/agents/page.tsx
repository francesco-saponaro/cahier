import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireSession } from "../../auth/RequireSession";
import { AgentsScreen } from "../../screens/agents/AgentsScreen";
import { Shell } from "../../ui/Shell";

export const metadata: Metadata = { title: "Agents · Cahier" };

export default function AgentsPage() {
  return (
    <RequireSession>
      <Shell title="Agents">
        <Suspense fallback={null}>
          <AgentsScreen />
        </Suspense>
      </Shell>
    </RequireSession>
  );
}
