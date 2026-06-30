/**
 * Display formatters for money strings. Pure and deterministic (no Intl/locale,
 * mirroring the backend AssetRegistry formatter so output is identical across
 * ICU builds). The fiat symbol is passed in — sourced from the balances
 * response / `/config`, never hardcoded here.
 */

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

/**
 * Formats a fiat amount string for display: grouped thousands, kobo dropped.
 * e.g. formatFiatAmount("72340.00", "₦") → "₦72,340"
 * With { approx: true } → "≈ ₦72,340".
 *
 * Finding #6: a NON-ZERO amount below one unit must not round to "₦0" — that
 * reads as "no money". Values in the open interval (0, 1) render at 2dp
 * ("₦0.50", "₦0.01") so a small-but-real balance is shown honestly. A genuine
 * zero still renders the clean "₦0". Amounts ≥ 1 keep the whole-unit rounding.
 */
export function formatFiatAmount(
  amount: string,
  symbol: string,
  opts?: { approx?: boolean }
): string {
  const n = Number(amount)
  const isSubUnit = n > 0 && n < 1
  const body = isSubUnit
    ? n.toFixed(2)
    : groupThousands(Math.round(n).toString())
  const out = `${symbol}${body}`
  return opts?.approx ? `≈ ${out}` : out
}

/**
 * Formats a crypto amount string with its asset symbol.
 * e.g. formatCryptoAmount("29.97", "USDT") → "29.97 USDT"
 */
export function formatCryptoAmount(amount: string, asset: string): string {
  return `${amount} ${asset}`
}
