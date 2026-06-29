import type { WalletBalancesResponse } from "@handshake-agent/contracts"
import { ASSET_TINTS } from "@/lib/constants"
import { formatFiatAmount, formatCryptoAmount } from "@/lib/format/money"
import type { BalanceView, WalletAsset } from "@/lib/schemas"

// Per-asset 24h change has no backend source — always "—" until a price-history
// endpoint is available. Never show fake numbers.
const tintFor = (sym: string) => ASSET_TINTS[sym] ?? ASSET_TINTS.USDT

export function mapWalletBalances(res: WalletBalancesResponse): BalanceView {
  return {
    kind: "balance",
    total: formatFiatAmount(res.totalFiatValue, res.fiatSymbol, {
      approx: true,
    }),
    assets: res.assets.map((a) => ({
      sym: a.symbol,
      name: a.displayName,
      amount: formatCryptoAmount(a.amount, a.symbol),
      value: a.fiatValue ? formatFiatAmount(a.fiatValue, res.fiatSymbol) : "—",
      tint: tintFor(a.symbol),
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
  }))
}
