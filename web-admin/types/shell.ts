/** App shell: sidebar rail, nav list, top bar, command palette, route gating, login. */

import type { ReactNode } from "react"

// ─── Shell + gating ──────────────────────────────────────────────────────────────

export interface AppShellProps {
  children: ReactNode
}

/** The permission gate wrapped around the shell's main content (RouteGuard). */
export interface RouteGuardProps {
  children: ReactNode
}

/** The RBAC-scoped sidebar nav list (loading / error / empty / data branches). */
export interface SidebarNavListProps {
  loading: boolean
  error: boolean
  collapsed: boolean
  groups: NavGroup[]
  pathname: string
  badges: NavBadgeCounts
}

/** The sidebar rail: brand + nav list + footer (collapse / MFA setup / sign out). */
export interface SidebarRailProps extends SidebarNavListProps {
  onToggleCollapse: () => void
  /** The operator has loaded but hasn't enrolled MFA → show the setup button. */
  showMfaSetup: boolean
  onOpenMfa: () => void
  onSignOut: () => void
}

/** The top bar: command-palette pill + env chip + theme toggle + alerts + account. */
export interface TopBarProps {
  onOpenCmdk: () => void
  theme: "light" | "dark"
  onToggleTheme: () => void
  email: string
  roleLabel: string
  onSignOut: () => void
}

// ─── Topbar controls (command palette / notifications / account) ────────────────

/** One sidebar nav item — its route, label, icon, RBAC menu gate, and optional badge. */
export interface NavItem {
  href: string
  label: string
  icon: import("lucide-react").LucideIcon
  /**
   * The `menu_item` resourceId(s) that gate this item. `null` → always shown
   * (Dashboard + Admin settings degrade gracefully). When an array, the item
   * shows if ANY listed menu is granted.
   */
  menu: string | string[] | null
  /** Optional count badge key resolved by the shell (design §4.1). */
  badge?: "kyc" | "stuck" | "recon" | "approvals"
}

/** One labelled sidebar nav group — renders only when it has ≥1 visible item. */
export interface NavGroup {
  label: string
  items: readonly NavItem[]
}

/**
 * A flattened, navigable destination sourced from the shell's nav groups —
 * the command palette's search corpus (every reachable screen).
 */
export interface NavDestination {
  href: string
  label: string
  group: string
}

export interface CommandPaletteProps {
  /** Controlled open state — driven by the search pill + the ⌘K shortcut. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The navigable destinations to search (the shell's flattened nav). */
  destinations: readonly NavDestination[]
}

/** One command-palette result option — label + group subtitle + the enter glyph. */
export interface CommandResultProps {
  dest: NavDestination
  isActive: boolean
  /** Highlight this option (on mouse move). */
  onActivate: () => void
  /** Navigate to this option (on click). */
  onSelect: () => void
}

/** The four alert-pip badges the sidebar can show on a nav item. */
export type NavBadgeKey = "kyc" | "stuck" | "recon" | "approvals"

/**
 * Live counts for the sidebar nav-item alert pips, keyed by badge. Sourced from
 * the real read endpoints (KYC review-queue depth / stuck-transaction count /
 * open reconciliation breaks / maker-checker requests awaiting the caller) — the
 * design's hardcoded counts are gone. A `0` renders no pip.
 */
export type NavBadgeCounts = Record<NavBadgeKey, number>

export interface AccountMenuProps {
  /** The signed-in operator's email (from `useAdminMe`). */
  email: string
  /**
   * The operator's real role label (from `useAdminMe`), shown as an honest
   * read-only display on the account pill. There is no view-as impersonation
   * switcher — the console never re-scopes to another role client-side.
   */
  realRoleLabel: string
  /** Sign the operator out (the shell's auth-store `clear`). */
  onSignOut: () => void
}

export interface LoginFormProps {
  className?: string
}
