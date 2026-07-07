import type { WalletAsset, ActivityGroup, ChatAction } from "@/lib/schemas"

export interface BalanceHeroProps {
  /** Formatted total balance string, or "—" when unavailable. */
  total: string
  /** Whether the swap capability is enabled (drives the Swap button). */
  canSwap: boolean
  onQuickAction: (action: ChatAction, label: string) => void
}

export interface AssetsTableProps {
  assets: WalletAsset[]
}

export interface RecentActivityTableProps {
  groups: ActivityGroup[]
}
