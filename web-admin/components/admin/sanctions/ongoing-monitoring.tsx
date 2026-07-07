"use client"

import { useMemo, useState, type ReactNode } from "react"

import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { useSanctionsMonitoring } from "@/lib/query/hooks"
import { toMonitorRows } from "@/lib/sanctions/format"
import type { SanctionsMonitoringView } from "@handshake-agent/contracts"
import type { SanctionsMonitorRow } from "@/types/components"

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
 * `useSanctionsMonitoring()` view (four policy flags from layered config), then each
 * Switch is CONTROLLED off local `useState` so it flips + holds when clicked (persisting
 * a toggle is a Phase-7 write). Four async branches render.
 */
export function OngoingMonitoring() {
  const monitoring = useSanctionsMonitoring()
  // Local optimistic soft-toggle overrides; the base value comes from the fetched view.
  const [overrides, setOverrides] = useState<
    Partial<Record<keyof SanctionsMonitoringView, boolean>>
  >({})
  const rows = useMemo<SanctionsMonitorRow[]>(
    () =>
      monitoring.data
        ? toMonitorRows(monitoring.data).map((r) => ({
            ...r,
            on: overrides[r.key] ?? r.on,
          }))
        : [],
    [monitoring.data, overrides]
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
            <Switch
              checked={row.on}
              onCheckedChange={(next) =>
                setOverrides((prev) => ({ ...prev, [row.key]: next }))
              }
              aria-label={row.label}
            />
          </li>
        ))}
      </ul>
    </MonitoringCard>
  )
}
