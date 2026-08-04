/** Ledger viewer page (design §6.11) — the read-only double-entry browser. */

import type { FilterOption } from "./shared"

// ─── Ledger viewer page (design §6.11) ──────────────────────────────────────────────
// READ-ONLY (§3.1): the global double-entry ledger browsed by account-type + currency.

/** One display-ready row projected from a real `AdminLedgerEntry`. */
export interface LedgerRow {
  key: string
  seq: string
  acct: string
  dir: string
  dirDanger: boolean
  amt: string
  run: string
  src: string
  /** The tx-detail route, or null when the source is not a transaction. */
  href: string | null
}

/** The header's live sequence-integrity pill (broken → danger tint + gap label). */
export interface LedgerIntegrityPillProps {
  broken: boolean
  label: string
}

/** One ledger body row (Seq · Account · Dir · Amount · Running · Source). */
export interface LedgerRowLineProps {
  row: LedgerRow
}

/** The ledger table card — filter strip (type · currency · export) + four branches. */
export interface LedgerTableProps {
  account: string
  currency: string
  onAccount: (value: string) => void
  onCurrency: (value: string) => void
  /** Currency axis options from the live catalog (fiats + assets), never hardcoded. */
  currencyOptions: readonly FilterOption[]
  exporting: boolean
  onExport: () => void
  isLoading: boolean
  isError: boolean
  rows: readonly LedgerRow[]
  onRetry: () => void
}

/** The 7-column ledger table with its own loading / error / empty / data branches. */
export interface TxnLedgerProps {
  rows: import("@handshake-agent/contracts").AdminTxnListItem[]
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  /** Drives the "no match" empty copy (search vs. plain view). */
  search: string
  onRetry: () => void
  onOpen: (id: string) => void
}
