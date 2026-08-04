import {
  ADMIN_PERMISSION_CATEGORIES,
  permissionId,
  type AdminPermissionRecord,
  type Role,
} from "@handshake-agent/contracts"

import { ELEVATED_ACTIONS } from "@/constants/role-matrix"
import type { PermissionMatrixLevel, PermissionMatrixRow } from "@/types"

/**
 * The access level a role has for one permission category: `full` when it holds any
 * elevated (write/execute/delete) action there, `read` when it holds only reads, else
 * `none`. `role.permissionIds` are CANONICAL ids (`${resourceType}:${resourceId}:${action}`),
 * so each catalog entry is resolved to the same canonical id.
 */
export function levelFor(
  role: Role,
  category: string,
  permissions: readonly AdminPermissionRecord[]
): PermissionMatrixLevel {
  const granted = new Set(role.permissionIds)
  let hasRead = false
  for (const perm of permissions) {
    if (perm.category !== category) continue
    if (!granted.has(permissionId(perm))) continue
    if (ELEVATED_ACTIONS.has(perm.action)) return "full"
    hasRead = true
  }
  return hasRead ? "read" : "none"
}

/** Format a role name for a column header (snake_case → Title Case). */
export function roleLabel(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

/**
 * Build the matrix rows — one per permission category that appears in the catalog (so the
 * matrix stays in step with whatever surfaces are registered this deploy), each carrying
 * the per-role access level (index-aligned to `roles`).
 */
export function buildMatrixRows(
  roles: readonly Role[],
  permissions: readonly AdminPermissionRecord[]
): PermissionMatrixRow[] {
  const present = new Set(permissions.map((p) => p.category))
  return ADMIN_PERMISSION_CATEGORIES.filter((c) => present.has(c)).map(
    (category) => ({
      label: category,
      cells: roles.map((role) => levelFor(role, category, permissions)),
    })
  )
}
