import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireSession } from "../../../auth/RequireSession";
import { LibraryScreen } from "../../../screens/libraries/LibraryScreen";
import { Shell } from "../../../ui/Shell";

export const metadata: Metadata = { title: "Library · Cahier" };

export default function LibraryPage() {
  return (
    <RequireSession>
      <Shell title="Library">
        <Suspense fallback={null}>
          <LibraryScreen />
        </Suspense>
      </Shell>
    </RequireSession>
  );
}
