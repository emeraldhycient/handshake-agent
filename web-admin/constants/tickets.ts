import type { TicketOrderStatus } from "@/types"

/** A subtle placeholder for a missing field (design-consistent). */
export const EM_DASH = "—"

/**
 * The engine's `settlementStatus` → the design's `StatusPill` status. Unknown/other
 * values fold onto a neutral in-flight pill so no row renders without a pill.
 */
export const SETTLEMENT_STATUS: Record<string, TicketOrderStatus> = {
  settled: "settled",
  pending: "pending_settlement",
  pending_settlement: "pending_settlement",
  refunded: "refunded",
  failed: "failed",
}
