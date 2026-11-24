import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAdmin } from "../../../auth/RequireAdmin";
import { RequireSession } from "../../../auth/RequireSession";
import { UsageScreen } from "../../../screens/admin/UsageScreen";
import { Shell } from "../../../ui/Shell";

export const metadata: Metadata = { title: "Usage · Cahier" };

export default function Page() {
  return (
    <RequireSession>
      <RequireAdmin>
        <Shell title="Usage">
          <Suspense fallback={null}>
            <UsageScreen />
          </Suspense>
        </Shell>
      </RequireAdmin>
    </RequireSession>
  );
}
