"use client"

import { useMemo, type ReactNode } from "react"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { useSanctionsMonitoring } from "@/lib/query/hooks"
import { toMonitorRows } from "@/lib/sanctions/format"
import type { SanctionsMonitorRow } from "@/types"

/** Card chrome shared by every branch of the ongoing-monitoring section. */
function MonitoringCard({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3.5 rounded-[16px] border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Ongoing monitoring
      </div>
      {children}
    </div>
  )
}

/**
 * The ongoing-monitoring card (design lines 17–20). Rows are seeded from the real
 * `useSanctionsMonitoring()` view (four policy flags from layered config) and render
 * as READ-ONLY status pills: there is no write path for the monitoring policy, so a
 * flippable switch would only mutate local state and lie to the operator. The policy
 * is tuned through /settings (layered config). Four async branches render.
 */
export function OngoingMonitoring() {
  const monitoring = useSanctionsMonitoring()
  const rows = useMemo<SanctionsMonitorRow[]>(
    () => (monitoring.data ? toMonitorRows(monitoring.data) : []),
    [monitoring.data]
  )

  if (monitoring.isLoading) {
    return (
      <MonitoringCard>
        <div className="flex flex-col gap-2.5" aria-busy="true">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      </MonitoringCard>
    )
  }

  if (monitoring.isError) {
    return (
      <MonitoringCard>
        <p className="text-[12.5px] font-bold text-tdn">
          Failed to load monitoring policy
        </p>
        <button
          type="button"
          onClick={() => void monitoring.refetch()}
          className="mt-2 cursor-pointer rounded-[9px] border border-line bg-card px-[14px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Retry
        </button>
      </MonitoringCard>
    )
  }

  if (rows.length === 0) {
    return (
      <MonitoringCard>
        <p className="text-[12.5px] text-ink2">
          No monitoring policy configured.
        </p>
      </MonitoringCard>
    )
  }

  return (
    <MonitoringCard>
      <ul>
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-center justify-between gap-4 border-b border-line2 py-2.5 last:border-b-0"
          >
            <span className="text-[12.5px] text-ink2">{row.label}</span>
            {/* Read-only status pill — the text carries the state (§13.8). */}
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[10.5px] font-bold",
                row.on ? "bg-sok text-tok" : "bg-card2 text-ink3"
              )}
            >
              {row.on ? "On" : "Off"}
            </span>
          </li>
        ))}
      </ul>
    </MonitoringCard>
  )
}
