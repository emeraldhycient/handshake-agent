import { NAV_GROUPS } from "@/constants/admin-nav"
import type { NavDestination, NavGroup, NavItem } from "@/types"

/** True iff the item's menu gate is satisfied by the granted `menus`. */
export function itemVisible(menu: NavItem["menu"], menus: string[]): boolean {
  if (menu === null) return true
  if (Array.isArray(menu)) return menu.some((m) => menus.includes(m))
  return menus.includes(menu)
}

/** Whether a nav href is the active route (exact for "/", prefix otherwise). */
export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href)
}

/**
 * The grant-visible nav: each group keeps only its menu-permitted items, and a
 * group is dropped once it has no visible item. Pure — the API still enforces every
 * route (§3.3); this only decides what the sidebar shows.
 */
export function buildVisibleGroups(menus: string[]): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((it) => itemVisible(it.menu, menus)),
  })).filter((group) => group.items.length > 0)
}

/**
 * Flatten grant-visible nav groups into the command palette's search corpus —
 * every reachable screen, tagged with its group. Sourced from the same
 * `visibleGroups` the sidebar renders so the palette can never drift.
 */
export function flattenNav(groups: readonly NavGroup[]): NavDestination[] {
  return groups.flatMap((group) =>
    group.items.map((item) => ({
      href: item.href,
      label: item.label,
      group: group.label,
    }))
  )
}
