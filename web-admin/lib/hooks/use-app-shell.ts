"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"

import { useAdminMe, useNavBadges } from "@/lib/query/hooks"
import { useAdminAuthStore } from "@/lib/store/admin-auth-store"
import { useThemeStore } from "@/lib/store/theme-store"
import { buildVisibleGroups, flattenNav } from "@/lib/nav/admin-nav"

/**
 * View-model for the authenticated shell (AppShellInner). Owns the chrome's local
 * UI state (sidebar collapse, MFA-enroll + command-palette open), the theme store
 * wiring, and the RBAC-scoped nav derived from `useAdminMe().menus` — the sidebar
 * groups + the command-palette destinations come from the same `visibleGroups` so
 * they can never drift. Read-only: the nav gate is UX, the API enforces every route.
 */
export function useAppShell() {
  const pathname = usePathname()
  const me = useAdminMe()
  const clear = useAdminAuthStore((s) => s.clear)
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggle)

  const [collapsed, setCollapsed] = useState(false)
  const [mfaOpen, setMfaOpen] = useState(false)
  const [cmdkOpen, setCmdkOpen] = useState(false)

  const visibleGroups = buildVisibleGroups(me.data?.menus ?? [])
  const destinations = flattenNav(visibleGroups)
  const badges = useNavBadges()

  return {
    pathname,
    me,
    clear,
    theme,
    toggleTheme,
    collapsed,
    toggleCollapsed: () => setCollapsed((v) => !v),
    mfaOpen,
    setMfaOpen,
    cmdkOpen,
    setCmdkOpen,
    visibleGroups,
    destinations,
    badges,
    /** The operator has loaded but hasn't enrolled MFA → offer the setup button. */
    showMfaSetup: !!me.data && !me.data.mfaEnabled,
  }
}
