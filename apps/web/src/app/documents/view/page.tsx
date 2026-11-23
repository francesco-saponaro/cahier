import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireSession } from "../../../auth/RequireSession";
import { ViewerScreen } from "../../../screens/documents/ViewerScreen";
import { Shell } from "../../../ui/Shell";

export const metadata: Metadata = { title: "Document · Cahier" };

export default function DocumentViewPage() {
  return (
    <RequireSession>
      <Shell title="Document">
        <Suspense fallback={null}>
          <ViewerScreen />
        </Suspense>
      </Shell>
    </RequireSession>
  );
}
