"use client"

import { Skeleton } from "@/components/ui/skeleton"
import type { PayoutQueuePanelProps } from "@/types/components"

/**
 * The payout / withdrawal approval queue — real pending payouts (read-only). Large
 * payouts carry the amber "Maker-checker" tag and route Approve through the dual-control
 * flow. Approving releases NO money here — it raises a four-eyes change request (§3.1).
 */
export function PayoutQueuePanel({
  payouts,
  isLoading,
  isError,
  approved,
  onRetry,
  onApprove,
}: PayoutQueuePanelProps) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[13px] font-extrabold text-ink">
          Payout / withdrawal approval queue
        </div>
        <span className="text-[11px] font-semibold text-ink3">
          Large payouts require maker-checker
        </span>
      </div>

      {isError ? (
        <div className="py-4 text-center">
          <p className="text-[12.5px] font-semibold text-tdn">
            Failed to load payout queue
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
          <Skeleton className="h-12 rounded-md" />
          <Skeleton className="h-12 rounded-md" />
          <Skeleton className="h-12 rounded-md" />
        </div>
      ) : payouts.length === 0 ? (
        <p className="py-4 text-center text-[12px] text-ink3">
          No payouts awaiting release.
        </p>
      ) : (
        payouts.map((row) => {
          const done = approved[row.id]
          return (
            <div
              key={row.id}
              className="flex items-center gap-3 border-b border-line2 py-3 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold text-ink">
                  {row.to}
                </div>
                <div className="font-mono text-[11px] text-ink3">
                  {row.ref} · {row.method}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-[13.5px] font-extrabold text-ink tabular-nums">
                  {row.amt}
                </div>
                {row.fiat && (
                  <div className="font-mono text-[11px] text-ink3 tabular-nums">
                    {row.fiat}
                  </div>
                )}
              </div>
              {row.big && (
                <span className="shrink-0 rounded-md bg-swn px-2 py-[3px] text-[9.5px] font-extrabold tracking-[0.02em] text-twn uppercase">
                  Maker-checker
                </span>
              )}
              {done ? (
                <span className="shrink-0 rounded-[9px] bg-sok px-3.5 py-2 text-[12px] font-bold text-tok">
                  Requested
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onApprove(row)}
                  className={`shrink-0 rounded-[9px] px-3.5 py-2 text-[12px] font-bold transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
                    row.big
                      ? "bg-btn-dark text-white"
                      : "bg-brand-green text-white"
                  }`}
                >
                  Approve
                </button>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
