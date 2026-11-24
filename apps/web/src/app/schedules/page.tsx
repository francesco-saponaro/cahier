import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireSession } from "../../auth/RequireSession";
import { SchedulesScreen } from "../../screens/schedules/SchedulesScreen";
import { Shell } from "../../ui/Shell";

export const metadata: Metadata = { title: "Schedules · Cahier" };

export default function SchedulesPage() {
  return (
    <RequireSession>
      <Shell title="Schedules">
        <Suspense fallback={null}>
          <SchedulesScreen />
        </Suspense>
      </Shell>
    </RequireSession>
  );
}
