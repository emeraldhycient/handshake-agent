import type { FlagDefinition } from "@/types/components"

/**
 * The flag rows. `settingKey` bridges the FE flag key → the registry dot-path
 * that backs it; when present, the row's effective `on` is the real value and the
 * toggle persists through the audited settings PATCH. Rows without a `settingKey`
 * have NO backing config — they render read-only ("Not yet wired") with no
 * fabricated rollout/eval claims (there is no cohort/percentage rollout engine).
 */
export const FLAG_DEFS: readonly FlagDefinition[] = [
  {
    key: "voice_notes.web",
    desc: "Accept voice-note input in the web chat composer",
    on: false,
  },
  {
    key: "voice_notes.whatsapp",
    desc: "Transcribe inbound WhatsApp voice notes",
    on: false,
  },
  {
    key: "swap.enabled",
    desc: "Asset-to-asset swap in chat (≥2 enabled assets)",
    rollout: "global · all users",
    on: true,
    settingKey: "catalog.capabilities.crypto.swap",
  },
  {
    key: "ticketing.enabled",
    desc: "Discover and buy event tickets in chat",
    rollout: "global · all users",
    on: false,
    settingKey: "ticketing.enabled",
  },
  {
    key: "beneficiary_flow.whatsapp",
    desc: "Add a beneficiary in-thread via WhatsApp Flow",
    on: false,
  },
  {
    key: "kyc.tier_3",
    desc: "Allow tier-3 KYC upgrade requests",
    on: false,
  },
] as const

/** The soft toggle track/knob dimensions (design markup: 52×30 track, 24px knob). */
export const KNOB_ON = "25px" // 52 − 24 − 3 (right inset matches the 3px left inset)
export const KNOB_OFF = "3px"
