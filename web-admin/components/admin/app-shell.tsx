"use client"

/**
 * AppShell — the authenticated admin chrome: a left sidebar nav + the page body.
 *
 * Nav gating: a nav GROUP renders only when its `menu_item` resourceId is in
 * `adminMe.menus` (UX only; the API still enforces every route). The dashboard
 * link always shows. `menu.access` → the Access group (Admins / Roles /
 * Sessions); `menu.users` → the Users group; `menu.kyc` → the KYC group;
 * `menu.transactions` → Transactions; `menu.ledger` → Ledger; `menu.compliance`
 * → Compliance; `menu.treasury` → Treasury; `menu.beneficiaries` →
 * Beneficiaries; `menu.audit` → the Audit group; `menu.config` → the Config
 * group (Settings).
 *
 * Pure presentation + the menu list derived from useAdminMe(); no data writes.
 */
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LogOut } from "lucide-react"

import { useAdminMe } from "@/lib/query/hooks"
import { useAdminAuthStore } from "@/lib/store/admin-auth-store"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { AppShellProps } from "@/types/components"

interface NavItem {
  href: string
  label: string
}

interface NavGroup {
  /** The `menu_item` resourceId that gates this group (null = always shown). */
  menu: string | null
  label: string
  items: NavItem[]
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    menu: null,
    label: "",
    items: [{ href: "/", label: "Dashboard" }],
  },
  {
    menu: "menu.access",
    label: "Access",
    items: [
      { href: "/admins", label: "Admins" },
      { href: "/roles", label: "Roles & permissions" },
      { href: "/sessions", label: "Sessions" },
    ],
  },
  {
    menu: "menu.users",
    label: "Users",
    items: [{ href: "/users", label: "Users" }],
  },
  {
    menu: "menu.kyc",
    label: "KYC",
    items: [{ href: "/kyc", label: "KYC review" }],
  },
  {
    menu: "menu.transactions",
    label: "Transactions",
    items: [{ href: "/transactions", label: "Transactions" }],
  },
  {
    menu: "menu.ledger",
    label: "Ledger",
    items: [{ href: "/ledger", label: "Ledger" }],
  },
  {
    menu: "menu.compliance",
    label: "Compliance",
    items: [{ href: "/compliance", label: "Compliance" }],
  },
  {
    menu: "menu.treasury",
    label: "Treasury",
    items: [{ href: "/treasury", label: "Treasury" }],
  },
  {
    menu: "menu.beneficiaries",
    label: "Beneficiaries",
    items: [{ href: "/beneficiaries", label: "Beneficiaries" }],
  },
  {
    menu: "menu.audit",
    label: "Audit",
    items: [{ href: "/audit", label: "Audit log" }],
  },
  {
    menu: "menu.config",
    label: "Config",
    items: [{ href: "/settings", label: "Settings" }],
  },
]

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()
  const me = useAdminMe()
  const clear = useAdminAuthStore((s) => s.clear)

  const menus = me.data?.menus ?? []
  const visibleGroups = NAV_GROUPS.filter(
    (g) => g.menu === null || menus.includes(g.menu)
  )

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside
        aria-label="Admin navigation"
        className="flex w-60 flex-none flex-col border-r border-border bg-card"
      >
        <div className="flex h-14 items-center border-b border-border px-5">
          <span className="text-sm font-extrabold tracking-tight">
            Handshake Admin
          </span>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto p-3">
          {visibleGroups.map((group) => (
            <div key={group.menu ?? "root"}>
              {group.label && (
                <p className="mb-1.5 px-2 text-[10.5px] font-bold tracking-widest text-muted-foreground uppercase">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href)
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "block rounded-md px-2.5 py-2 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "text-foreground hover:bg-muted"
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* ── Footer: identity + sign out ────────────────────────────────────── */}
        <div className="border-t border-border p-3">
          {me.data && (
            <div className="mb-2 px-2">
              <p className="truncate text-xs font-semibold text-foreground">
                {me.data.email}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {me.data.role.name}
              </p>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => clear()}
            aria-label="Sign out"
          >
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* ── Page body ────────────────────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  )
}
