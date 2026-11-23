"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "../api/trpc";
import { useSession } from "../auth/SessionProvider";
import { Initial } from "./Initial";
import { Mark } from "./Mark";

/*
 * The shell: an icon rail on the left with the product's mark at the top and the person at the
 * bottom, the canvas beside it. On a phone the rail folds into a top bar (the screen's name) and
 * a bottom bar of the same destinations with short labels.
 */

const DESTINATIONS = [
  { href: "/chat", label: "Chat", icon: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H9l-5 4v-4A2.5 2.5 0 0 1 4 13.5v-8Z" /> },
  { href: "/libraries", label: "Libraries", icon: <path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l4-1 2 15-4 1z" /> },
  { href: "/agents", label: "Agents", icon: <><rect x="4" y="7" width="16" height="12" rx="2" /><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6" /></> },
];

export function Shell({ title, children }: { title: string; children: ReactNode }) {
  const pathname = usePathname();
  const current = (href: string) => (pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined);
  return (
    <div className="app">
      <aside className="rail">
        <Link href="/chat" className="mark" aria-label="Cahier" data-tip="Cahier">
          <Mark size={24} />
        </Link>
        <nav aria-label="Main">
          {DESTINATIONS.map((d) => (
            <Link key={d.href} href={d.href} className="rail-item" aria-current={current(d.href)} aria-label={d.label} data-tip={d.label}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {d.icon}
              </svg>
            </Link>
          ))}
        </nav>
        <div className="bottom">
          <Account />
        </div>
      </aside>
      <div className="canvas">
        <header className="topbar">
          <span className="brand">
            <Mark size={20} />
            {title}
          </span>
          <Account />
        </header>
        {children}
        <nav className="tabbar" aria-label="Main">
          {DESTINATIONS.map((d) => (
            <Link key={d.href} href={d.href} className="rail-item" aria-current={current(d.href)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {d.icon}
              </svg>
              <span className="label">{d.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

/** The person: an initial that opens their menu (workspace, the others they belong to, sign out). */
function Account() {
  const { session, signOut, replace } = useSession();
  const trpc = useTRPC();
  const client = useTRPCClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const me = useQuery({ ...trpc.auth.me.queryOptions(), enabled: open && Boolean(session) });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!session) return null;

  async function switchTo(workspaceId: string) {
    // The session row is rewritten to the other workspace; the token stays the same.
    const result = await client.auth.switchWorkspace.mutate({ workspaceId });
    replace({ ...session!, workspace: { id: result.workspace.id, slug: result.workspace.slug, name: result.workspace.name }, role: result.role });
    setOpen(false);
    router.push("/chat");
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="rail-item" aria-label={`${session.user.name}, ${session.workspace.name}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Initial id={session.user.id} name={session.user.name} />
      </button>
      {open ? (
        <div className="menu" style={{ bottom: 0, left: "calc(100% + 8px)" }} role="menu">
          <div className="who">
            <div className="name">{session.user.name}</div>
            <div className="muted small">{session.user.email}</div>
            <div className="small" style={{ marginTop: 6 }}>
              {session.workspace.name} · {session.role}
            </div>
          </div>
          {me.data?.workspaces
            .filter((w) => w.id !== session.workspace.id)
            .map((w) => (
              <button key={w.id} type="button" className="menu-item" role="menuitem" onClick={() => switchTo(w.id)}>
                <span>Switch to {w.name}</span>
                <span className="muted small">{w.role}</span>
              </button>
            ))}
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={async () => {
              await signOut();
              router.replace("/sign-in");
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
