"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { ReconBreakCard } from "@/components/admin/reconciliation/recon-break-card"
import type { ReconBreakListProps } from "@/types/components"

/** The break board: loading skeletons / error (retry) / empty / the break cards. */
export function ReconBreakList({
  breaks,
  isLoading,
  isError,
  onRetry,
  onOpenTx,
  onEscalate,
  onAccept,
  onResolve,
}: ReconBreakListProps) {
  if (isError) {
    return (
      <div className="rounded-2xl border border-line bg-card px-5 py-8 text-center">
        <p className="text-[12.5px] font-semibold text-tdn">
          Failed to load reconciliation breaks
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-[9px] bg-btn-dark px-3.5 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Retry
        </button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-[104px] rounded-2xl" />
        <Skeleton className="h-[104px] rounded-2xl" />
        <Skeleton className="h-[104px] rounded-2xl" />
      </div>
    )
  }

  if (breaks.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-card px-5 py-10 text-center">
        <p className="text-[13px] font-bold text-ink">No open breaks</p>
        <p className="mt-1 text-[12px] text-ink3">
          Provider and ledger are reconciled — nothing needs human action.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {breaks.map((b) => (
        <ReconBreakCard
          key={b.id}
          item={b}
          onOpenTx={onOpenTx}
          onEscalate={onEscalate}
          onAccept={onAccept}
          onResolve={onResolve}
        />
      ))}
    </div>
  )
}
