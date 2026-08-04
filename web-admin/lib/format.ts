/**
 * Money + currency formatters for the admin console (go-readiness #11).
 *
 * Canonical per-currency fiat formatting so the console never hardcodes ₦ or
 * concatenates a bare "CODE amount" — every money figure carries its currency's
 * symbol + precision. Mirrors `web/lib/format.ts` (the user app's `formatFiat`);
 * consolidating both into one shared util (e.g. under `@handshake-agent/contracts`)
 * is the remaining #11 work, deferred here only to avoid colliding with the
 * in-flight PWA session that is editing `web/`.
 *
 * Pure — no framework, no IO. This file lives in `lib/`.
 */
import type { CurrencyAmount } from "@/types"

/**
 * Static display symbols for the BUILT-IN fiats (mirrors api configuration.ts
 * catalog). This is the OFFLINE FALLBACK only — the live source of truth is the
 * admin catalog read hydrated via `hydrateFiatDisplay`, which also covers
 * runtime admin-added currencies (a code known to neither falls back to itself).
 */
export const FIAT_SYMBOLS: Record<string, string> = {
  NGN: "₦",
  GHS: "GH₵",
  KES: "KSh",
  UGX: "USh",
  TZS: "TSh",
  RWF: "FRw",
  ZAR: "R",
  USD: "$",
}

/** Per-currency display metadata hydrated from the admin catalog read. */
interface FiatDisplayMeta {
  symbol: string
  decimals: number
}

/** Default fraction digits when a currency has no configured decimals. */
const DEFAULT_FIAT_DECIMALS = 2

// Module-level registry — plain state (no React) so lib/format stays a leaf
// module usable from row-builders, hooks, and components alike.
let configuredFiatDisplay: Record<string, FiatDisplayMeta> = {}

/**
 * Replace the fiat display registry with the admin catalog's fiat entries
 * (code → symbol + decimals, built-in AND runtime custom). Called by the data
 * layer whenever the catalog read resolves — never from a component (`lib/`
 * stays React-free). Passing an empty array clears back to the offline fallback.
 */
export function hydrateFiatDisplay(
  fiats: ReadonlyArray<{ code: string; symbol: string; decimals: number }>
): void {
  const next: Record<string, FiatDisplayMeta> = {}
  for (const f of fiats) {
    next[f.code] = { symbol: f.symbol, decimals: f.decimals }
  }
  configuredFiatDisplay = next
}

/**
 * Resolve a fiat display symbol from its ISO code: hydrated registry first,
 * then the static fallback map, then the code itself.
 */
export function fiatSymbolFor(currency: string): string {
  return (
    configuredFiatDisplay[currency]?.symbol ?? FIAT_SYMBOLS[currency] ?? currency
  )
}

/**
 * True when `currency` is a known fiat, not a crypto asset — the hydrated
 * registry (which includes runtime admin-added fiats) unioned with the static
 * fallback map, so a custom fiat is never misclassified as crypto once the
 * catalog has loaded.
 */
export function isFiat(currency: string): boolean {
  return currency in configuredFiatDisplay || currency in FIAT_SYMBOLS
}

/**
 * The fiat codes the console currently knows: the hydrated catalog's codes
 * (in catalog order) once loaded, else the built-in fallback set. Drives
 * currency filter/selector option lists so runtime-added fiats appear.
 */
export function knownFiatCodes(): string[] {
  const hydrated = Object.keys(configuredFiatDisplay)
  return hydrated.length > 0 ? hydrated : Object.keys(FIAT_SYMBOLS)
}

/**
 * Format a precise fiat amount as "<symbol>X,XXX.XX" (the currency's configured
 * decimals — default 2). A known symbol prefixes with no space ("₦20,000.00");
 * an unknown currency shows the code + a space ("XOF 1,000.00"). A negative
 * sign leads the whole figure ("-₦4,950.00", not "₦-4,950.00"). Non-finite
 * input → "<prefix>—".
 */
export function formatFiat(value: string | number, currency: string): string {
  const configured = configuredFiatDisplay[currency]
  const symbol = configured?.symbol ?? FIAT_SYMBOLS[currency]
  const prefix = symbol ?? `${currency} `
  const decimals = configured?.decimals ?? DEFAULT_FIAT_DECIMALS
  const n = typeof value === "string" ? parseFloat(value) : value
  if (!Number.isFinite(n)) return `${prefix}—`
  const sign = n < 0 ? "-" : ""
  return (
    sign +
    prefix +
    Math.abs(n).toLocaleString("en-NG", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  )
}

/**
 * Format a crypto amount WITHOUT its asset code — thousands separators on the
 * integer part, the asset's own precision preserved (up to 8 dp, trailing zeros
 * trimmed), a leading negative sign kept. Non-finite → "—". Use this where the
 * asset code is rendered separately (e.g. a muted adjacent span or a card label).
 */
export function formatCryptoAmount(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value
  if (!Number.isFinite(n)) return "—"
  const sign = n < 0 ? "-" : ""
  return (
    sign +
    Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 8,
    })
  )
}

/**
 * Format a crypto amount as "X,XXX.XXXXXX ASSET" — the numeric part per
 * `formatCryptoAmount` with the asset code appended. Unlike `formatFiat` it never
 * forces 2 dp or a currency symbol. Non-finite → "— ASSET".
 */
export function formatCrypto(value: string | number, asset: string): string {
  const n = typeof value === "string" ? parseFloat(value) : value
  if (!Number.isFinite(n)) return `— ${asset}`
  return `${formatCryptoAmount(value)} ${asset}`
}

/**
 * Currency-aware money formatter for legs whose currency may be fiat OR crypto
 * (e.g. double-entry ledger rows keyed by `leg.currency`): a known fiat routes to
 * `formatFiat` (symbol + 2 dp), anything else to `formatCrypto` (code + native
 * precision). Never renders a crypto amount with a fiat symbol/2 dp, or vice-versa.
 */
export function formatAmount(value: string | number, currency: string): string {
  return isFiat(currency)
    ? formatFiat(value, currency)
    : formatCrypto(value, currency)
}

/**
 * Format a signed reconciliation delta (e.g. "+5000", "-3.048") for its currency,
 * preserving the direction sign: a leading "+" is kept ("+₦5,000.00"), a negative
 * flows through `formatAmount` ("-₦4,950.00" / "-3.048 USDT"). Used where the sign
 * itself carries meaning (over-credit vs missing) and there is no DR/CR column.
 */
export function formatDelta(value: string | number, currency: string): string {
  const raw = typeof value === "number" ? String(value) : value.trim()
  const body = formatAmount(raw, currency)
  return raw.startsWith("+") && !body.startsWith("-") ? `+${body}` : body
}

/**
 * Format a per-currency amount list (e.g. a metric's `byCurrency`) as each
 * currency formatted and joined with " · " — currencies are NEVER summed into one
 * figure (they are different units). Empty list → "—".
 */
export function formatMoneyList(amounts: readonly CurrencyAmount[]): string {
  if (amounts.length === 0) return "—"
  return amounts.map((a) => formatFiat(a.amount, a.currency)).join(" · ")
}
