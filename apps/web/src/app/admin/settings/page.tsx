import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAdmin } from "../../../auth/RequireAdmin";
import { RequireSession } from "../../../auth/RequireSession";
import { SettingsScreen } from "../../../screens/admin/SettingsScreen";
import { Shell } from "../../../ui/Shell";

export const metadata: Metadata = { title: "Settings · Cahier" };

export default function Page() {
  return (
    <RequireSession>
      <RequireAdmin>
        <Shell title="Settings">
          <Suspense fallback={null}>
            <SettingsScreen />
          </Suspense>
        </Shell>
      </RequireAdmin>
    </RequireSession>
  );
}
