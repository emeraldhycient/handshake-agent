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
import type { CurrencyAmount } from "@/types/components"

/** Display symbols for the supported fiats (mirrors api configuration.ts catalog). */
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

/** True when `currency` is a known fiat (has a symbol in the catalog), not a crypto asset. */
export function isFiat(currency: string): boolean {
  return currency in FIAT_SYMBOLS
}

/**
 * Format a precise fiat amount as "<symbol>X,XXX.XX". A known symbol prefixes with
 * no space ("₦20,000.00"); an unknown currency shows the code + a space
 * ("XOF 1,000.00"). A negative sign leads the whole figure ("-₦4,950.00", not
 * "₦-4,950.00"). Non-finite input → "<prefix>—".
 */
export function formatFiat(value: string | number, currency: string): string {
  const symbol = FIAT_SYMBOLS[currency]
  const prefix = symbol ?? `${currency} `
  const n = typeof value === "string" ? parseFloat(value) : value
  if (!Number.isFinite(n)) return `${prefix}—`
  const sign = n < 0 ? "-" : ""
  return (
    sign +
    prefix +
    Math.abs(n).toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
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
