"use client"

/**
 * StatusBadge — maps an admin-user status to a tokenised Badge variant. One
 * canonical mapping reused by the admins table and anywhere a status renders
 * (root §13.1 / §13.2). Colour is never the sole signal — the label carries it.
 */
import { Badge } from "@/components/ui/badge"
import type { AdminUser } from "@handshake-agent/contracts"

type AdminStatus = AdminUser["status"]

// Status → semantic pill (§5 status→token map): active reads as a settled
// success surface, pending as a warning surface, suspended as danger, and an
// offboarded account as a quiet neutral. Colour is never the sole signal — the
// label carries the status.
const VARIANT: Record<
  AdminStatus,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  active: "success",
  pending: "warn",
  suspended: "danger",
  offboarded: "neutral",
}

export function StatusBadge({ status }: { status: AdminStatus }) {
  return <Badge variant={VARIANT[status]}>{status}</Badge>
}
