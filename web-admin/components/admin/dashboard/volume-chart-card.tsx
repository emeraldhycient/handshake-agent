"use client"

import { useMemo } from "react"

import { FeatureCard } from "@/components/admin/feature-card"
import { ChartBars } from "@/components/admin/chart-bars"
import { Skeleton } from "@/components/ui/skeleton"
import { VOL_COLORS } from "@/constants/dashboard"
import { volBarsFrom } from "@/lib/dashboard/format"
import type { VolumeChartCardProps } from "@/types"

/** The volume-chart legend swatches (design lines 30-42). */
function VolumeLegend() {
  return (
    <div className="flex flex-wrap gap-[13px]">
      {(
        [
          ["buy", VOL_COLORS.buy],
          ["sell", VOL_COLORS.sell],
          ["send", VOL_COLORS.send],
          ["swap", VOL_COLORS.swap],
          ["ticket", VOL_COLORS.ticket],
        ] as const
      ).map(([label, color]) => (
        <div key={label} className="flex items-center gap-[5px]">
          <span
            aria-hidden
            className="size-[9px] rounded-[3px]"
            style={{ background: color }}
          />
          <span className="text-[11px] font-semibold text-ink2">{label}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * The Transaction-volume card. Wired to the real `txnVolume.stackedSeries` (Phase
 * 6b) — loading skeleton / empty (no txns in range) / data (the stacked-bar
 * silhouette). The error branch is shared with the KPI panel above.
 */
export function VolumeChartCard({ data, isLoading }: VolumeChartCardProps) {
  const bars = useMemo(
    () => (data ? volBarsFrom(data.txnVolume.stackedSeries) : []),
    [data]
  )

  return (
    <FeatureCard>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-ink">Transaction volume</div>
          <div className="mt-0.5 text-xs text-ink2 tabular-nums">
            by day · stacked by capability
          </div>
        </div>
        <VolumeLegend />
      </div>
      <div className="mt-4">
        {isLoading ? (
          <Skeleton className="h-[180px] rounded-[12px]" />
        ) : bars.length === 0 ? (
          <div className="flex h-[180px] items-center justify-center text-[12.5px] text-ink3">
            No transactions in this range.
          </div>
        ) : (
          <ChartBars
            bars={bars}
            ariaLabel="Transaction volume by day, stacked by capability"
            showLegend={false}
          />
        )}
      </div>
    </FeatureCard>
  )
}
