/** Notifications & comms page (§6.18) — broadcasts + delivery log. */

// ─── Notifications & comms page (design §6.18) ──────────────────────────────────────
// No broadcast / delivery-log endpoint exists yet, so the composer's audience and
// schedule options and the delivery log are design-faithful: these shapes describe
// the component's local sample content, not a contracts DTO. (The TEMPLATE select
// is wired to the real notification-templates hook when it resolves.)

/** A broadcast composer <select> option (audience cohort / schedule). */
export interface BroadcastOption {
  value: string
  label: string
}

/**
 * The delivery channel a broadcast went out on — selects the channel chip's
 * status-token color pair (WhatsApp=success, Email=info, SMS=warn, In-app=neutral).
 */
export type DeliveryChannel = "WhatsApp" | "Email" | "SMS" | "In-app"

/**
 * A delivery-log entry's terminal state — selects the trailing status pill's
 * status-token color pair (Delivered/Sent=success, Queued/Scheduled=info,
 * Sending=warn, Bounced/Failed=danger).
 */
export type DeliveryStatus =
  | "Delivered"
  | "Sent"
  | "Queued"
  | "Scheduled"
  | "Sending"
  | "Bounced"
  | "Failed"

/** One row in the read-only delivery log (channel chip + name + event·time + status pill). */
export interface DeliveryRowProps {
  entry: import("@handshake-agent/contracts").DeliveryLogEntry
}
