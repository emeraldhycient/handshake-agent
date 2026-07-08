import type { NotificationChannel } from "@handshake-agent/contracts"

/**
 * Channel chip → status-token surface + text pair (§5). The design surfaces WhatsApp
 * (success) + Email (info); the contract's `NotificationChannel` also carries SMS
 * (warn) and in-app (neutral), rendered gracefully with the same token vocabulary.
 */
export const CHANNEL_CLASS: Record<NotificationChannel, string> = {
  whatsapp: "bg-sok text-tok",
  email: "bg-sif text-tif",
  sms: "bg-swn text-twn",
  in_app: "bg-card2 text-ink2",
}

/** Human channel label for the chip (contract enum → design casing). */
export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  sms: "SMS",
  in_app: "In-app",
}
