import {
  PERMISSION_CATALOG,
  type PermissionCatalogEntry,
} from "@handshake-agent/contracts"

/** The permission catalog grouped by category, computed once (a static constant). */
export const PERMISSION_GROUPS: ReadonlyArray<{
  category: string
  entries: PermissionCatalogEntry[]
}> = (() => {
  const byCategory = new Map<string, PermissionCatalogEntry[]>()
  for (const entry of PERMISSION_CATALOG) {
    const list = byCategory.get(entry.category) ?? []
    list.push(entry)
    byCategory.set(entry.category, list)
  }
  return Array.from(byCategory, ([category, entries]) => ({
    category,
    entries,
  }))
})()
