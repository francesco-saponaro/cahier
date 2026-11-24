import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAdmin } from "../../../auth/RequireAdmin";
import { RequireSession } from "../../../auth/RequireSession";
import { AuditScreen } from "../../../screens/admin/AuditScreen";
import { Shell } from "../../../ui/Shell";

export const metadata: Metadata = { title: "Audit log · Cahier" };

export default function Page() {
  return (
    <RequireSession>
      <RequireAdmin>
        <Shell title="Audit log">
          <Suspense fallback={null}>
            <AuditScreen />
          </Suspense>
        </Shell>
      </RequireAdmin>
    </RequireSession>
  );
}
