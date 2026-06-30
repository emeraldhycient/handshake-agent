"use client"

/**
 * TransactionStatusBadge — maps an engine transaction status to a tokenised Badge
 * variant. One canonical mapping reused by the transactions table and the detail
 * drawer (root §13.1 / §13.2). Colour is never the sole signal — the label
 * carries it.
 */
import { Badge } from "@/components/ui/badge"
import type { AdminTxnStatus } from "@handshake-agent/contracts"

const VARIANT: Record<
  AdminTxnStatus,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  pending: "secondary",
  validating: "secondary",
  confirmed: "default",
  settling: "secondary",
  completed: "default",
  failed: "destructive",
  rolled_back: "destructive",
  cancelled: "outline",
}

export function TransactionStatusBadge({ status }: { status: AdminTxnStatus }) {
  return <Badge variant={VARIANT[status]}>{status}</Badge>
}
