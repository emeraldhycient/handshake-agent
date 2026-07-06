"use client"

import { cn } from "@/lib/utils"
import { FeatureCard } from "@/components/admin/feature-card"
import { Skeleton } from "@/components/ui/skeleton"
import { fmtInt, healthRowFrom } from "@/lib/dashboard/format"
import type { DashboardOpsCardProps } from "@/types/components"

/**
 * System-health card — wired to `MetricsOps.systemHealth`. Four async branches:
 * loading skeleton / error (unavailable) / empty (no providers) / data (per-provider
 * rows + queue/recon footer).
 */
export function SystemHealthCard({
  ops,
  isLoading,
  isError,
}: DashboardOpsCardProps) {
  const rows = ops ? ops.systemHealth.providers.map(healthRowFrom) : []
  const reconDrift = ops?.systemHealth.reconDriftCount ?? 0

  return (
    <FeatureCard className="flex flex-col">
      <div className="mb-3.5 flex items-center justify-between">
        <div className="text-sm font-bold text-ink">System health</div>
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-tok">
          <span
            aria-hidden
            className="size-[14px] rounded-full border-2 border-current border-t-transparent motion-safe:animate-hs-spin"
          />
          Live
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[38px] rounded-[8px]" />
          ))}
        </div>
      ) : isError ? (
        <div className="py-6 text-center text-[12.5px] text-ink3">
          Health metrics unavailable.
        </div>
      ) : rows.length === 0 ? (
        <div className="py-6 text-center text-[12.5px] text-ink3">
          No providers registered.
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {rows.map((h) => (
            <div
              key={h.name}
              className="flex items-center gap-[11px] border-b border-line2 py-[9px] last:border-0"
            >
              <span
                aria-hidden
                className="size-2 flex-none rounded-full"
                style={{ background: h.dot, boxShadow: `0 0 0 3px ${h.halo}` }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-ink">
                  {h.name}
                </div>
                <div className="text-[10.5px] text-ink3">{h.note}</div>
              </div>
              <span
                className="text-[11px] font-bold tabular-nums"
                style={{ color: h.fg }}
              >
                {h.status}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto flex gap-[9px] pt-3.5">
        <div className="flex-1 rounded-[10px] bg-card2 px-[11px] py-[9px]">
          <div className="text-[10.5px] font-semibold text-ink3">
            Webhook queue
          </div>
          <div className="mt-px text-base font-extrabold text-ink tabular-nums">
            {ops ? fmtInt(ops.systemHealth.webhookQueueDepth) : "—"}
          </div>
        </div>
        <div className="flex-1 rounded-[10px] bg-card2 px-[11px] py-[9px]">
          <div className="text-[10.5px] font-semibold text-ink3">
            Recon drift
          </div>
          <div
            className={cn(
              "mt-px text-base font-extrabold tabular-nums",
              reconDrift > 0 ? "text-twn" : "text-ink"
            )}
          >
            {ops ? `${fmtInt(reconDrift)} open` : "—"}
          </div>
        </div>
      </div>
    </FeatureCard>
  )
}
