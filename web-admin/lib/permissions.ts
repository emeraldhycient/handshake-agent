/**
 * Admin-management authorization helpers for the console UI. These decide what
 * the signed-in operator may DO to a given admin row; the API re-enforces every
 * one of these server-side (§3.3) — this is UX gating, never the only check.
 */
import type { AdminMe } from "@handshake-agent/contracts"

/**
 * Permission ids gating the per-row admin actions. Each mirrors the api
 * `@RequirePermission(resourceType, resourceId, action)` on the matching route;
 * the id format is `${resourceType}:${resourceId}:${action}`.
 */
export const ADMIN_MGMT_PERMS = {
  changeRole: "api_route:PATCH /admin/admins/:id/role:write",
  changeStatus: "api_route:PATCH /admin/admins/:id/status:write",
  resetMfa: "api_route:POST /admin/admins/:id/mfa/reset:write",
} as const

export interface AdminMgmtAccess {
  /** The target row is the signed-in operator's own account. */
  isSelf: boolean
  canChangeRole: boolean
  /** Holds the status permission. Suspend/offboard on the SELF row is still
   *  filtered per-transition by the caller (you cannot lock yourself out). */
  canChangeStatus: boolean
  /** Reset-2FA for ANOTHER admin. Never for yourself — self-service 2FA is the
   *  MFA-enroll flow, not this admin action. */
  canResetMfa: boolean
}

/**
 * Resolve what `me` (the signed-in operator) may do to the admin `targetAdminId`.
 * An operator with none of the admin-management permissions gets an all-false
 * result — the row renders read-only.
 */
export function adminMgmtAccess(
  me: AdminMe | undefined,
  targetAdminId: string,
): AdminMgmtAccess {
  const permissions = me?.permissions ?? []
  const isSelf = me?.id === targetAdminId
  return {
    isSelf,
    canChangeRole: permissions.includes(ADMIN_MGMT_PERMS.changeRole),
    canChangeStatus: permissions.includes(ADMIN_MGMT_PERMS.changeStatus),
    canResetMfa: permissions.includes(ADMIN_MGMT_PERMS.resetMfa) && !isSelf,
  }
}
