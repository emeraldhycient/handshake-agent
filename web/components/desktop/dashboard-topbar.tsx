"use client"

import { cn } from "@/lib/utils"
import { useMe } from "@/lib/query/auth"
import { useAuthStore } from "@/lib/store/auth-store"
import { buildGreeting } from "@/lib/greeting"
import { InstallButton } from "@/components/pwa/install-button"
import { TopbarSearch } from "@/components/desktop/topbar/topbar-search"
import { TopbarNotifications } from "@/components/desktop/topbar/topbar-notifications"
import type { DashboardTopbarProps } from "@/types"

/**
 * Desktop dashboard topbar — orchestrator. Renders the greeting and composes the
 * search, install, and notifications controls, each of which owns its own state
 * and data (root §16).
 */
export function DashboardTopbar({
  onSearchSelect,
  onQuickAction,
  className,
}: DashboardTopbarProps) {
  // Prefer the fresh /auth/me query; fall back to the store's in-memory user.
  const { data: meData } = useMe()
  const storeUser = useAuthStore((s) => s.user)
  const user = meData ?? storeUser
  const greeting = buildGreeting(user?.firstName, user?.lastName)

  return (
    <header
      className={cn(
        "relative z-[25] flex h-[66px] flex-none items-center gap-4 border-b border-border bg-card-muted px-[26px]",
        className
      )}
    >
      <div className="flex-1">
        <h1 className="text-[17px] font-bold text-foreground">{greeting}</h1>
      </div>

      <TopbarSearch
        onSearchSelect={onSearchSelect}
        onQuickAction={onQuickAction}
      />

      <InstallButton />

      <TopbarNotifications />
    </header>
  )
}
