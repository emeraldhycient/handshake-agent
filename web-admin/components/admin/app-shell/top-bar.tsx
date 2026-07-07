"use client"

/**
 * TopBar — the 60px header (§4.2): the ⌘K command-palette search pill, the honest
 * read-only environment chip, the theme toggle (→ Zustand theme store), the alerts
 * bell, and the account pill (real email + role, no view-as impersonation).
 * Presentation only; all state lives in `useAppShell`.
 */
import { Moon, Search as SearchIcon, Sun } from "lucide-react"

import { AccountMenu } from "@/components/admin/account-menu"
import { EnvIndicator } from "@/components/admin/env-indicator"
import { NotificationsMenu } from "@/components/admin/notifications-menu"
import type { TopBarProps } from "@/types/components"

export function TopBar({
  onOpenCmdk,
  theme,
  onToggleTheme,
  email,
  roleLabel,
  onSignOut,
}: TopBarProps) {
  const ThemeIcon = theme === "light" ? Moon : Sun

  return (
    <header className="z-[15] flex h-[60px] flex-none items-center gap-[14px] border-b border-line bg-card px-[22px]">
      {/* ⌘K global search pill → opens the command palette */}
      <button
        type="button"
        onClick={onOpenCmdk}
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
        onClick={onToggleTheme}
        aria-label={
          theme === "light" ? "Switch to dark theme" : "Switch to light theme"
        }
        className="flex size-[38px] flex-none items-center justify-center rounded-[11px] border border-line text-ink2 transition-colors outline-none hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ThemeIcon aria-hidden="true" className="size-[18px]" />
      </button>

      {/* Notification bell → alerts dropdown (§4.2) */}
      <NotificationsMenu />

      {/* Account pill (§4.2) — reuses adminMe email + the operator's REAL role as an
          honest read-only display (no view-as impersonation). */}
      <AccountMenu
        email={email}
        realRoleLabel={roleLabel}
        onSignOut={onSignOut}
      />
    </header>
  )
}
