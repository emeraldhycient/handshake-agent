import type { FlagDefinition } from "@/types/components"

/**
 * The design's flag rows. `settingKey` bridges the FE flag key → the registry dot-path
 * that backs it; when present, the row's effective `on` is the real value. Rows without
 * a `settingKey` keep their design-faithful `on` (a shapeGap). `rollout` is always
 * design-faithful (no cohort/percentage rollout engine — shapeGap).
 */
export const FLAG_DEFS: readonly FlagDefinition[] = [
  {
    key: "voice_notes.web",
    desc: "Accept voice-note input in the web chat composer",
    rollout: "100% · all users",
    on: true,
  },
  {
    key: "voice_notes.whatsapp",
    desc: "Transcribe inbound WhatsApp voice notes",
    rollout: "100% · all users",
    on: true,
  },
  {
    key: "swap.enabled",
    desc: "Asset-to-asset swap in chat (≥2 enabled assets)",
    rollout: "gradual · 25% cohort",
    on: true,
    settingKey: "catalog.capabilities.crypto.swap",
  },
  {
    key: "ticketing.enabled",
    desc: "Discover and buy event tickets in chat",
    rollout: "cohort · early access",
    on: false,
    settingKey: "ticketing.enabled",
  },
  {
    key: "beneficiary_flow.whatsapp",
    desc: "Add a beneficiary in-thread via WhatsApp Flow",
    rollout: "gradual · 50% cohort",
    on: true,
  },
  {
    key: "kyc.tier_3",
    desc: "Allow tier-3 KYC upgrade requests",
    rollout: "cohort · pilot users",
    on: false,
  },
] as const

/** The soft toggle track/knob dimensions (design markup: 52×30 track, 24px knob). */
export const KNOB_ON = "25px" // 52 − 24 − 3 (right inset matches the 3px left inset)
export const KNOB_OFF = "3px"
