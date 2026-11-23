import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireSession } from "../../auth/RequireSession";
import { LibrariesScreen } from "../../screens/libraries/LibrariesScreen";
import { Shell } from "../../ui/Shell";

export const metadata: Metadata = { title: "Libraries · Cahier" };

export default function LibrariesPage() {
  return (
    <RequireSession>
      <Shell title="Libraries">
        <Suspense fallback={null}>
          <LibrariesScreen />
        </Suspense>
      </Shell>
    </RequireSession>
  );
}
