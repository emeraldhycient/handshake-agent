"use client"

import { FeatureCard } from "@/components/admin/feature-card"
import { Skeleton } from "@/components/ui/skeleton"
import { activityItemFrom } from "@/lib/dashboard/format"
import type { DashboardOpsCardProps } from "@/types"

/**
 * Live-activity card — wired to `MetricsOps.activityFeed`. Four async branches:
 * loading skeleton / error / empty (no recent events) / data (the event rows).
 */
export function LiveActivityCard({
  ops,
  isLoading,
  isError,
}: DashboardOpsCardProps) {
  const items = ops ? ops.activityFeed.map(activityItemFrom) : []

  return (
    <FeatureCard>
      <div className="mb-3 text-sm font-bold text-ink">Live activity</div>
      {isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[42px] rounded-[9px]" />
          ))}
        </div>
      ) : isError ? (
        <div className="py-6 text-center text-[12.5px] text-ink3">
          Activity feed unavailable.
        </div>
      ) : items.length === 0 ? (
        <div className="py-6 text-center text-[12.5px] text-ink3">
          No recent activity.
        </div>
      ) : (
        <div className="flex flex-col">
          {items.map((a, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-line2 py-[9px] last:border-0"
            >
              <span
                aria-hidden
                className="flex size-[30px] flex-none items-center justify-center rounded-[9px]"
                style={{ background: a.iconBg, color: a.iconFg }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path
                    d={a.icon}
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold text-ink">
                  {a.text}
                </div>
                <div className="font-mono text-[10.5px] text-ink3 tabular-nums">
                  {a.meta}
                </div>
              </div>
              <span className="flex-none text-[10.5px] text-ink3 tabular-nums">
                {a.time}
              </span>
            </div>
          ))}
        </div>
      )}
    </FeatureCard>
  )
}
