import type { AdminStatusTransition } from "@/types/components"

/**
 * The settable status transitions offered per current admin status (only statuses
 * an operator can move an admin *into* — the API re-enforces every transition
 * server-side, §3.3). The self-lockout guard (no suspend/offboard on your own row)
 * is applied on top in `buildStatusTransitions`.
 */
export const NEXT_STATUS: Record<string, AdminStatusTransition[]> = {
  active: [
    { label: "Suspend", status: "suspended" },
    { label: "Offboard", status: "offboarded" },
  ],
  pending: [{ label: "Offboard", status: "offboarded" }],
  suspended: [
    { label: "Reactivate", status: "active" },
    { label: "Offboard", status: "offboarded" },
  ],
  offboarded: [{ label: "Reactivate", status: "active" }],
}
