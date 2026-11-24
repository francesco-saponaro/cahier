"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "../../api/trpc";

/*
 * The admin's five areas, one route each, as underline tabs on one rule. The share inbox carries
 * its count because it is the one queue that needs action.
 */

const AREAS = [
  { href: "/admin/usage", label: "Usage" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/shares", label: "Share inbox" },
  { href: "/admin/audit", label: "Audit" },
  { href: "/admin/settings", label: "Settings" },
];

export function AdminTabs() {
  const pathname = usePathname();
  const trpc = useTRPC();
  const waiting = useQuery({ ...trpc.admin.shares.inbox.queryOptions({ status: "requested", limit: 50 }), staleTime: 30_000 });
  const count = waiting.data?.items.length ?? 0;
  return (
    <nav className="tabs admin-tabs" aria-label="Admin">
      {AREAS.map((a) => (
        <Link key={a.href} href={a.href} aria-selected={pathname === a.href} aria-current={pathname === a.href ? "page" : undefined}>
          {a.label}
          {a.href === "/admin/shares" && count > 0 ? <span className="count">{count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
