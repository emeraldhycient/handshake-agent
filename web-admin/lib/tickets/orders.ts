import type { TicketOrderItem } from "@handshake-agent/contracts"

import { SETTLEMENT_STATUS } from "@/constants/tickets"
import type { TicketOrderStatus } from "@/types/components"

/** Format the canonical NGN decimal string as a "₦45,000.00" amount (never a float). */
export function formatNgn(amount: string): string {
  const n = Number(amount)
  if (Number.isNaN(n)) return amount
  return `₦${n.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Map a settlement status onto the pill; unknown values → neutral in-flight. */
export function orderPillStatus(order: TicketOrderItem): TicketOrderStatus {
  return SETTLEMENT_STATUS[order.settlementStatus] ?? "pending_settlement"
}
