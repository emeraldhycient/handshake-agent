/** Pricing page (§6.22) — spreads, bounds, base rates. */

import type { EffectiveSetting } from "@handshake-agent/contracts"

// ─── Pricing page (design §6.22) ────────────────────────────────────────────────────
// Per capability × asset × currency (design table: Capability · Asset/ccy · Spread ·
// Fee · Min/max · Effective-rate-preview · Edit). REAL data comes from
// `useSettings("Pricing")`: each priced asset contributes a Buy row (from
// `pricing.assets.<A>.buySpreadBps`) and a Sell row (from `…sellSpreadBps`), with the
// base rate (`…baseRates.NGN`) and the global processing fee (`pricing.processingFeeBps`).
// The effective-rate preview + operator-only margin are DERIVED from those real values
// (never a stored line item — root §3.1). Per-capability min/max has no dedicated config
// key, so that one cell is design-faithful representative content.

/** A pricing row's capability — selects the Buy vs Sell spread key + rate direction. */
export type PricingCapability = "crypto.buy" | "crypto.sell"

/**
 * One resolved row of the pricing table (design §6.22). The bps/rate figures are real
 * (resolved from the pricing settings); `spread` is the underlying editable
 * `pricing.assets.<asset>.<buy|sell>SpreadBps` setting the Edit action patches (via
 * step-up + maker-checker). `minmax` is design-faithful (no per-capability cap key yet).
 */
export interface PricingRow {
  /** Stable key + a11y root, e.g. "USDT-crypto.buy". */
  id: string
  capability: PricingCapability
  /** The money-path asset (USDT / BTC / TRX). */
  asset: string
  /** The fiat pairing rendered under the capability (e.g. "USDT / NGN"). */
  pair: string
  /** The editable spread setting backing this row (bps), if the value resolved. */
  spread: EffectiveSetting | null
  /** The global processing-fee setting shared across rows (bps). */
  fee: EffectiveSetting | null
  /** The asset's mid-market base-rate setting (NGN per 1 unit). */
  baseRate: EffectiveSetting | null
  /** design-faithful: no per-capability min/max config key yet. */
  minmax: string
}

/**
 * One configured base rate — a mid-market `<code>`-per-1-`<asset>` price resolved from
 * `pricing.assets.<asset>.baseRates.<code>`. A currency is fail-closed on enablement
 * until at least one such rate exists (root §7), so this is the "add prices" surface.
 */
export interface PricingBaseRateRow {
  /** Stable row id + a11y anchor, e.g. "USDT-GHS". */
  id: string
  /** The priced asset (USDT / BTC / TRX). */
  asset: string
  /** The fiat code the rate is denominated in (e.g. "GHS"). */
  code: string
  /** The editable base-rate setting key this row patches. */
  key: string
  /** The current rate (fiat units per 1 asset). */
  value: number
  /** Pre-formatted rate label (e.g. "19.5 GHS"). */
  label: string
  /** The setting's scope + scopeValue, carried so the write targets its leaf. */
  scope: EffectiveSetting["scope"]
  scopeValue: string | null
}

/** An (asset, currency) pair that has no base rate yet — offered in the Add-price dialog. */
export interface AddPriceOption {
  asset: string
  code: string
}

export interface PricingBaseRatesProps {
  /** Configured base rates (value present), in display order. */
  rows: PricingBaseRateRow[]
  /** Whether any unpriced (asset, currency) pair remains to add. */
  canAdd: boolean
  /** Loading branch (settings still resolving). */
  loading: boolean
  /** Edit an existing base rate (opens the shared audit chain). */
  onEdit: (row: PricingBaseRateRow) => void
  /** Open the Add-price dialog. */
  onAdd: () => void
}

export interface AddPriceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Unpriced (asset, currency) pairs the operator may add a rate for. */
  options: AddPriceOption[]
  /** Hand the captured (asset, currency, rate) up to start the audit chain. */
  onContinue: (choice: { asset: string; code: string; rate: number }) => void
}

/** The two priced, fiat-denominated capabilities that carry per-row MIN/MAX bounds. */
export type PricingCap = "buy" | "sell"

/** The generalized pricing edit chain: value → reason → confirm → the step-up-guarded PATCH. */
export type PricingFlowStep = "value" | "reason" | "maker"

/** One resolved spread row (buy or sell) of the design's pricing grid. */
export interface SpreadRow {
  id: string
  cap: string
  pair: string
  spread: string
  fee: string
  userRate: string
  margin: string
  spreadKey: string
  spreadBps: number | null
  scope: EffectiveSetting["scope"]
  scopeValue: string | null
  /** Per-(capability × asset × currency) fiat MIN/MAX (the pricing MIN/MAX column). */
  dir: PricingCap
  asset: string
  currency: string
  minKey: string
  maxKey: string
  minValue: number | null
  maxValue: number | null
}

/**
 * A single numeric-pricing edit in flight — the generalized target the audit chain
 * patches. `format` renders the value for the diff/toast; `integer` restricts the
 * captured value (bps are whole; a base rate may be a decimal).
 */
export interface EditTarget {
  key: string
  title: string
  fieldLabel: string
  currentLabel: string
  seed: string
  scope: EffectiveSetting["scope"]
  scopeValue: string | null
  diffField: string
  toastLabel: string
  format: (n: number) => string
  integer: boolean
}

/** One body row of the spread grid — including the inline Edit + min/max controls. */
export interface SpreadTableRowProps {
  row: SpreadRow
  onEdit: (row: SpreadRow) => void
  onEditMin: (row: SpreadRow) => void
  onEditMax: (row: SpreadRow) => void
}

/** The spread card — preview-currency + fee header strip, then the 7-column grid. */
export interface SpreadCardProps {
  rows: SpreadRow[]
  currencies: string[]
  previewCurrency: string
  feeLabel: string
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  onCurrencyChange: (currency: string) => void
  onRetry: () => void
  onEditFee: () => void
  onEdit: (row: SpreadRow) => void
  onEditMin: (row: SpreadRow) => void
  onEditMax: (row: SpreadRow) => void
}
