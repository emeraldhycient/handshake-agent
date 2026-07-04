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

/**
 * Format a precise fiat amount as "<symbol>X,XXX.XX". A known symbol prefixes with
 * no space ("₦20,000.00"); an unknown currency shows the code + a space
 * ("XOF 1,000.00"). Non-finite input → "<prefix>—".
 */
export function formatFiat(value: string | number, currency: string): string {
  const symbol = FIAT_SYMBOLS[currency]
  const prefix = symbol ?? `${currency} `
  const n = typeof value === "string" ? parseFloat(value) : value
  if (!Number.isFinite(n)) return `${prefix}—`
  return (
    prefix +
    n.toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
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
