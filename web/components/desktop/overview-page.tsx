"use client"

import { useQueryClient } from "@tanstack/react-query"
import { BalanceHero } from "@/components/desktop/overview/balance-hero"
import { AssetsTable } from "@/components/desktop/overview/assets-table"
import { RecentActivityTable } from "@/components/desktop/overview/recent-activity-table"
import {
  QueryErrorState,
  QueryEmptyState,
} from "@/components/shared/query-states"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useBalances,
  useWalletAssets,
  useActivityFeed,
} from "@/lib/query/hooks"
import { qk } from "@/lib/query/keys"
import { useCapabilities } from "@/lib/query/capabilities"
import { cn } from "@/lib/utils"
import type { PageWithQuickActionProps } from "@/types/components"

/**
 * Desktop overview page — orchestrator. Owns the three data hooks and the four
 * async branches (loading / error / empty / data); composes the Balance hero,
 * Assets table, and Recent-activity sections. All presentational markup lives in
 * those section components (root §16).
 */
export function OverviewPage({
  onQuickAction,
  className,
}: PageWithQuickActionProps) {
  const balances = useBalances()
  const assets = useWalletAssets()
  const activity = useActivityFeed()
  const queryClient = useQueryClient()
  const { canSell } = useCapabilities()

  // One retry that re-fetches all three sections (the activity feed hook exposes
  // no refetch, so invalidation is the uniform path). Match by the key's first
  // segment so balances / walletAssets / activity all refetch.
  const RETRY_KEYS: string[] = [
    qk.balances[0],
    qk.walletAssets[0],
    qk.activity[0],
  ]
  const retryAll = () =>
    void queryClient.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        RETRY_KEYS.includes(q.queryKey[0] as string),
    })

  const isLoading = balances.isLoading || assets.isLoading || activity.isLoading
  const isError = balances.isError || assets.isError || activity.isError

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col gap-[18px] overflow-y-auto p-6",
          className
        )}
      >
        <Skeleton className="h-[120px] rounded-[18px]" />
        <Skeleton className="h-[180px] rounded-[18px]" />
        <Skeleton className="h-[160px] rounded-[18px]" />
      </div>
    )
  }

  if (isError) {
    return (
      <div
        className={cn("flex flex-1 items-center justify-center p-6", className)}
      >
        <QueryErrorState
          title="Failed to load overview"
          description="Something went wrong loading your wallet. Check your connection and try again."
          onRetry={retryAll}
        />
      </div>
    )
  }

  const balanceData = balances.data
  const assetData = assets.data ?? []
  const activityData = activity.groups

  if (!balanceData && assetData.length === 0 && activityData.length === 0) {
    return (
      <div
        className={cn("flex flex-1 items-center justify-center p-6", className)}
      >
        <QueryEmptyState
          title="Nothing here yet"
          description="Fund your wallet to see your balance and activity."
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-[18px] overflow-y-auto p-6",
        className
      )}
    >
      <BalanceHero
        total={balanceData?.total ?? "—"}
        canSell={canSell}
        onQuickAction={onQuickAction}
      />
      <AssetsTable assets={assetData} />
      <RecentActivityTable groups={activityData} />
    </div>
  )
}
