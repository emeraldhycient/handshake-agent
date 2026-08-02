/** Currency catalog page (§6.24). */

import type { AdminCustomFiatCreateRequest } from "@handshake-agent/contracts"

export interface AddCurrencyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing fiat codes (built-in + custom), upper-cased — for a fast local
   * duplicate check before the server's 409. */
  existingCodes: string[]
  /**
   * Persist the new custom currency. Returns the mutation promise so the dialog
   * can await, surface its own error inline, and close on success. May trigger a
   * step-up challenge that the parent resolves.
   */
  onSave: (input: AdminCustomFiatCreateRequest) => Promise<void>
}

// ─── Currency catalog page (design §6.24) ───────────────────────────────────────────
// WIRED to the real admin fiat catalog (`GET /admin/config/catalog`, incl. disabled/off
// entries). Each row's Live pill is a maker-checker toggle (enabling / disabling a
// currency is a dual-control config change) — clicking it opens the shared
// MakerCheckerModal, whose approval fires the step-up-guarded PATCH. Nothing here
// moves money (§3.1).

/** A currency-catalog row for the design §6.24 table (mirrors a catalog fiat). */
export interface CurrencyCatalogRow {
  /** Stable row id (from the design seed, e.g. "ngn") — used as the React key. */
  id: string
  /** ISO currency code (e.g. "NGN"), rendered bold. */
  code: string
  /** Display symbol (e.g. "₦"), shown in the chip and the Symbol column (mono). */
  symbol: string
  /** Full currency name (e.g. "Nigerian Naira"). */
  name: string
  /** Rounding precision in decimal places (design seed `rounding`). */
  rounding: number
  /** Whether bank name-enquiry is available for this currency (design seed `ne`). */
  nameEnquiry: boolean
  /** Whether the currency is live (enabled) — drives the Live pill (design seed `live`). */
  live: boolean
  /**
   * True for a runtime admin-added currency (CustomFiat) — toggled via the currency
   * endpoint; false for a built-in catalog fiat — toggled via the settings key. Drives
   * the "custom" chip + which mutation the Live toggle calls.
   */
  custom: boolean
}

/** One catalog row — grid, symbol chip, mono columns, and the clickable Live pill. */
export interface CurrencyRowProps {
  row: CurrencyCatalogRow
  onToggle: (row: CurrencyCatalogRow) => void
}

/** The catalog table card — header row + the four async branches. */
export interface CurrencyTableProps {
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  rows: readonly CurrencyCatalogRow[]
  onToggle: (row: CurrencyCatalogRow) => void
  onRetry: () => void
}
