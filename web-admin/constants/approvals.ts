/**
 * Approvals inbox constants (design §6 Approvals). The kind → pill token map and the
 * inline SVG glyph paths. Colour is always paired with the kind's label text, so it is
 * never the sole signal.
 */
import type { ChangeRequestKind } from "@handshake-agent/contracts"

/**
 * Kind → the design's kind-pill token pair (info / warn / success) + a human label.
 *   pricing_change / refund → info
 *   capability_flip / tier_override / manual_credit / broadcast / payout → warn
 */
export const KIND_META: Record<
  ChangeRequestKind,
  { label: string; variant: "info" | "warn" | "success" }
> = {
  pricing_change: { label: "Pricing change", variant: "info" },
  capability_flip: { label: "Capability", variant: "warn" },
  tier_override: { label: "Tier override", variant: "warn" },
  refund: { label: "Refund", variant: "info" },
  manual_credit: { label: "Manual credit", variant: "warn" },
  notification_broadcast: { label: "Broadcast", variant: "warn" },
  payout_release: { label: "Payout release", variant: "warn" },
}

/** The reason box's document glyph (design line 16). */
export const REASON_ICON =
  "M8 10h8M8 14h5M6 4h12a1 1 0 0 1 1 1v14l-4-3H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"

/** The from→to arrow that separates the struck-old value from the new. */
export const DIFF_ARROW = "M5 12h14m0 0-5-5m5 5-5 5"

/** The warning triangle on the "your own request" dual-control guard. */
export const OWN_REQUEST_WARN = "M12 8v5M12 16h.01M12 3l9 16H3z"

/** The inbox-zero checkmark (design line 7). */
export const INBOX_ZERO_CHECK = "m5 12 5 5L20 7"
