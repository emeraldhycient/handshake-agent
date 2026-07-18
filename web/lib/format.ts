/**
 * Shared money and number formatters.
 *
 * Fiat amounts are formatted from their ISO currency code via `formatFiat` —
 * the symbol and decimals come from the /config-hydrated registry
 * (`hydrateFiatDisplay`) with `FIAT_SYMBOLS` as the offline fallback, so cards
 * never hardcode ₦ for a non-NGN settlement (audit #18 / #29).
 *
 * Example: formatFiat("30000", "NGN") → "₦30,000.00"
 *          formatFiat(30000.5, "GHS") → "GH₵30,000.50"
 */

/**
 * The single neutral display locale for every number/date formatter in the app
 * (the product is multi-country — never pin a country-specific locale like
 * en-NG in individual call sites).
 */
export const DISPLAY_LOCALE = "en-GB"

/**
 * Static display symbols for the built-in fiats, keyed by ISO code. Mirrors the
 * JSON-default catalog fiats in api configuration.ts. This is the OFFLINE
 * FALLBACK only — the live source of truth is the /config registry hydrated via
 * `hydrateFiatDisplay`. A code known to neither falls back to the code itself.
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

/** Per-currency display metadata hydrated from the /config endpoint. */
interface FiatDisplayMeta {
  symbol: string
  decimals: number
}

/** Default fraction digits when a currency has no configured decimals. */
const DEFAULT_FIAT_DECIMALS = 2

// Module-level registry — plain state (no React) so lib/format stays a leaf
// module usable from stores, mappers, and components alike.
let configuredFiatDisplay: Record<string, FiatDisplayMeta> = {}

/**
 * Replace the fiat display registry with the /config catalog entries
 * (code → symbol + decimals). Called by the data layer whenever the /config
 * payload loads, so chat-card formatting uses the operator-configured symbols.
 * Passing an empty array clears the registry back to the offline fallback.
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
 * Resolve a fiat display symbol from its ISO code: /config registry first,
 * then the static fallback map, then the code itself.
 */
export function fiatSymbolFor(currency: string): string {
  return (
    configuredFiatDisplay[currency]?.symbol ??
    FIAT_SYMBOLS[currency] ??
    currency
  )
}

/**
 * Format a precise fiat amount as "<symbol>X,XXX.XX" (thousands separators,
 * configured decimals — default 2). For a known symbol the symbol prefixes the
 * amount with no space ("₦20,000.00"); for an unknown currency the code is
 * shown with a space ("XOF 1,000.00") to stay legible.
 *
 * Accepts a number or string (strings are parsed with parseFloat).
 * Returns "<symbol>—" when the value is not a finite number.
 */
export function formatFiat(value: string | number, currency: string): string {
  const configured = configuredFiatDisplay[currency]
  const symbol = configured?.symbol ?? FIAT_SYMBOLS[currency]
  const prefix = symbol ?? `${currency} `
  const decimals = configured?.decimals ?? DEFAULT_FIAT_DECIMALS
  const n = typeof value === "string" ? parseFloat(value) : value
  if (!isFinite(n)) return `${prefix}—`
  return (
    prefix +
    n.toLocaleString(DISPLAY_LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  )
}

/**
 * Format a countdown in whole seconds as "m:ss".
 * e.g. 90 → "1:30", 58 → "0:58", 0 → "0:00"
 */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}:${rem.toString().padStart(2, "0")}`
}
