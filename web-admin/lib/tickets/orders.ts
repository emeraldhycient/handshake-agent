import type { TicketOrderItem } from "@handshake-agent/contracts"

import { SETTLEMENT_STATUS } from "@/constants/tickets"
import type { TicketOrderStatus } from "@/types/components"

/** Map a settlement status onto the pill; unknown values → neutral in-flight. */
export function orderPillStatus(order: TicketOrderItem): TicketOrderStatus {
  return SETTLEMENT_STATUS[order.settlementStatus] ?? "pending_settlement"
}
