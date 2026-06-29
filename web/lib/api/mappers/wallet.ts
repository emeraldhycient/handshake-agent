import type { WalletBalancesResponse } from "@handshake-agent/contracts"
import { ASSET_TINTS } from "@/lib/constants"
import { formatFiatAmount, formatCryptoAmount } from "@/lib/format/money"
import type { BalanceView, WalletAsset } from "@/lib/schemas"

// Per-asset 24h change has no backend source (no price history). Kept as a
// labelled placeholder per the product decision to keep demo values visible.
const PLACEHOLDER_CHANGE: Record<string, string> = {
  USDT: "+0.1%",
  BTC: "+2.4%",
}
const changeFor = (sym: string) => PLACEHOLDER_CHANGE[sym] ?? "—"
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
      value: formatFiatAmount(a.fiatValue, res.fiatSymbol),
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
    value: formatFiatAmount(a.fiatValue, res.fiatSymbol),
    change: changeFor(a.symbol),
    tint: tintFor(a.symbol),
  }))
}
