"use client"

/**
 * AppShell — the authenticated operator-console chrome (design spec §4):
 * a fixed dark-green sidebar rail + a 60px top bar + an independently
 * scrolling main column. Rebuilt 1:1 against `docs/design-ref/chrome.html`.
 *
 * Nav (§4.1): the design's full grouped nav — Overview / Customers / Compliance
 * / Money / Configuration / Channels / Commerce / Agent / Platform. A nav ITEM
 * renders only when its `menu_item` resourceId is in `adminMe.menus` (UX only;
 * the API still enforces every route). Dashboard + Admin settings are always
 * shown. A GROUP renders only when it has at least one visible item.
 *
 * Menu map (existing `menu.*` resourceIds, reused verbatim):
 *   Dashboard/Admin-settings → always · Users → menu.users ·
 *   KYC/Sanctions/AML/Blocked → menu.kyc | menu.compliance ·
 *   Transactions/Reconciliation → menu.transactions · Ledger → menu.ledger ·
 *   Treasury → menu.treasury ·
 *   Settings/Pricing/Limits/Capabilities/Assets/Currencies/Providers/Flags →
 *     menu.config · Templates/Notifications → menu.notifications ·
 *   WhatsApp → menu.whatsapp · Ticketing → menu.tickets · Agent → menu.agent ·
 *   Admins/Approvals → menu.access · Audit/Ops → menu.audit.
 *
 * Chrome behaviours:
 * - Sidebar collapse (232px ⇄ 70px) is local UI state.
 * - The theme toggle drives the Zustand theme store (mirrored to the DOM by
 *   `components/theme-provider.tsx`).
 * - The ⌘K search pill opens a CommandPalette over the shell's own nav; the
 *   bell opens a NotificationsMenu; the account pill opens an AccountMenu that
 *   shows the operator's real email + role (honest read-only, no impersonation).
 * - The KYC-review nav badge is wired to the live queue count; the other design
 *   badges (stuck txns / recon breaks / approvals) have no count endpoint yet.
 *
 * Pure presentation + the menu list derived from useAdminMe(); no data writes.
 */
import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ArrowLeftRight,
  Ban,
  Banknote,
  Bell,
  BookText,
  Cable,
  CircleCheckBig,
  Coins,
  Flag,
  Gauge,
  LayoutGrid,
  LineChart,
  List,
  LogOut,
  Mail,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Scale,
  ScanSearch,
  Search as SearchIcon,
  Server,
  Settings,
  ShieldCheck,
  ShieldUser,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Tag,
  Ticket,
  TriangleAlert,
  Users,
  Vault,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { useAdminMe, useNavBadges } from "@/lib/query/hooks"
import { useRequireAuth } from "@/lib/hooks/use-require-auth"
import { useAdminAuthStore } from "@/lib/store/admin-auth-store"
import { useThemeStore } from "@/lib/store/theme-store"
import { cn } from "@/lib/utils"
import { AccountMenu } from "@/components/admin/account-menu"
import { CommandPalette } from "@/components/admin/command-palette"
import { EnvIndicator } from "@/components/admin/env-indicator"
import { MfaEnrollDialog } from "@/components/admin/mfa-enroll-dialog"
import { NotificationsMenu } from "@/components/admin/notifications-menu"
import { RouteGuard } from "@/components/admin/route-guard"
import { Toaster } from "@/components/shared/toaster"
import type { AppShellProps, NavDestination } from "@/types/components"

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  /**
   * The `menu_item` resourceId(s) that gate this item. `null` → always shown
   * (Dashboard + Admin settings degrade gracefully). When an array, the item
   * shows if ANY listed menu is granted.
   */
  menu: string | string[] | null
  /** Optional count badge key resolved in the component (design §4.1). */
  badge?: "kyc" | "stuck" | "recon" | "approvals"
}

interface NavGroup {
  label: string
  items: readonly NavItem[]
}

/**
 * Design nav groups (§4.1) mapped onto the web-admin routes + the live `menu.*`
 * RBAC resourceIds. Every destination in the design is present; per-item gating
 * reuses the existing menu resourceIds (no new perms minted).
 */
const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutGrid, menu: null },
      {
        href: "/metrics",
        label: "Metrics & analytics",
        icon: LineChart,
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
        menu: ["menu.kyc", "menu.compliance"],
        badge: "kyc",
      },
      {
        href: "/sanctions",
        label: "Sanctions & screening",
        icon: ScanSearch,
        menu: ["menu.kyc", "menu.compliance"],
      },
      {
        href: "/aml",
        label: "AML / risk",
        icon: TriangleAlert,
        menu: ["menu.kyc", "menu.compliance"],
      },
      {
        href: "/blocked",
        label: "Blocked list",
        icon: Ban,
        menu: ["menu.kyc", "menu.compliance"],
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
        badge: "stuck",
      },
      { href: "/ledger", label: "Ledger", icon: BookText, menu: "menu.ledger" },
      {
        href: "/reconciliation",
        label: "Reconciliation",
        icon: Scale,
        menu: "menu.transactions",
        badge: "recon",
      },
      {
        href: "/treasury",
        label: "Treasury",
        icon: Vault,
        menu: "menu.treasury",
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
      { href: "/pricing", label: "Pricing", icon: Tag, menu: "menu.config" },
      {
        href: "/limits",
        label: "Limits & velocity",
        icon: Gauge,
        menu: "menu.config",
      },
      {
        href: "/capabilities",
        label: "Capabilities",
        icon: Plug,
        menu: "menu.config",
      },
      {
        href: "/assets",
        label: "Asset catalog",
        icon: Coins,
        menu: "menu.config",
      },
      {
        href: "/currencies",
        label: "Currency catalog",
        icon: Banknote,
        menu: "menu.config",
      },
      {
        href: "/providers",
        label: "Providers",
        icon: Cable,
        menu: "menu.config",
      },
      {
        href: "/templates",
        label: "Templates",
        icon: Mail,
        menu: "menu.notifications",
      },
      {
        href: "/flags",
        label: "Feature flags",
        icon: Flag,
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
        label: "Notifications",
        icon: Bell,
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
      { href: "/audit", label: "Audit log", icon: List, menu: "menu.audit" },
      {
        href: "/approvals",
        label: "Approvals",
        icon: CircleCheckBig,
        menu: "menu.access",
        badge: "approvals",
      },
      { href: "/ops", label: "System / ops", icon: Server, menu: "menu.audit" },
      {
        href: "/admin-settings",
        label: "Admin settings",
        icon: Settings,
        menu: null,
      },
    ],
  },
]

/**
 * The sidebar's fixed dark-green brand gradient (§4.1) — identical in both
 * themes via the brand-green tokens, never `bg-card`.
 */
const RAIL_BG =
  "linear-gradient(168deg, var(--brand-green) 0%, var(--brand-green-deep) 100%)"

/** True iff the item's menu gate is satisfied by the granted `menus`. */
function itemVisible(menu: NavItem["menu"], menus: string[]): boolean {
  if (menu === null) return true
  if (Array.isArray(menu)) return menu.some((m) => menus.includes(m))
  return menus.includes(menu)
}

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href)
}

/**
 * Flatten grant-visible nav groups into the command palette's search corpus —
 * every reachable screen, tagged with its group for context. Sourced from the
 * same `visibleGroups` the sidebar renders so the palette can never drift.
 */
function flattenNav(
  groups: { label: string; items: readonly NavItem[] }[]
): NavDestination[] {
  return groups.flatMap((group) =>
    group.items.map((item) => ({
      href: item.href,
      label: item.label,
      group: group.label,
    }))
  )
}

/**
 * The centralized admin guard: authentication runs here (before ANY chrome or data
 * hooks mount), so an unauthenticated visitor is redirected to /login and never
 * fires an admin API call. Once authenticated, AppShellInner renders the chrome and
 * gates the page body by route permission via RouteGuard. Every authenticated screen
 * renders through here, so both checks run on every page load.
 */
export function AppShell({ children }: AppShellProps) {
  const authPhase = useRequireAuth()
  if (authPhase !== "authenticated") return null
  return <AppShellInner>{children}</AppShellInner>
}

function AppShellInner({ children }: AppShellProps) {
  const pathname = usePathname()
  const me = useAdminMe()
  const clear = useAdminAuthStore((s) => s.clear)
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggle)

  const [collapsed, setCollapsed] = useState(false)
  const [mfaOpen, setMfaOpen] = useState(false)
  const [cmdkOpen, setCmdkOpen] = useState(false)

  const menus = me.data?.menus ?? []
  // A group renders only when at least one of its items is grant-visible.
  const visibleGroups = NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((it) => itemVisible(it.menu, menus)),
  })).filter((group) => group.items.length > 0)

  // The command palette searches the same grant-visible screens the sidebar shows.
  const destinations = flattenNav(visibleGroups)

  // Live nav-badge counts (§4.1) — KYC review-queue depth / stuck txns / open
  // recon breaks / approvals awaiting me, each from its real read endpoint.
  const badges = useNavBadges()

  const ThemeIcon = theme === "light" ? Moon : Sun
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose

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
                    const badge = item.badge ? (badges[item.badge] ?? 0) : 0
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
                          {!collapsed && badge > 0 && (
                            <span className="flex-none rounded-full bg-[color:var(--brand-amber)] px-[7px] py-px text-center text-[10.5px] font-bold text-[color:var(--brand-green-deep)] tabular-nums">
                              {badge}
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
          {/* ⌘K global search pill → opens the command palette */}
          <button
            type="button"
            onClick={() => setCmdkOpen(true)}
            aria-label="Open command palette"
            aria-keyshortcuts="Meta+K Control+K"
            className="flex h-[38px] max-w-[440px] flex-1 items-center gap-[10px] rounded-[11px] border border-line bg-field px-[12px] text-ink3 transition-colors outline-none hover:border-[color:var(--ink3)] focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <SearchIcon aria-hidden="true" className="size-4" />
            <span className="flex-1 truncate text-left text-[13px]">
              Search users, tx, tickets…
            </span>
            <span className="rounded-[6px] border border-line bg-card px-[6px] py-0.5 font-mono text-[11px] font-semibold">
              ⌘K
            </span>
          </button>

          <div className="flex-1" />

          {/* Environment chip — TESTNET, honest read-only popover (§4.2) */}
          <EnvIndicator />

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

          {/* Notification bell → alerts dropdown (§4.2) */}
          <NotificationsMenu />

          {/* Account pill (§4.2) — reuses adminMe email + the operator's REAL
              role as an honest read-only display (no view-as impersonation). */}
          <AccountMenu
            email={me.data?.email ?? ""}
            realRoleLabel={me.data?.role.name ?? ""}
            onSignOut={clear}
          />
        </header>

        {/* Screen area — scrolls independently of the sidebar (§4). */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          <RouteGuard>{children}</RouteGuard>
        </main>
      </div>

      {/* ⌘K command palette — opened by the search pill or the global shortcut. */}
      <CommandPalette
        open={cmdkOpen}
        onOpenChange={setCmdkOpen}
        destinations={destinations}
      />

      <MfaEnrollDialog open={mfaOpen} onOpenChange={setMfaOpen} />

      {/* Global toast stack — read-shaped action confirmations (§5, design toast). */}
      <Toaster />
    </div>
  )
}
