import { buildKpiTiles } from "@/lib/metrics/kpis"
import type { MetricsCardProps } from "@/types"

import { KpiTile } from "./kpi-tile"

/** The four-tile KPI grid — the hero total + success rate, active users, and revenue. */
export function KpiGrid({ data }: MetricsCardProps) {
  return (
    <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      {buildKpiTiles(data).map((tile) => (
        <KpiTile key={tile.label} {...tile} />
      ))}
    </div>
  )
}
