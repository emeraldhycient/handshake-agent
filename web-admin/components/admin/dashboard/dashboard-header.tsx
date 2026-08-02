"use client"

import { cn } from "@/lib/utils"
import { KPI_RANGES } from "@/constants/dashboard"
import type { DashboardHeaderProps } from "@/types"

/** The dashboard title + subtitle and the 24h/7d/30d KPI-range switcher. */
export function DashboardHeader({
  range,
  onRangeChange,
}: DashboardHeaderProps) {
  return (
    <div className="mb-[22px] flex flex-wrap items-end justify-between gap-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Operations overview
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Live platform health, money movement, and what needs your attention.
        </p>
      </div>
      <div
        role="group"
        aria-label="Date range"
        className="flex rounded-[11px] border border-line bg-card p-[3px]"
      >
        {KPI_RANGES.map((r) => {
          const active = r === range
          return (
            <button
              key={r}
              type="button"
              aria-pressed={active}
              onClick={() => onRangeChange(r)}
              className={cn(
                "cursor-pointer rounded-[8px] px-3.5 py-1.5 text-[12.5px] font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                active ? "bg-btn-dark text-white" : "text-ink2 hover:text-ink"
              )}
            >
              {r}
            </button>
          )
        })}
      </div>
    </div>
  )
}
