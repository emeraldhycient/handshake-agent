/** WhatsApp page (§6.20). */

import type { ReactNode } from "react"

// ─── WhatsApp page (design §6.20) ────────────────────────────────────────────────────
// The "Number & webhook health" card is WIRED to `useWhatsAppConfig` (GET
// /admin/whatsapp/config): the non-secret Cloud-API / Flows wiring + boolean
// secret-PRESENCE flags. Secret VALUES never cross the boundary (root CLAUDE.md §3.5):
// the presence rows render "Set" / "Not set", never a plaintext secret. The Flows
// registry + conversation monitor have no read endpoint yet (honest shape-gap notes).

/** One "Number & webhook health" key/value row (label + tinted mono value). */
export interface WhatsAppHealthRow {
  /** The row label (e.g. "Graph version", "App secret"). */
  label: string
  /** The rendered value (mono) — an id/version or "Set" / "Not set" for secrets. */
  value: string
  /**
   * Health tone — drives the mono value's text token (design per-row `fg`). `ok` =
   * present/healthy (`text-tok`), `warn` = a secret that isn't set / degraded
   * (`text-twn`), `neutral` = a plain wiring value (`text-ink`).
   */
  tone: "ok" | "warn" | "neutral"
}

/** One key/value health row — label + tinted mono value. */
export interface WhatsAppHealthRowProps {
  row: WhatsAppHealthRow
}

/** An honest shape-gap note for a panel whose backing read endpoint does not exist yet. */
export interface ShapeGapNoteProps {
  title: string
  /** The explanatory copy (may embed an inline link to the real surface). */
  children: ReactNode
}
