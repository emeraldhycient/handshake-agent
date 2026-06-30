"use client"

/**
 * StatusBadge — maps an admin-user status to a tokenised Badge variant. One
 * canonical mapping reused by the admins table and anywhere a status renders
 * (root §13.1 / §13.2). Colour is never the sole signal — the label carries it.
 */
import { Badge } from "@/components/ui/badge"
import type { AdminUser } from "@handshake-agent/contracts"

type AdminStatus = AdminUser["status"]

const VARIANT: Record<
  AdminStatus,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  active: "default",
  pending: "secondary",
  suspended: "destructive",
  offboarded: "outline",
}

export function StatusBadge({ status }: { status: AdminStatus }) {
  return <Badge variant={VARIANT[status]}>{status}</Badge>
}
