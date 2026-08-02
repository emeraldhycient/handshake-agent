/** Treasury page (§6.13) — balances, sweeps, payout queue, cooling-off. */

import type { TreasuryAlert } from "@handshake-agent/contracts"

// ─── Treasury writes (§6.13) ────────────────────────────────────────────────────────

export interface TreasuryAlertAcknowledgeProps {
  /** The threshold-breach alert to acknowledge (captures an audited note). */
  alert: TreasuryAlert
}

// ─── Treasury page (design §6.13) ─────────────────────────────────────────────────
// The 4-up balance-card row is a mix of a real aggregated-custodial hero (from
// `useTreasuryBalances`) and design-faithful fiat-float / FX-position tiles (no
// dedicated endpoint yet). One descriptor drives every tile so the row renders
// uniformly.

/** How a balance tile is tinted — `hero` = the dark-green custodial gradient. */
export type TreasuryCardTone = "hero" | "neutral"

/** A resolved balance-card descriptor for the design's 4-up tile row. */
export interface TreasuryCard {
  /** Stable key + a11y label root (e.g. "custodial-usdt"). */
  id: string
  tone: TreasuryCardTone
  /** Eyebrow label ("Custodial · USDT"). */
  label: string
  /** The big mono/tabular figure. */
  value: string
  /** Health-dot semantic — drives the dot colour and reads with the note. */
  dot: "ok" | "warn" | "danger"
  /** Sub-note line under the dot. */
  note: string
  /** True when the figure comes from a live query; false = design-faithful. */
  live: boolean
}

/**
 * One child-address sweep row (design §6.13 "Child-address sweeps"). The backing
 * data is a withdrawal-policy's wallet id; on-chain balance + sweep status have no
 * endpoint yet, so those two fields are design-faithful representative content.
 */
export interface TreasurySweepRow {
  id: string
  /** The (truncated) child on-chain address, rendered mono. */
  addr: string
  /** Design-faithful on-chain balance (mono / tabular). */
  bal: string
  /** Sweep lifecycle label — drives the status dot + tinted label. */
  status: "Swept" | "Pending" | "Below threshold"
}

/**
 * One payout / withdrawal approval-queue row (design §6.13 markup lines 11). The
 * `big` flag renders the amber "Maker-checker" tag and routes Approve through the
 * dual-control flow (maker-checker → step-up); non-big rows go straight to step-up.
 */
export interface TreasuryPayoutRow {
  id: string
  /** Beneficiary / destination line (13px/700). */
  to: string
  /** Withdrawal reference (mono, part of the "ref · method" sub-line). */
  ref: string
  /** Rail / method label (the second half of the sub-line). */
  method: string
  /** The payout amount (mono / tabular, 13.5px/800). */
  amt: string
  /**
   * The fiat leg in the payout's OWN fiatCurrency ("≈ ₦…"), when the amount is
   * crypto; null when the amount already is the fiat figure.
   */
  fiat: string | null
  /** Large payout → shows the "Maker-checker" tag + dual-control approve path. */
  big: boolean
}

/** One balance tile — the hero variant carries the dark-green gradient. */
export interface BalanceCardProps {
  card: TreasuryCard
}

/**
 * The balance-card row — error / loading / data over `BalanceCard`. The card
 * list is currency-keyed (hero + one float card per currency + per-pair FX
 * positions + exposure), so the grid flows past four tiles when needed.
 */
export interface BalanceCardsRowProps {
  cards: TreasuryCard[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

/** The threshold-breach warning banner (composes the shared acknowledge control). */
export interface TreasuryAlertBannerProps {
  alert: import("@handshake-agent/contracts").TreasuryAlert
}

/** The payout / withdrawal approval queue — loading / error / empty / data. */
export interface PayoutQueuePanelProps {
  payouts: TreasuryPayoutRow[]
  isLoading: boolean
  isError: boolean
  /** Which rows have already been approved this session (shows "Requested"). */
  approved: Record<string, boolean>
  onRetry: () => void
  onApprove: (row: TreasuryPayoutRow) => void
}

/** The child-address sweeps panel — loading / error / empty / data + threshold footer. */
export interface SweepsPanelProps {
  sweeps: TreasurySweepRow[]
  threshold: string
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

/** The beneficiaries-in-cooling-off panel (composes the shared step-up override). */
export interface CoolingOffPanelProps {
  beneficiaries: import("@handshake-agent/contracts").AdminBeneficiary[]
}
