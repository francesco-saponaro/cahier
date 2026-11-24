import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAdmin } from "../../../auth/RequireAdmin";
import { RequireSession } from "../../../auth/RequireSession";
import { MembersScreen } from "../../../screens/admin/MembersScreen";
import { Shell } from "../../../ui/Shell";

export const metadata: Metadata = { title: "Members · Cahier" };

export default function Page() {
  return (
    <RequireSession>
      <RequireAdmin>
        <Shell title="Members">
          <Suspense fallback={null}>
            <MembersScreen />
          </Suspense>
        </Shell>
      </RequireAdmin>
    </RequireSession>
  );
}
