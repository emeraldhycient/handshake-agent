import type { WalletBalancesResponse } from "@handshake-agent/contracts"
import { ASSET_TINTS } from "@/lib/constants"
import { formatFiatAmount, formatCryptoAmount } from "@/lib/format/money"
import type { BalanceView, WalletAsset } from "@/lib/schemas"

// Per-asset 24h change has no backend source — always "—" until a price-history
// endpoint is available. Never show fake numbers.
const tintFor = (sym: string) => ASSET_TINTS[sym] ?? ASSET_TINTS.USDT

/**
 * Finding #7: a wallet that holds real assets we can't price right now must not
 * read identically to an empty ₦0 wallet. The backend sums only PRICED assets
 * into totalFiatValue, so an all-unpriced wallet reports "0.00" — the same
 * string as a brand-new empty user. Detect a "partial" total: any asset with a
 * non-zero balance but no fiatValue means the headline total cannot be fully
 * computed, so we render "value unavailable" (≈ ₦—) instead of ≈ ₦0.
 *
 * A genuinely empty wallet (no contributing assets) keeps the honest ≈ ₦0.
 */
function isTotalUnpriced(res: WalletBalancesResponse): boolean {
  return res.assets.some((a) => Number(a.amount) > 0 && a.fiatValue == null)
}

/** "Value unavailable" sentinel for the hero/card total — distinct from ≈ ₦0. */
function unavailableTotal(symbol: string): string {
  return `≈ ${symbol}—`
}

export function mapWalletBalances(res: WalletBalancesResponse): BalanceView {
  return {
    kind: "balance",
    total: isTotalUnpriced(res)
      ? unavailableTotal(res.fiatSymbol)
      : formatFiatAmount(res.totalFiatValue, res.fiatSymbol, {
          approx: true,
        }),
    assets: res.assets.map((a) => ({
      sym: a.symbol,
      name: a.displayName,
      amount: formatCryptoAmount(a.amount, a.symbol),
      value: a.fiatValue ? formatFiatAmount(a.fiatValue, res.fiatSymbol) : "—",
      tint: tintFor(a.symbol),
      ...(a.logoUrl ? { logoUrl: a.logoUrl } : {}),
    })),
  }
}

export function mapWalletAssets(res: WalletBalancesResponse): WalletAsset[] {
  return res.assets.map((a) => ({
    sym: a.symbol,
    name: a.displayName,
    sub: `${a.symbol} · ${a.network}`,
    amount: formatCryptoAmount(a.amount, a.symbol),
    value: a.fiatValue ? formatFiatAmount(a.fiatValue, res.fiatSymbol) : "—",
    change: "—",
    tint: tintFor(a.symbol),
    ...(a.logoUrl ? { logoUrl: a.logoUrl } : {}),
  }))
}
