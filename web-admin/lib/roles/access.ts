import {
  ADMIN_PERMISSION_CATEGORIES,
  PERMISSION_CATALOG,
  permissionId,
  type AdminPermissionCategory,
  type Role,
} from "@handshake-agent/contracts"

import type { AccessLevel } from "@/types"

/** Catalog entry ids grouped by category, computed once (static constant). */
export const CATALOG_BY_CATEGORY: ReadonlyMap<
  AdminPermissionCategory,
  string[]
> = (() => {
  const map = new Map<AdminPermissionCategory, string[]>()
  for (const entry of PERMISSION_CATALOG) {
    const ids = map.get(entry.category) ?? []
    ids.push(permissionId(entry))
    map.set(entry.category, ids)
  }
  return map
})()

/** Categories that have at least one catalog entry — the matrix rows. */
export const MATRIX_CATEGORIES = ADMIN_PERMISSION_CATEGORIES.filter((c) =>
  CATALOG_BY_CATEGORY.has(c)
)

/**
 * Resolve a role's access level for a category: `full` if it grants any non-read
 * action, `read` if it grants only read actions, else `none`. Read vs. write is
 * inferred from the permission id's trailing `:action` segment.
 */
export function accessLevel(
  role: Role,
  category: AdminPermissionCategory
): AccessLevel {
  const granted = new Set(role.permissionIds)
  const ids = CATALOG_BY_CATEGORY.get(category) ?? []
  let sawRead = false
  for (const id of ids) {
    if (!granted.has(id)) continue
    if (id.endsWith(":read")) sawRead = true
    else return "full"
  }
  return sawRead ? "read" : "none"
}
