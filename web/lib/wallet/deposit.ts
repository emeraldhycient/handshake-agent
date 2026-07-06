import type { WalletAsset, DepositView } from "@/lib/schemas"

// A wallet asset is depositable on-chain when its sub-label carries a network
// token (e.g. "USDT · TRON"). Fiat balances (e.g. "Naira — NGN balance") have no
// on-chain network and are excluded — you can't send fiat to a chain address.
const FIAT_SUBS = /ngn balance|fiat/i

/** The network token from a WalletAsset.sub, e.g. "USDT · TRON" → "TRON". */
export function assetNetwork(asset: WalletAsset): string | null {
  if (FIAT_SUBS.test(asset.sub)) return null
  // "SYM · NETWORK" → take the segment after the separator as the network.
  const parts = asset.sub.split("·").map((p) => p.trim())
  if (parts.length >= 2 && parts[1]) return parts[1]
  return null
}

/**
 * Crypto holdings shown in the deposit selector (excludes fiat — you can't send
 * fiat to a chain address).
 */
export function depositableAssets(assets: WalletAsset[]): WalletAsset[] {
  return assets.filter((a) => !FIAT_SUBS.test(a.sub))
}

/**
 * Does the fetched deposit address belong to the selected asset's network?
 * USDT and TRX both resolve to "TRON", so both match the single TRON address —
 * callers then surface that the address is SHARED rather than unique.
 */
export function networkMatches(
  asset: WalletAsset,
  deposit: DepositView | undefined
): boolean {
  const net = assetNetwork(asset)
  if (!net || !deposit) return false
  // deposit.network is "TRON · TRC-20"; asset network is "TRON". Match on the
  // family token (case-insensitive substring) so "TRON" ⊆ "TRON · TRC-20".
  return deposit.network.toLowerCase().includes(net.toLowerCase())
}
