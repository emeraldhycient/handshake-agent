"use client"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { HEALTH_DOT, HEALTH_TEXT, PROVIDER_STATUS_LABEL } from "@/constants/ops"
import { latencyLabel } from "@/lib/ops/format"
import type { ProviderTilesProps } from "@/types/components"

const GRID = "mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"

/** The 5-up provider status tiles (dot + name + latency + status). */
export function ProviderTiles({ providers }: ProviderTilesProps) {
  return (
    <div className={GRID}>
      {providers.map((provider) => (
        <div
          key={provider.key}
          className="rounded-[14px] border border-line bg-card px-[15px] py-[14px]"
        >
          <div className="mb-[7px] flex items-center gap-[7px]">
            <span
              className={cn("size-2 rounded-full", HEALTH_DOT[provider.health])}
              aria-hidden
            />
            <span className="text-xs font-bold text-ink">{provider.name}</span>
          </div>
          <div className="font-mono text-[11px] text-ink2 tabular-nums">
            {latencyLabel(provider.lastLatencyMs)}
          </div>
          <div
            className={cn(
              "mt-0.5 text-[10.5px] font-bold",
              HEALTH_TEXT[provider.health]
            )}
          >
            {PROVIDER_STATUS_LABEL[provider.health]}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Skeleton grid matching the 5-up provider tiles, for the loading branch. */
export function ProviderTilesSkeleton() {
  return (
    <div className={GRID} aria-busy="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="rounded-[14px] border border-line bg-card px-[15px] py-[14px]"
        >
          <Skeleton className="mb-[7px] h-3.5 w-24" />
          <Skeleton className="h-[11px] w-12" />
          <Skeleton className="mt-1 h-2.5 w-16" />
        </div>
      ))}
    </div>
  )
}
