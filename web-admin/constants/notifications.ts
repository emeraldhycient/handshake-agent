/**
 * Notifications-console constants (design §6.18). Audience/schedule option sets +
 * the contract-enum → design-label / status-token maps. Colour is never the sole
 * signal — each chip/pill carries its cased label.
 */
import type {
  BroadcastAudience,
  DeliveryLogStatus,
  NotificationChannel,
} from "@handshake-agent/contracts"
import type { BroadcastOption, DeliveryChannel, DeliveryStatus } from "@/types"

/**
 * Human labels for the real `BroadcastAudience` cohorts. NO fabricated reach counts:
 * the SERVER is the sole authority on each cohort's membership + size (§3.5).
 */
export const AUDIENCE_LABEL: Record<BroadcastAudience, string> = {
  all: "All users",
  verified: "All verified users",
  tier_1: "Tier-1 verified users",
  lagos: "Lagos cohort",
}

/**
 * Broad cohorts the composer advises MAY defer to maker-checker — a UX hint only; the
 * SERVER re-resolves the real size and makes the authoritative decision (§3.5).
 */
export const BROAD_AUDIENCES: ReadonlySet<BroadcastAudience> = new Set([
  "all",
  "verified",
])

/** The audience <select> options, in enum order (lagos first as the safe default). */
export const AUDIENCE_OPTIONS: readonly BroadcastOption[] = (
  ["lagos", "tier_1", "verified", "all"] as const
).map((value) => ({ value, label: AUDIENCE_LABEL[value] }))

/** Schedule options — the design's <option>s. */
export const SCHEDULE_OPTIONS: readonly BroadcastOption[] = [
  { value: "now", label: "Send now" },
  { value: "9am", label: "Tomorrow 9:00" },
  { value: "custom", label: "Custom…" },
]

/** The contract's lowercase channel enum → the design's cased chip label. */
export const CHANNEL_LABEL: Record<NotificationChannel, DeliveryChannel> = {
  whatsapp: "WhatsApp",
  email: "Email",
  sms: "SMS",
  in_app: "In-app",
}

/** The contract's lowercase status enum → the design's cased pill label. */
export const STATUS_LABEL: Record<DeliveryLogStatus, DeliveryStatus> = {
  delivered: "Delivered",
  sent: "Sent",
  sending: "Sending",
  bounced: "Bounced",
  failed: "Failed",
}

/** Channel chip → status-token surface + text pair (§5). */
export const CHANNEL_CLASS: Record<DeliveryChannel, string> = {
  WhatsApp: "bg-sok text-tok",
  Email: "bg-sif text-tif",
  SMS: "bg-swn text-twn",
  "In-app": "bg-card2 text-ink2",
}

/** Delivery status pill → status-token surface + text pair (§5). */
export const STATUS_CLASS: Record<DeliveryStatus, string> = {
  Delivered: "bg-sok text-tok",
  Sent: "bg-sok text-tok",
  Queued: "bg-sif text-tif",
  Scheduled: "bg-sif text-tif",
  Sending: "bg-swn text-twn",
  Bounced: "bg-sdn text-tdn",
  Failed: "bg-sdn text-tdn",
}
