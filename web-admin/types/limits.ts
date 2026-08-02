/** Limits & velocity page (§6.26). */

import type { EffectiveSetting } from "@handshake-agent/contracts"

// ─── Limits & velocity page (design §6.26) ─────────────────────────────────────────
// DESIGN REPRODUCTION (markup docs/design-ref/screens/Limits.html): tier tabs +
// two cards ("Amount caps · {tier}" | "Velocity & counts · {tier}"). The rows are
// the design's own mock content (per-tier NGN caps + counts), not fetched. Editing
// an amount cap is maker-checker — it opens the shared reason → step-up → maker-
// checker flow modals. Real-data reintegration is a separate, later step.

/** The three NGN KYC tiers the registry enumerates (`limits.NGN.<tier>.*`). */
export type LimitTierId = "tier_1" | "tier_2" | "tier_3"

/**
 * How a limit leaf's value is formatted + parsed: a fiat amount (rendered in the
 * selected currency), a plain count, or a duration in seconds. Drives the display
 * string, the edit field label, and the diff.
 */
export type LimitLeafKind = "amount" | "count" | "seconds"

/**
 * The setting leaf backing an editable limit row — its full key + scope (so the write
 * targets the same leaf the read resolved) + its value kind. Present ONLY on rows whose
 * config key exists AND is enforced server-side; a row without one is display-only (a
 * placeholder cap the engine does not enforce is never made editable — root §3.6).
 */
export interface LimitEditLeaf {
  key: string
  scope: EffectiveSetting["scope"]
  scopeValue: string | null
  kind: LimitLeafKind
}

/** One "Amount caps" key/value row (edit pencil opens the maker-checker flow). */
export interface LimitAmountRow {
  /** The cap label shown on the left (e.g. "Per-transaction max"). */
  k: string
  /** The cap value shown on the right (mono/tabular, e.g. "₦200,000"). */
  v: string
  /** Present when the row is backed by an enforced, editable config leaf. */
  edit?: LimitEditLeaf
}

/** One "Velocity & counts" key/value row. Editable when backed by an enforced leaf. */
export interface LimitVelocityRow {
  /** The metric label shown on the left (e.g. "Transactions / day"). */
  k: string
  /** The metric value shown on the right (mono/tabular, e.g. "10"). */
  v: string
  /** Present when the row is backed by an enforced, editable config leaf. */
  edit?: LimitEditLeaf
}

/** A tier tab's full content — its amount caps and velocity/count rows. */
export interface LimitTier {
  id: LimitTierId
  /** The tab label + card suffix (e.g. "Tier 1"). */
  label: string
  amountCaps: readonly LimitAmountRow[]
  velocity: readonly LimitVelocityRow[]
}

/** One key/value limit row — the edit pencil shows only for an enforced, editable leaf. */
export interface LimitLeafRowProps {
  row: LimitAmountRow | LimitVelocityRow
  onEdit: (row: LimitAmountRow | LimitVelocityRow) => void
}

/** The limits data board — tier tabs + currency selector + the amount/velocity cards. */
export interface LimitsBoardProps {
  tiers: readonly LimitTier[]
  tierId: LimitTierId
  onTierChange: (id: LimitTierId) => void
  currencies: readonly string[]
  activeCurrency: string
  onCurrencyChange: (currency: string) => void
  tier: LimitTier
  onEdit: (row: LimitAmountRow | LimitVelocityRow) => void
}
