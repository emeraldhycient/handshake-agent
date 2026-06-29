"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/shared/status-pill"
import { TransactionDetailModal } from "@/components/shared/transaction-detail-modal"
import { useActivity } from "@/lib/query/hooks"
import type { ActivityTabProps } from "@/types/components"

export function ActivityTab({ className }: ActivityTabProps) {
  const { data: groups, isLoading, isError } = useActivity()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div
        className={cn("flex min-h-0 flex-1 flex-col bg-background", className)}
      >
        <div className="flex-none px-5 pt-[54px] pb-[18px] text-primary-foreground [background:linear-gradient(162deg,var(--primary)_0%,var(--primary-deep)_100%)]">
          <Skeleton className="h-6 w-24 bg-white/20" />
          <Skeleton className="mt-1.5 h-4 w-48 bg-white/20" />
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {[1, 2].map((g) => (
            <div key={g}>
              <Skeleton className="mb-2 h-3 w-16" />
              <div className="overflow-hidden rounded-[18px] border border-border bg-card">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 border-t border-border px-[15px] py-[13px] first:border-t-0"
                  >
                    <Skeleton className="h-9 w-9 rounded-[10px]" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-28" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-2 bg-background p-8",
          className
        )}
      >
        <p className="text-sm font-semibold text-foreground">
          Could not load activity
        </p>
        <p className="text-center text-sm text-muted-foreground">
          Check your connection and try again.
        </p>
      </div>
    )
  }

  if (!groups || groups.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-2 bg-background p-8",
          className
        )}
      >
        <p className="text-sm font-semibold text-foreground">No activity yet</p>
        <p className="text-center text-sm text-muted-foreground">
          Your transactions will appear here.
        </p>
      </div>
    )
  }

  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col bg-background", className)}
    >
      <div className="flex-none px-5 pt-[54px] pb-[18px] text-primary-foreground [background:linear-gradient(162deg,var(--primary)_0%,var(--primary-deep)_100%)]">
        <div className="text-[22px] font-extrabold tracking-[-0.01em]">
          Activity
        </div>
        <div className="mt-0.5 text-[13px] text-primary-foreground/70">
          Every transaction, with a receipt.
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {groups.map((group) => (
          <div key={group.group}>
            <div className="mb-[9px] ml-1 text-[12px] font-bold tracking-[0.05em] text-muted-foreground uppercase">
              {group.group}
            </div>
            <div className="overflow-hidden rounded-[18px] border border-border bg-card">
              {group.items.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  data-tx-id={item.id}
                  aria-label={`View details for ${item.title}`}
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-3 px-[15px] py-[13px] text-left",
                    "transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
                    i > 0 && "border-t border-border"
                  )}
                >
                  <div
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] text-[17px] font-bold"
                    style={{ backgroundColor: item.tint, color: item.col }}
                    aria-hidden="true"
                  >
                    {item.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-bold text-foreground">
                      {item.title}
                    </div>
                    <div className="text-[12.5px] text-muted-foreground tabular-nums">
                      {item.sub}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[14px] font-bold text-foreground tabular-nums">
                      {item.amount}
                    </div>
                    <div className="mt-0.5">
                      <StatusPill tone={item.statusTone}>
                        {item.status}
                      </StatusPill>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Transaction detail modal ─────────────────────────────────────────── */}
      <TransactionDetailModal
        transactionId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </div>
  )
}
