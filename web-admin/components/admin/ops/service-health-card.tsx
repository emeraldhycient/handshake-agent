"use client"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { useDashboardMetrics } from "@/lib/query/hooks"
import {
  DEFAULT_RANGE,
  HEALTH_TEXT,
  SERVICE_STATUS_LABEL,
} from "@/constants/ops"
import { pctLabel, serviceHealth } from "@/lib/ops/format"
import type { ServiceHealthRowProps } from "@/types"

/** One service-health row (name + success/error rate + status word + counts). */
function ServiceHealthRow({ service }: ServiceHealthRowProps) {
  const health = serviceHealth(service.successRate)
  const errorRate = Math.max(0, 1 - service.successRate)
  return (
    <div className="flex items-center gap-[11px] border-b border-line2 py-[11px] last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-bold text-ink">
          {service.service}
        </div>
        <div className="text-[10.5px] text-ink3 tabular-nums">
          <span className="text-tok">
            {service.completed.toLocaleString()} completed
          </span>{" "}
          ·{" "}
          <span className="text-tdn">
            {service.failed.toLocaleString()} failed
          </span>{" "}
          · <span>{pctLabel(errorRate)} errors</span>
        </div>
      </div>
      <div className="flex-none text-right">
        <div
          className={cn(
            "text-sm font-extrabold tabular-nums",
            HEALTH_TEXT[health]
          )}
        >
          {pctLabel(service.successRate)}
        </div>
        <div className={cn("text-[10px] font-bold", HEALTH_TEXT[health])}>
          {SERVICE_STATUS_LABEL[health]}
        </div>
      </div>
    </div>
  )
}

/**
 * Service-health card — reuses `useDashboardMetrics().serviceHealth`. Four async
 * branches (loading / error / empty / data). Its own query so it renders alongside
 * the ops board without coupling either fetch. Read-only oversight (§3.1).
 */
export function ServiceHealthCard() {
  const { data, isLoading, isError, isSuccess, refetch } =
    useDashboardMetrics(DEFAULT_RANGE)
  const services = data?.serviceHealth.services ?? []

  return (
    <div className="mt-[14px] rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Service health
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2.5" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <div className="text-center">
          <p className="text-[12.5px] font-bold text-tdn">
            Couldn&apos;t load service health
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 inline-flex h-8 items-center rounded-[9px] border border-line bg-card px-3.5 text-[12px] font-bold text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {isSuccess && services.length === 0 && (
        <p className="text-[12.5px] text-ink3">
          No service activity in the last 30 days.
        </p>
      )}

      {isSuccess && services.length > 0 && (
        <div>
          {services.map((service) => (
            <ServiceHealthRow key={service.service} service={service} />
          ))}
        </div>
      )}
    </div>
  )
}
