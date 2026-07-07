import type { AdminMgmtAccess } from "@/lib/permissions"
import { NEXT_STATUS } from "@/constants/admin-row-actions"
import type { AdminStatusTransition } from "@/types/components"

/**
 * The status transitions to actually offer for an admin row: the per-status set
 * (`NEXT_STATUS`), gated by the operator's `canChangeStatus` permission and the
 * self-lockout guard — an operator can never suspend or offboard their OWN row
 * (they cannot lock themselves out). Purely derived; the API re-enforces all of
 * it server-side (§3.3).
 */
export function buildStatusTransitions(
  status: string,
  access: Pick<AdminMgmtAccess, "canChangeStatus" | "isSelf">
): AdminStatusTransition[] {
  if (!access.canChangeStatus) return []
  return (NEXT_STATUS[status] ?? []).filter(
    (t) =>
      !(
        access.isSelf &&
        (t.status === "suspended" || t.status === "offboarded")
      )
  )
}
