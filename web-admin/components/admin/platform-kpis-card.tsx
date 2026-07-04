"use client"

/**
 * PlatformKpisCard — the platform lifecycle KPI strip (go-readiness #7): new-user
 * growth, churn, and failed background jobs, each period-over-period for the
 * selected range. Presentational — the parent owns the `usePlatformKpis` query and
 * passes the four async branches. Read-only; nothing moves money (§3.1).
 */
import { FeatureCard } from "@/components/admin/feature-card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { PlatformKpisCardProps } from "@/types/components"

/** Format a ratio as a percentage; `signed` prefixes a + for non-negative growth. */
function pct(rate: number, signed = false): string {
  const value = (rate * 100).toFixed(1)
  const sign = signed && rate >= 0 ? "+" : ""
  return `${sign}${value}%`
}

function Tile({
  label,
  value,
  sub,
  valueAriaLabel,
  tone,
}: {
  label: string
  value: string
  sub: string
  valueAriaLabel?: string
  tone?: "up" | "down"
}) {
  return (
    <div className="rounded-[14px] border border-line bg-card2 p-[15px_16px]">
      <div className="text-xs font-semibold text-ink2">{label}</div>
      <div
        aria-label={valueAriaLabel}
        className={cn(
          "mt-1.5 text-[22px] leading-none font-extrabold tracking-tight tabular-nums",
          tone === "up" && "text-tok",
          tone === "down" && "text-tdn",
          !tone && "text-ink"
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11px] text-ink3">{sub}</div>
    </div>
  )
}

export function PlatformKpisCard({
  data,
  isLoading,
  isError,
}: PlatformKpisCardProps) {
  if (isLoading) {
    return (
      <FeatureCard>
        <div
          aria-busy="true"
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          <Skeleton className="h-[86px] rounded-[14px]" />
          <Skeleton className="h-[86px] rounded-[14px]" />
          <Skeleton className="h-[86px] rounded-[14px]" />
        </div>
      </FeatureCard>
    )
  }

  if (isError || !data) {
    return (
      <FeatureCard>
        <div className="text-sm font-bold text-ink">Platform KPIs</div>
        <p className="mt-3 text-[12.5px] text-tdn">
          Couldn&apos;t load platform KPIs. Please refresh.
        </p>
      </FeatureCard>
    )
  }

  const growthTone =
    data.newUsers.growthRate > 0
      ? "up"
      : data.newUsers.growthRate < 0
        ? "down"
        : undefined

  return (
    <FeatureCard>
      <div className="mb-3 text-sm font-bold text-ink">
        Platform KPIs
        <span className="ml-2 text-xs font-normal text-ink3">
          vs previous period
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          label="New users"
          value={String(data.newUsers.current)}
          valueAriaLabel="New users count"
          sub={`${pct(data.newUsers.growthRate, true)} vs ${data.newUsers.previous} prior`}
        />
        <Tile
          label="Growth"
          value={pct(data.newUsers.growthRate, true)}
          tone={growthTone}
          sub="new users, period over period"
        />
        <Tile
          label="Churn"
          value={pct(data.churn.churnRate)}
          tone={data.churn.churnRate > 0 ? "down" : undefined}
          sub={`${data.churn.churned} of ${data.churn.activePrevious} prior-active`}
        />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          label="Failed jobs"
          value={String(data.failedJobs)}
          valueAriaLabel="Failed jobs count"
          tone={data.failedJobs > 0 ? "down" : undefined}
          sub="settlement + wallet backfill, in range"
        />
      </div>
    </FeatureCard>
  )
}
