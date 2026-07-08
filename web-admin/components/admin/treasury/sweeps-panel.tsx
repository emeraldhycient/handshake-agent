"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { SWEEP_STATUS } from "@/constants/treasury"
import type { SweepsPanelProps } from "@/types/components"

/**
 * The child-address sweeps panel — per-child address + gas balance + sweep lifecycle,
 * with the configured sweep-threshold footer. Read-only oversight (§3.1).
 */
export function SweepsPanel({
  sweeps,
  threshold,
  isLoading,
  isError,
  onRetry,
}: SweepsPanelProps) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3.5 text-[13px] font-extrabold text-ink">
        Child-address sweeps
      </div>

      {isError ? (
        <div className="py-4 text-center">
          <p className="text-[12.5px] font-semibold text-tdn">
            Failed to load sweeps
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-[9px] bg-btn-dark px-3 py-1.5 text-[11.5px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-8 rounded-md" />
          <Skeleton className="h-8 rounded-md" />
          <Skeleton className="h-8 rounded-md" />
        </div>
      ) : sweeps.length === 0 ? (
        <p className="py-4 text-center text-[12px] text-ink3">
          No child addresses to sweep.
        </p>
      ) : (
        sweeps.map((sweep) => {
          const tone = SWEEP_STATUS[sweep.status]
          return (
            <div
              key={sweep.id}
              className="flex items-center gap-2.5 border-b border-line2 py-2.5"
            >
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${tone.dot}`}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink2">
                {sweep.addr}
              </span>
              <span className="shrink-0 font-mono text-[12px] font-bold text-ink tabular-nums">
                {sweep.bal}
              </span>
              <span className={`shrink-0 text-[10.5px] font-bold ${tone.fg}`}>
                {sweep.status}
              </span>
            </div>
          )
        })
      )}

      {/* Sweep threshold footer — from the sweeps endpoint (mirrors sweep.threshold.trx). */}
      <div className="mt-3.5 flex justify-between border-t border-line2 pt-3">
        <span className="text-[11.5px] text-ink3">Sweep threshold</span>
        <span className="font-mono text-[12px] font-bold text-ink tabular-nums">
          {threshold}
        </span>
      </div>
    </div>
  )
}
