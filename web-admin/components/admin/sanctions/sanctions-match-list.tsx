"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { SanctionsMatchCard } from "@/components/admin/sanctions/sanctions-match-card"
import type { SanctionsMatchListProps } from "@/types"

/** Loading placeholder for the match-card list (matches the card silhouette). */
function LoadingMatches() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-[74px] w-full rounded-[16px]" />
      <Skeleton className="h-[74px] w-full rounded-[16px]" />
      <Skeleton className="h-[74px] w-full rounded-[16px]" />
    </div>
  )
}

/** Tokened inline error with a retry affordance. */
function ErrorMatches({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-[16px] border border-sdn bg-sdn/40 p-5 text-center">
      <p className="text-sm font-bold text-tdn">
        Failed to load screening matches
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 cursor-pointer rounded-[9px] border border-line bg-card px-[14px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Retry
      </button>
    </div>
  )
}

/** Design-consistent empty state for the match-card list. */
function EmptyMatches() {
  return (
    <div className="rounded-[16px] border border-line bg-card px-5 py-8 text-center">
      <p className="text-sm font-bold text-ink">No screening matches</p>
      <p className="mt-1 text-[12.5px] text-ink2">
        Screening runs with no flagged counterparties will appear here.
      </p>
    </div>
  )
}

/** The screening-match section — loading / error / empty / data over the match cards. */
export function SanctionsMatchList({
  records,
  isLoading,
  isError,
  isSuccess,
  onRetry,
  doneOf,
  onClear,
  onEscalate,
  onBlock,
}: SanctionsMatchListProps) {
  if (isLoading) return <LoadingMatches />
  if (isError) return <ErrorMatches onRetry={onRetry} />
  if (isSuccess && records.length === 0) return <EmptyMatches />

  return (
    <div className="flex flex-col gap-3">
      {records.map((record) => (
        <SanctionsMatchCard
          key={record.id}
          record={record}
          done={doneOf(record)}
          onClear={() => onClear(record.id)}
          onEscalate={() => onEscalate(record.id)}
          onBlock={() => onBlock(record.id)}
        />
      ))}
    </div>
  )
}
