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
 * Format a naira amount as "₦X,XXX.XX".
 *
 * Accepts a number or string (strings are parsed with parseFloat).
 * Returns "₦—" when the value is not a finite number.
 */
export function formatNGN(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value
  if (!isFinite(n)) return "₦—"
  return (
    "₦" +
    n.toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
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

/**
 * Format a crypto amount with its asset symbol.
 * e.g. formatCrypto("31.25", "USDT") → "31.25 USDT"
 */
export function formatCrypto(amount: string, asset: string): string {
  return `${amount} ${asset}`
}
