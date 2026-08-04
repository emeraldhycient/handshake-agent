/** Ticketing page (§6.21). */

// ─── Ticketing page (design §6.21) ──────────────────────────────────────────────────
// Left panel = Vendor ports (honest shape-gap — no registry endpoint yet); right panel
// = Recent orders, WIRED to `useTicketOrders` (the real engine feed). Read-only display;
// nothing here moves money (§3.1).

/** A recent-order row's settlement status → the canonical status pill (§5 map). */
export type TicketOrderStatus =
  | "settled"
  | "pending_settlement"
  | "refunded"
  | "failed"

/** One "Recent orders" row — ticket type + mono id · user · amount · status pill. */
export interface OrderRowProps {
  order: import("@handshake-agent/contracts").TicketOrderItem
}
