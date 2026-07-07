"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ActivityFilters } from "@/components/desktop/activity/activity-filters"
import { ActivityGroupList } from "@/components/desktop/activity/activity-group-list"
import {
  QueryErrorState,
  QueryEmptyState,
} from "@/components/shared/query-states"
import { Skeleton } from "@/components/ui/skeleton"
import { TransactionDetailModal } from "@/components/shared/transaction-detail-modal"
import { useActivityFeed } from "@/lib/query/hooks"
import { qk } from "@/lib/query/keys"
import { matchesFilter, type ActivityFilter } from "@/lib/activity/filter"
import { ACTIVITY_FILTERS } from "@/constants/activity"
import { cn } from "@/lib/utils"

/**
 * Desktop activity page — orchestrator. Owns the filter + selected-row state, the
 * four async branches, and pagination; composes the filter pills and grouped list
 * (root §16). Clicking a row opens TransactionDetailModal with the full detail.
 */
export function ActivityPage({ className }: { className?: string }) {
  const [activeFilter, setActiveFilter] = useState<ActivityFilter>("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const activity = useActivityFeed()
  const queryClient = useQueryClient()
  const retry = () =>
    void queryClient.invalidateQueries({ queryKey: qk.activity })

  if (activity.isLoading) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col gap-4 overflow-y-auto p-6",
          className
        )}
      >
        <Skeleton className="h-8 w-28" />
        <div className="flex gap-2">
          {ACTIVITY_FILTERS.map((f) => (
            <Skeleton key={f.id} className="h-9 w-20 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-[180px] rounded-[16px]" />
        <Skeleton className="h-[180px] rounded-[16px]" />
      </div>
    )
  }

  if (activity.isError) {
    return (
      <div
        className={cn("flex flex-1 items-center justify-center p-6", className)}
      >
        <QueryErrorState
          title="Failed to load activity"
          description="Something went wrong loading your transactions. Check your connection and try again."
          onRetry={retry}
        />
      </div>
    )
  }

  const groups = activity.groups
  const filteredGroups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => matchesFilter(it, activeFilter)),
    }))
    .filter((g) => g.items.length > 0)

  if (groups.length === 0) {
    return (
      <div
        className={cn("flex flex-1 items-center justify-center p-6", className)}
      >
        <QueryEmptyState
          title="No activity yet"
          description="Your transactions will appear here."
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
      <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
        Activity
      </h1>

      <ActivityFilters active={activeFilter} onChange={setActiveFilter} />

      {filteredGroups.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No {activeFilter === "all" ? "" : activeFilter} transactions.
        </p>
      )}
      <ActivityGroupList groups={filteredGroups} onSelect={setSelectedId} />

      {activity.hasNextPage && (
        <button
          type="button"
          onClick={() => void activity.fetchNextPage()}
          disabled={activity.isFetchingNextPage}
          className={cn(
            "mx-auto rounded-full border border-border px-5 py-2 text-[13px] font-semibold text-foreground",
            "transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-60"
          )}
        >
          {activity.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}

      <TransactionDetailModal
        transactionId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </div>
  )
}
