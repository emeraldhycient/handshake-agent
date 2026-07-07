import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { KYC_GRID } from "@/constants/kyc-review"
import type { KycQueueTableProps } from "@/types/components"

import { KycQueueRowLine } from "./kyc-queue-row"

/** The queue table card — the design header grid + the four async branches (§5). */
export function KycQueueTable({
  isLoading,
  isError,
  isEmpty,
  pageRows,
  onOpen,
  onRetry,
}: KycQueueTableProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div
        className={cn(
          KYC_GRID,
          "border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase"
        )}
      >
        <div>Applicant</div>
        <div>Requested tier</div>
        <div>SLA age</div>
        <div>Assignee</div>
        <div />
      </div>

      {/* Loading — skeleton rows matching the design row height */}
      {isLoading ? (
        <div aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                KYC_GRID,
                "items-center border-b border-line2 px-[18px] py-[13px] last:border-b-0"
              )}
            >
              <div className="flex items-center gap-[11px]">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
              </div>
              <Skeleton className="h-4 w-14 rounded-full" />
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-3 w-24" />
              <div />
            </div>
          ))}
        </div>
      ) : isError ? (
        /* Error — tokened inline error with a retry affordance */
        <div className="p-[40px] text-center">
          <p className="text-[13px] font-bold text-tdn">
            Couldn&apos;t load the review queue
          </p>
          <p className="mt-1 text-[12.5px] text-ink2">
            Something went wrong fetching applicants in this bucket.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex h-9 items-center rounded-[10px] border border-line bg-card px-3.5 text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      ) : isEmpty ? (
        /* Empty bucket (design copy) */
        <div className="p-[50px] text-center text-[13px] text-ink3">
          Nothing in this bucket.
        </div>
      ) : (
        pageRows.map((row) => (
          <KycQueueRowLine key={row.id} row={row} onOpen={onOpen} />
        ))
      )}
    </div>
  )
}
