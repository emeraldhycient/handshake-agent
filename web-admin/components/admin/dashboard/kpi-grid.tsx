"use client"

import { useMemo } from "react"

import { KpiCard } from "@/components/admin/kpi-card"
import { Skeleton } from "@/components/ui/skeleton"
import { deriveKpis } from "@/lib/dashboard/format"
import type { KpiGridProps } from "@/types/components"

const GRID = "mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4"

/** The 4×2 KPI tile grid rendered from the real composite summary (data branch). */
export function KpiGrid({ data, openComplianceCases }: KpiGridProps) {
  const kpis = useMemo(
    () => deriveKpis(data, openComplianceCases),
    [data, openComplianceCases]
  )
  return (
    <div className={GRID}>
      {kpis.map((k) => (
        <KpiCard
          key={k.label}
          label={k.label}
          value={k.value}
          delta={k.delta}
          deltaNote={k.deltaNote}
          hero={k.hero}
          tone={k.tone}
        />
      ))}
    </div>
  )
}

/** Loading placeholder for the KPI grid — 8 tile-sized skeletons in the 4×2 grid. */
export function KpiGridSkeleton() {
  return (
    <div className={GRID} aria-busy="true">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-[104px] rounded-2xl" />
      ))}
    </div>
  )
}
