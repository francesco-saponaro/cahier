import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireSession } from "../../auth/RequireSession";
import { ChatScreen } from "../../screens/chat/ChatScreen";
import { Shell } from "../../ui/Shell";

export const metadata: Metadata = { title: "Chat · Cahier" };

export default function ChatPage() {
  return (
    <RequireSession>
      <Shell title="Chat">
        <Suspense fallback={null}>
          <ChatScreen />
        </Suspense>
      </Shell>
    </RequireSession>
  );
}
