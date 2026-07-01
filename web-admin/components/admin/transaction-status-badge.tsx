"use client"

/**
 * TransactionStatusBadge — maps an engine transaction status to a tokenised Badge
 * variant. One canonical mapping reused by the transactions table and the detail
 * drawer (root §13.1 / §13.2). Colour is never the sole signal — the label
 * carries it.
 *
 * A "stuck" in-flight transaction (design §5) prepends a pulsing `currentColor`
 * dot inside the pill to draw the operator's eye to work that needs action.
 */
import { Badge } from "@/components/ui/badge"
import type { AdminTxnStatus } from "@handshake-agent/contracts"

const VARIANT: Record<
  AdminTxnStatus,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  pending: "warn",
  validating: "warn",
  confirmed: "info",
  settling: "warn",
  completed: "success",
  failed: "danger",
  rolled_back: "danger",
  cancelled: "neutral",
}

export function TransactionStatusBadge({
  status,
  stuck = false,
}: {
  status: AdminTxnStatus
  stuck?: boolean
}) {
  return (
    <Badge variant={VARIANT[status]}>
      {stuck && (
        <span
          aria-hidden="true"
          className="size-[5px] animate-hs-pulse rounded-full bg-current"
        />
      )}
      {status}
    </Badge>
  )
}
