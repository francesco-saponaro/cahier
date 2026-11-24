import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAdmin } from "../../../auth/RequireAdmin";
import { RequireSession } from "../../../auth/RequireSession";
import { InboxScreen } from "../../../screens/admin/InboxScreen";
import { Shell } from "../../../ui/Shell";

export const metadata: Metadata = { title: "Share inbox · Cahier" };

export default function Page() {
  return (
    <RequireSession>
      <RequireAdmin>
        <Shell title="Share inbox">
          <Suspense fallback={null}>
            <InboxScreen />
          </Suspense>
        </Shell>
      </RequireAdmin>
    </RequireSession>
  );
}
