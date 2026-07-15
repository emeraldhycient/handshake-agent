"use client"

import { WalletHeader } from "@/components/desktop/wallet/wallet-header"
import { WalletAssetCards } from "@/components/desktop/wallet/wallet-asset-cards"
import { WalletDepositPanel } from "@/components/desktop/wallet/wallet-deposit-panel"
import {
  QueryErrorState,
  QueryEmptyState,
} from "@/components/shared/query-states"
import { Skeleton } from "@/components/ui/skeleton"
import { useWalletAssets, useDepositAddress } from "@/lib/query/hooks"
import { useCapabilities } from "@/lib/query/capabilities"
import { cn } from "@/lib/utils"
import type { PageWithQuickActionProps } from "@/types/components"

/**
 * Desktop wallet page — orchestrator. Owns the data hooks and the four async
 * branches; composes the header, the holdings grid, and the multi-asset deposit
 * panel. All presentational markup + deposit logic live in the sections and
 * `lib/wallet/deposit` (root §16).
 */
export function WalletPage({
  onQuickAction,
  className,
}: PageWithQuickActionProps) {
  const assets = useWalletAssets()
  const deposit = useDepositAddress()
  const { canSell } = useCapabilities()

  if (assets.isLoading) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col gap-4 overflow-y-auto p-6",
          className
        )}
      >
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-24" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-16 rounded-[11px]" />
            <Skeleton className="h-9 w-16 rounded-[11px]" />
            <Skeleton className="h-9 w-16 rounded-[11px]" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-[14px]">
          <Skeleton className="h-[140px] rounded-[16px]" />
          <Skeleton className="h-[140px] rounded-[16px]" />
          <Skeleton className="h-[140px] rounded-[16px]" />
        </div>
        <Skeleton className="h-[120px] rounded-[18px]" />
      </div>
    )
  }

  if (assets.isError) {
    return (
      <div
        className={cn("flex flex-1 items-center justify-center p-6", className)}
      >
        <QueryErrorState
          title="Failed to load wallet"
          description="Something went wrong loading your assets. Check your connection and try again."
          onRetry={() => void assets.refetch()}
        />
      </div>
    )
  }

  const assetData = assets.data ?? []

  if (assetData.length === 0) {
    return (
      <div
        className={cn("flex flex-1 items-center justify-center p-6", className)}
      >
        <QueryEmptyState
          title="No assets yet"
          description="Fund your wallet to get started."
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-4 overflow-y-auto p-6",
        className
      )}
    >
      <WalletHeader canSell={canSell} onQuickAction={onQuickAction} />
      <WalletAssetCards assets={assetData} />
      <WalletDepositPanel
        assets={assetData}
        depositData={deposit.data}
        depositLoading={deposit.isLoading}
        depositError={deposit.isError}
        onQuickAction={onQuickAction}
      />
    </div>
  )
}
