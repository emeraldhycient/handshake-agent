"use client"

/**
 * OperatorDashboard — the "Dashboard" screen (design `Dash.html`, spec §6.1).
 * Orchestrator: owns the range state, the two independent metrics queries (composite
 * + ops, so a 403 on one degrades its panels without hiding the other), and the four
 * async branches for the KPI panel; composes the header, KPI grid, volume chart, and
 * the ops/attention cards. Read-only projections — nothing here moves money (§3.1).
 */
import { useMemo, useState } from "react"

import { rangeForDays } from "@/lib/metrics-range"
import { useDashboardMetrics, useMetricsOps } from "@/lib/query/hooks"
import { ApiError } from "@/lib/api/client"
import { RANGE_DAYS } from "@/constants/dashboard"
import { DashboardHeader } from "@/components/admin/dashboard/dashboard-header"
import { KpiGrid, KpiGridSkeleton } from "@/components/admin/dashboard/kpi-grid"
import { VolumeChartCard } from "@/components/admin/dashboard/volume-chart-card"
import { SystemHealthCard } from "@/components/admin/dashboard/system-health-card"
import { LiveActivityCard } from "@/components/admin/dashboard/live-activity-card"
import { ApprovalsCard } from "@/components/admin/dashboard/approvals-card"
import { AlertsCard } from "@/components/admin/dashboard/alerts-card"
import type { DashboardRangeId } from "@/types"

export function OperatorDashboard() {
  const [range, setRange] = useState<DashboardRangeId>("24h")

  // KPI tiles + range switcher → the real composite metrics endpoint.
  const metricsRange = useMemo(() => rangeForDays(RANGE_DAYS[range]), [range])
  const query = useDashboardMetrics(metricsRange)
  const isForbidden =
    query.error instanceof ApiError && query.error.status === 403

  // System-health / Live-activity / Open-compliance → the range-independent ops
  // endpoint (a distinct query so a 403 there degrades only those panels).
  const opsQuery = useMetricsOps()

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-bg">
      <div className="mx-auto w-full max-w-[1320px] px-[30px] pt-[26px] pb-[60px]">
        <DashboardHeader range={range} onRangeChange={setRange} />

        {/* KPI TILES — four async branches: loading / error / (no access) / data. */}
        {query.isLoading && <KpiGridSkeleton />}

        {query.isError &&
          (isForbidden ? (
            <div className="mb-4 rounded-[18px] border border-swn bg-swn/40 p-6 text-center">
              <p className="text-sm font-bold text-twn">No metrics access</p>
              <p className="mt-1 text-[12.5px] text-ink2">
                Your role can&apos;t view the operational dashboard. Ask a super
                admin to grant the Metrics permission.
              </p>
            </div>
          ) : (
            <div className="mb-4 rounded-[18px] border border-sdn bg-sdn/40 p-6 text-center">
              <p className="text-sm font-bold text-tdn">
                Failed to load metrics
              </p>
              <button
                type="button"
                onClick={() => query.refetch()}
                className="mt-2 cursor-pointer rounded-[8px] bg-btn-dark px-3.5 py-1.5 text-[12.5px] font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Retry
              </button>
            </div>
          ))}

        {query.isSuccess && (
          <KpiGrid
            data={query.data}
            openComplianceCases={opsQuery.data?.compliance.openCases}
          />
        )}

        {/* Volume chart + System health */}
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
          <VolumeChartCard data={query.data} isLoading={query.isLoading} />
          <SystemHealthCard
            ops={opsQuery.data}
            isLoading={opsQuery.isLoading}
            isError={opsQuery.isError}
          />
        </div>

        {/* Attention row — Live activity | (Approvals + Alerts) */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LiveActivityCard
            ops={opsQuery.data}
            isLoading={opsQuery.isLoading}
            isError={opsQuery.isError}
          />
          <div className="flex flex-col gap-4">
            <ApprovalsCard />
            <AlertsCard />
          </div>
        </div>
      </div>
    </div>
  )
}
