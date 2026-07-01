"use client"

/**
 * AppShell — the authenticated operator-console chrome (design spec §4):
 * a fixed dark-green sidebar rail + a 60px top bar + an independently
 * scrolling main column.
 *
 * Nav gating (unchanged security model): a nav ITEM renders only when its
 * `menu_item` resourceId is in `adminMe.menus` (UX only; the API still enforces
 * every route). The Dashboard item always shows. A GROUP renders only when it
 * has at least one visible item. Menu map: `menu.metrics` → Metrics;
 * `menu.users` → Users; `menu.kyc` → KYC; `menu.compliance` → Compliance;
 * `menu.transactions` → Transactions; `menu.ledger` → Ledger; `menu.treasury`
 * → Treasury; `menu.beneficiaries` → Beneficiaries; `menu.config` → Settings;
 * `menu.whatsapp` → WhatsApp; `menu.notifications` → Templates; `menu.tickets`
 * → Ticketing; `menu.agent` → Agent; `menu.access` → Admins / Roles / Sessions;
 * `menu.audit` → Audit log.
 *
 * Chrome behaviours:
 * - Sidebar collapse (232px ⇄ 70px) is local UI state.
 * - The theme toggle drives the Zustand theme store (mirrored to the DOM by
 *   `components/theme-provider.tsx`).
 * - The ⌘K search pill, notification bell, and role switcher are the design's
 *   affordances; the palette is a non-functional visual stub for now.
 *
 * Pure presentation + the menu list derived from useAdminMe(); no data writes.
 */
import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  BookText,
  ChevronDown,
  Landmark,
  LayoutGrid,
  List,
  LogOut,
  Mail,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  ScanSearch,
  ScrollText,
  Search,
  Server,
  ShieldCheck,
  ShieldUser,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Ticket,
  Users,
  Vault,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { useAdminMe } from "@/lib/query/hooks"
import { useAdminAuthStore } from "@/lib/store/admin-auth-store"
import { useThemeStore } from "@/lib/store/theme-store"
import { cn } from "@/lib/utils"
import { MfaEnrollDialog } from "@/components/admin/mfa-enroll-dialog"
import type { AppShellProps } from "@/types/components"

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  /**
   * The `menu_item` resourceId that gates this item, or null when it is always
   * shown (only the Dashboard entry is ungated — home degrades gracefully).
   */
  menu: string | null
}

interface NavGroup {
  label: string
  items: readonly NavItem[]
}

/**
 * Design nav groups (§4.1) mapped onto the existing web-admin routes + the
 * live `menu.*` RBAC resourceIds. Every current destination stays reachable;
 * per-item gating is byte-identical to the previous shell — the design only
 * reshapes how items are grouped and iconified.
 */
const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutGrid, menu: null },
      {
        href: "/metrics",
        label: "Metrics",
        icon: BarChart3,
        menu: "menu.metrics",
      },
    ],
  },
  {
    label: "Customers",
    items: [
      { href: "/users", label: "Users", icon: Users, menu: "menu.users" },
    ],
  },
  {
    label: "Compliance",
    items: [
      {
        href: "/kyc",
        label: "KYC review",
        icon: ShieldCheck,
        menu: "menu.kyc",
      },
      {
        href: "/compliance",
        label: "Sanctions & AML",
        icon: ScanSearch,
        menu: "menu.compliance",
      },
    ],
  },
  {
    label: "Money",
    items: [
      {
        href: "/transactions",
        label: "Transactions",
        icon: ArrowLeftRight,
        menu: "menu.transactions",
      },
      { href: "/ledger", label: "Ledger", icon: BookText, menu: "menu.ledger" },
      {
        href: "/treasury",
        label: "Treasury",
        icon: Vault,
        menu: "menu.treasury",
      },
      {
        href: "/beneficiaries",
        label: "Beneficiaries",
        icon: Landmark,
        menu: "menu.beneficiaries",
      },
    ],
  },
  {
    label: "Configuration",
    items: [
      {
        href: "/settings",
        label: "Settings",
        icon: SlidersHorizontal,
        menu: "menu.config",
      },
    ],
  },
  {
    label: "Channels",
    items: [
      {
        href: "/whatsapp",
        label: "WhatsApp",
        icon: MessageSquare,
        menu: "menu.whatsapp",
      },
      {
        href: "/notifications",
        label: "Templates",
        icon: Mail,
        menu: "menu.notifications",
      },
    ],
  },
  {
    label: "Commerce",
    items: [
      {
        href: "/tickets",
        label: "Ticketing",
        icon: Ticket,
        menu: "menu.tickets",
      },
    ],
  },
  {
    label: "Agent",
    items: [
      {
        href: "/agent",
        label: "Agent config",
        icon: Sparkles,
        menu: "menu.agent",
      },
    ],
  },
  {
    label: "Platform",
    items: [
      {
        href: "/admins",
        label: "Admins & roles",
        icon: ShieldUser,
        menu: "menu.access",
      },
      { href: "/roles", label: "Roles", icon: ScrollText, menu: "menu.access" },
      {
        href: "/sessions",
        label: "Sessions",
        icon: Server,
        menu: "menu.access",
      },
      { href: "/audit", label: "Audit log", icon: List, menu: "menu.audit" },
    ],
  },
]

/**
 * The sidebar's fixed dark-green brand gradient (§4.1) — identical in both
 * themes via the brand-green tokens, never `bg-card`.
 */
const RAIL_BG =
  "linear-gradient(168deg, var(--brand-green) 0%, var(--brand-green-deep) 100%)"

/** Striped operator avatar (§4.2 / §1.3). Built from the brand-green token. */
const STRIPE_AVATAR =
  "repeating-linear-gradient(45deg, color-mix(in srgb, var(--brand-green) 72%, white) 0 5px, var(--brand-green) 5px 10px)"

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href)
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()
  const me = useAdminMe()
  const clear = useAdminAuthStore((s) => s.clear)
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggle)

  const [collapsed, setCollapsed] = useState(false)
  const [mfaOpen, setMfaOpen] = useState(false)

  const menus = me.data?.menus ?? []
  // A group renders only when at least one of its items is grant-visible.
  const visibleGroups = NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter(
      (it) => it.menu === null || menus.includes(it.menu)
    ),
  })).filter((group) => group.items.length > 0)

  const ThemeIcon = theme === "light" ? Moon : Sun
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose
  const alertCount = 0

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-ink">
      {/* ── Sidebar rail (§4.1) — dark-green brand gradient in BOTH themes ─────── */}
      <aside
        aria-label="Admin navigation"
        style={{ background: RAIL_BG }}
        className={cn(
          "z-20 flex flex-none flex-col text-sidebar-foreground transition-[width] duration-200 ease-out",
          collapsed ? "w-[70px]" : "w-[232px]"
        )}
      >
        {/* Brand */}
        <div className="flex flex-none items-center gap-[11px] px-[18px] pt-[18px] pb-[14px]">
          <div
            style={{
              background:
                "linear-gradient(150deg, var(--brand-amber), var(--brand-amber-deep))",
            }}
            className="flex size-[34px] flex-none items-center justify-center rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
          >
            <div className="size-[13px] rounded-[4px] bg-brand-green-deep" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-[14.5px] font-bold tracking-[-0.01em] whitespace-nowrap">
                Handshake Agent
              </div>
              <div className="text-[10.5px] font-semibold tracking-[0.06em] text-[color:rgba(214,226,219,0.55)] uppercase">
                Operator Console
              </div>
            </div>
          )}
        </div>

        {/* Nav — RBAC-scoped. Loading/error/empty/data all handled below. */}
        <nav
          aria-busy={me.isLoading}
          className="flex-1 overflow-y-auto px-[10px] pt-[6px] pb-[14px]"
        >
          {me.isLoading ? (
            <ul className="space-y-1.5 px-1 pt-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <li
                  key={i}
                  aria-hidden="true"
                  className="h-9 animate-pulse rounded-[10px] bg-[color:rgba(255,255,255,0.06)]"
                />
              ))}
            </ul>
          ) : me.isError ? (
            <p className="px-2 pt-3 text-[12px] font-medium text-[color:rgba(214,226,219,0.7)]">
              Couldn&apos;t load your navigation. Reload to try again.
            </p>
          ) : visibleGroups.length === 0 ? (
            <p className="px-2 pt-3 text-[12px] font-medium text-[color:rgba(214,226,219,0.7)]">
              No sections available for your role.
            </p>
          ) : (
            visibleGroups.map((group) => (
              <div key={group.label} className="mb-[13px]">
                {!collapsed && (
                  <div className="px-[10px] pt-[2px] pb-[6px] text-[10px] font-bold tracking-[0.09em] text-[color:rgba(214,226,219,0.42)] uppercase">
                    {group.label}
                  </div>
                )}
                <ul>
                  {group.items.map((item) => {
                    const active = isActive(pathname, item.href)
                    const Icon = item.icon
                    return (
                      <li key={item.href} className="mb-px">
                        <Link
                          href={item.href}
                          title={collapsed ? item.label : undefined}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-[11px] rounded-[10px] px-[10px] py-2 transition-colors outline-none",
                            "focus-visible:ring-2 focus-visible:ring-[color:var(--brand-amber)]",
                            active
                              ? "bg-[color:rgba(245,166,35,0.16)] text-[color:var(--brand-amber)]"
                              : "text-sidebar-foreground hover:bg-[color:rgba(255,255,255,0.07)]"
                          )}
                        >
                          <Icon
                            aria-hidden="true"
                            className="size-[18px] flex-none"
                          />
                          {!collapsed && (
                            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                              {item.label}
                            </span>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))
          )}
        </nav>

        {/* Footer: collapse toggle + MFA setup + sign out (§4.1) */}
        <div className="flex-none border-t border-[color:rgba(255,255,255,0.08)] p-[10px]">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            className="flex w-full items-center gap-[10px] rounded-[10px] px-[10px] py-2 text-[color:rgba(214,226,219,0.7)] transition-colors outline-none hover:bg-[color:rgba(255,255,255,0.06)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-amber)]"
          >
            <CollapseIcon
              aria-hidden="true"
              className="size-[17px] flex-none"
            />
            {!collapsed && (
              <span className="text-[12.5px] font-semibold">Collapse</span>
            )}
          </button>

          {/* MFA enrollment — the operator's own security setup, reachable
              from every authenticated page. */}
          {me.data && !me.data.mfaEnabled && (
            <button
              type="button"
              onClick={() => setMfaOpen(true)}
              title={collapsed ? "Set up MFA" : undefined}
              className="mt-1 flex w-full items-center gap-[10px] rounded-[10px] px-[10px] py-2 text-[color:rgba(214,226,219,0.85)] transition-colors outline-none hover:bg-[color:rgba(255,255,255,0.06)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-amber)]"
            >
              <ShieldCheck
                aria-hidden="true"
                className="size-[17px] flex-none"
              />
              {!collapsed && (
                <span className="text-[12.5px] font-semibold">Set up MFA</span>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => clear()}
            aria-label="Sign out"
            title={collapsed ? "Sign out" : undefined}
            className="mt-1 flex w-full items-center gap-[10px] rounded-[10px] px-[10px] py-2 text-[color:rgba(214,226,219,0.7)] transition-colors outline-none hover:bg-[color:rgba(255,255,255,0.06)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-amber)]"
          >
            <LogOut aria-hidden="true" className="size-[17px] flex-none" />
            {!collapsed && (
              <span className="text-[12.5px] font-semibold">Sign out</span>
            )}
          </button>
        </div>
      </aside>

      {/* ── Main column ───────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar (§4.2) */}
        <header className="z-[15] flex h-[60px] flex-none items-center gap-[14px] border-b border-line bg-card px-[22px]">
          {/* ⌘K global search pill (visual stub) */}
          <button
            type="button"
            aria-label="Open command palette"
            className="flex h-[38px] max-w-[440px] flex-1 items-center gap-[10px] rounded-[11px] border border-line bg-field px-[12px] text-ink3 transition-colors outline-none hover:border-[color:var(--ink3)] focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Search aria-hidden="true" className="size-4" />
            <span className="flex-1 truncate text-left text-[13px]">
              Search users, tx, tickets…
            </span>
            <span className="rounded-[6px] border border-line bg-card px-[6px] py-0.5 font-mono text-[11px] font-semibold">
              ⌘K
            </span>
          </button>

          <div className="flex-1" />

          {/* Environment chip — TESTNET, pulsing dot (§4.2) */}
          <div
            title="Environment"
            className="flex h-[32px] items-center gap-[7px] rounded-full bg-[color:var(--warn-muted)] px-[12px] text-[11.5px] font-extrabold tracking-[0.05em] text-[color:var(--warn)]"
          >
            <span className="size-[7px] animate-hs-pulse rounded-full bg-current" />
            TESTNET
          </div>

          {/* Theme toggle → Zustand store (mirrored to the DOM by ThemeProvider) */}
          <button
            type="button"
            onClick={() => toggleTheme()}
            aria-label={
              theme === "light"
                ? "Switch to dark theme"
                : "Switch to light theme"
            }
            className="flex size-[38px] flex-none items-center justify-center rounded-[11px] border border-line text-ink2 transition-colors outline-none hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ThemeIcon aria-hidden="true" className="size-[18px]" />
          </button>

          {/* Notification bell (§4.2) */}
          <button
            type="button"
            aria-label={
              alertCount > 0 ? `Alerts (${alertCount} unread)` : "Alerts"
            }
            className="relative flex size-[38px] flex-none items-center justify-center rounded-[11px] border border-line text-ink2 transition-colors outline-none hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Bell aria-hidden="true" className="size-[18px]" />
            {alertCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-card bg-[color:var(--destructive)] px-1 font-mono text-[10px] font-extrabold text-white tabular-nums">
                {alertCount}
              </span>
            )}
          </button>

          {/* Role / user switcher pill (§4.2) — reuses adminMe email + role */}
          <button
            type="button"
            aria-label="Account menu"
            className="ml-0.5 flex h-[42px] items-center gap-[10px] rounded-full py-0 pr-[6px] pl-[4px] transition-colors outline-none hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span
              aria-hidden="true"
              style={{ background: STRIPE_AVATAR }}
              className="size-[34px] flex-none rounded-full"
            />
            <span className="min-w-0 text-left">
              <span className="block truncate text-[12.5px] font-bold text-ink">
                {me.data?.email ?? "…"}
              </span>
              <span className="flex items-center gap-[5px]">
                <span className="size-[6px] flex-none rounded-full bg-[color:var(--brand-amber)]" />
                <span className="truncate text-[10.5px] font-semibold text-ink2">
                  {me.data?.role.name ?? ""}
                </span>
              </span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-[15px] flex-none text-ink3"
            />
          </button>
        </header>

        {/* Screen area — scrolls independently of the sidebar (§4). */}
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <MfaEnrollDialog open={mfaOpen} onOpenChange={setMfaOpen} />
    </div>
  )
}
