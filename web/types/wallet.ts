import type { ChatAction, WalletAsset, DepositView } from "@/lib/schemas"

export interface WalletHeaderProps {
  canSell: boolean
  onQuickAction: (action: ChatAction, label: string) => void
}

export interface WalletAssetCardsProps {
  assets: WalletAsset[]
}

export interface WalletDepositPanelProps {
  /** Full asset list; the panel filters to depositable (crypto) holdings itself. */
  assets: WalletAsset[]
  depositData: DepositView | undefined
  depositLoading: boolean
  depositError: boolean
  onQuickAction: (action: ChatAction, label: string) => void
}
