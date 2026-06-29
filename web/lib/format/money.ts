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
 */
export function formatFiatAmount(
  amount: string,
  symbol: string,
  opts?: { approx?: boolean }
): string {
  const whole = Math.round(Number(amount)).toString()
  const out = `${symbol}${groupThousands(whole)}`
  return opts?.approx ? `≈ ${out}` : out
}

/**
 * Formats a crypto amount string with its asset symbol.
 * e.g. formatCryptoAmount("29.97", "USDT") → "29.97 USDT"
 */
export function formatCryptoAmount(amount: string, asset: string): string {
  return `${amount} ${asset}`
}
