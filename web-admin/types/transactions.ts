/** Transactions ledger page and the transaction detail view. */

import type { ReactNode } from "react"
import type { EngineLedgerRow, MakerCheckerDiffRow } from "./flows"

/**
 * The four master-ledger view tabs (design §6.8 `txViews`). `all` is unfiltered;
 * `stuck` narrows to in-flight transactions, `failed` to failures, `refunds` to
 * the refund type. The active tab drives the keyed `useTransactions` query.
 */
export type TransactionsView = "all" | "stuck" | "failed" | "refunds"

export interface TxnRowProps {
  txn: import("@handshake-agent/contracts").AdminTxnListItem
  onOpen: () => void
}

export interface TransactionViewTabsProps {
  view: TransactionsView
  counts?: import("@handshake-agent/contracts").AdminTxnViewCounts
  search: string
  onSelectView: (view: TransactionsView) => void
  onSearch: (value: string) => void
}

// ─── Transactions page + detail ────────────────────────────────────────────────

export interface TransactionDetailProps {
  /** The transaction id resolved from the `[id]` route segment. */
  transactionId: string
}

/** The engine-state stepper tone for one timeline node. */
export type TxTimelineTone = "done" | "pending" | "fail"

/** A triage action the operator can open on a transaction. */
export type TxFlowKind = "retry" | "refund" | "markFailed" | "recon"

/** One header triage-action button (label + the flow it opens + icon + danger tint). */
export interface TxActionButton {
  label: string
  kind: TxFlowKind
  icon: string
  danger?: boolean
}

/** The steps a triage flow moves through before its terminal (engine/maker) write. */
export type TxFlowStep = "reason" | "engine" | "maker"

/** The active flow phase, or null when no triage flow is open. */
export type TxActivePhase = TxFlowStep | null

/** The resolved spec for a triage action — its steps, copy, itemized effect + ledger. */
export interface TxFlowSpec {
  steps: TxFlowStep[]
  title: string
  cta: string
  effect: { k: string; v: string }[]
  ledger: EngineLedgerRow[]
  diff?: MakerCheckerDiffRow[]
}

/** One provider-reference row (label + value + optional external explorer link). */
export interface TxRefRow {
  label: string
  value: string
  link?: string
  href?: string
}

/** One itemized-economics row (label + value + operator-only warn tint). */
export interface TxEconomicsRow {
  label: string
  value: string
  warn?: boolean
}

/** The tx-detail card-title primitive (bold label + optional muted note). */
export interface TxPanelTitleProps {
  children: ReactNode
  note?: string
}

/** One double-entry ledger leg row (Account / Dir / Amount / Seq). */
export interface TxLedgerRowProps {
  leg: import("@handshake-agent/contracts").AdminTxnLedgerLeg
}

/** One engine-state timeline stepper node (+ whether a connector to the next follows). */
export interface TxTimelineStepProps {
  entry: import("@handshake-agent/contracts").AdminTxnTimelineEntry
  hasNext: boolean
}

/** The inline "Re-run recon" result panel (loading / error / breaks / reconciled). */
export interface TxReconResultProps {
  loading: boolean
  error: string | null
  breaks: import("@handshake-agent/contracts").ReconBreak[] | null
}
