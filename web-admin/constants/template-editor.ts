import { NotificationChannelSchema } from "@handshake-agent/contracts"

/** The channel select options (the contract's `NotificationChannel` enum). */
export const CHANNELS = NotificationChannelSchema.options

/** Shared textarea styling (§5): min-height ~92px, radius 12, bg-field, 1px border-line. */
export const TEXTAREA_CLASS =
  "min-h-[92px] w-full min-w-0 resize-y rounded-xl border border-line bg-field px-3.5 py-3 text-sm text-ink transition-[color,box-shadow] outline-none placeholder:text-ink3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
