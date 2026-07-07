import type { NavDestination } from "@/types/components"

/** Case-insensitive substring match on the label (and its group). */
export function matches(dest: NavDestination, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    dest.label.toLowerCase().includes(q) || dest.group.toLowerCase().includes(q)
  )
}

/**
 * The command-palette result list: entity hits (users + transactions — the specific query
 * intent) first, then the matching nav pages. Backend results already carry an in-app
 * href; they render through the same `NavDestination` shape (label + `group` subtitle).
 */
export function buildResults(
  entities: readonly { href: string; label: string; sublabel: string }[],
  destinations: readonly NavDestination[],
  query: string
): NavDestination[] {
  const mapped: NavDestination[] = entities.map((r) => ({
    href: r.href,
    label: r.label,
    group: r.sublabel,
  }))
  return [...mapped, ...destinations.filter((d) => matches(d, query))]
}
