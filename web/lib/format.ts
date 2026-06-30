/**
 * Shared money and number formatters.
 *
 * All fiat amounts in this product are in NGN and are displayed with the ₦
 * symbol, thousands separators, and 2 decimal places.
 *
 * Example: formatNGN("30000") → "₦30,000.00"
 *          formatNGN(30000.5) → "₦30,000.50"
 */

/**
 * Display symbols for the supported fiats, keyed by ISO code. Mirrors the
 * catalog fiats in `/config` (and api configuration.ts). Used to drive precise
 * fiat formatting from a currency code so cards never hardcode ₦ for a non-NGN
 * settlement (audit #18 / #29). A code with no known symbol falls back to the
 * code itself.
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

/** Resolve a fiat display symbol from its ISO code; unknown → the code itself. */
export function fiatSymbolFor(currency: string): string {
  return FIAT_SYMBOLS[currency] ?? currency
}

/**
 * Format a precise fiat amount as "<symbol>X,XXX.XX" (thousands separators,
 * 2 decimal places). For a known symbol the symbol prefixes the amount with no
 * space ("₦20,000.00"); for an unknown currency the code is shown with a space
 * ("XOF 1,000.00") to stay legible.
 *
 * Accepts a number or string (strings are parsed with parseFloat).
 * Returns "<symbol>—" when the value is not a finite number.
 */
export function formatFiat(value: string | number, currency: string): string {
  const symbol = FIAT_SYMBOLS[currency]
  const prefix = symbol ?? `${currency} `
  const n = typeof value === "string" ? parseFloat(value) : value
  if (!isFinite(n)) return `${prefix}—`
  return (
    prefix +
    n.toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

/**
 * Format a naira amount as "₦X,XXX.XX".
 *
 * Accepts a number or string (strings are parsed with parseFloat).
 * Returns "₦—" when the value is not a finite number.
 *
 * @deprecated for money that may be non-NGN — use `formatFiat(value, currency)`
 * which drives the symbol from the payment's currency (audit #18 / #29).
 * Retained for the NGN-fixed call sites (countdown/quote scaffolding).
 */
export function formatNGN(value: string | number): string {
  return formatFiat(value, "NGN")
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

/**
 * Format a crypto amount with its asset symbol.
 * e.g. formatCrypto("31.25", "USDT") → "31.25 USDT"
 */
export function formatCrypto(amount: string, asset: string): string {
  return `${amount} ${asset}`
}
