import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import { SessionProvider } from "../auth/SessionProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cahier",
  description: "A team assistant that answers from the team's own documents, with citations that open the page.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body className={GeistSans.className}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
