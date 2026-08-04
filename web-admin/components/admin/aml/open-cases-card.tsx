"use client"

import { useMemo } from "react"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { useComplianceEvents } from "@/lib/query/hooks"
import { CardShell, InlineError } from "@/components/admin/aml/aml-shells"
import { CASE_STATUS_META, OPEN_STATUSES } from "@/constants/aml"
import { caseMeta, caseTitle } from "@/lib/aml/format"
import type { OpenCasesCardProps } from "@/types"

/** Open-cases card (design lines 10–13) — read-wired to `useComplianceEvents`. */
export function OpenCasesCard({ onDraftSar, onOpenCase }: OpenCasesCardProps) {
  // The queue shows still-open cases; fetch unfiltered and narrow to open statuses
  // client-side (the API takes a single status filter — see shapeGaps).
  const query = useComplianceEvents({})
  const openCases = useMemo(
    () =>
      (query.data?.items ?? []).filter((e) => OPEN_STATUSES.includes(e.status)),
    [query.data]
  )

  return (
    <CardShell>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-extrabold text-ink">Open cases</div>
        <button
          type="button"
          onClick={onDraftSar}
          className="cursor-pointer text-[11.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Draft SAR/CTR
        </button>
      </div>

      {query.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-[40px] rounded-[10px]" />
          <Skeleton className="h-[40px] rounded-[10px]" />
        </div>
      ) : query.isError ? (
        <InlineError
          label="Couldn't load open cases."
          onRetry={() => query.refetch()}
        />
      ) : openCases.length === 0 ? (
        <p className="py-2 text-[12px] text-ink3">No open cases.</p>
      ) : (
        <div>
          {openCases.map((c) => {
            const meta = CASE_STATUS_META[c.status]
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpenCase(c.id)}
                aria-label={`Open case ${caseTitle(c)}`}
                className="flex w-full items-center gap-[11px] border-b border-line2 py-2.5 text-left transition-colors last:border-b-0 hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span
                  aria-hidden="true"
                  className={cn("size-2 flex-none rounded-full", meta.dot)}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-ink">
                    {caseTitle(c)}
                  </div>
                  <div className="truncate text-[10.5px] text-ink3">
                    {caseMeta(c)}
                  </div>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10.5px] font-bold",
                    meta.pillBg,
                    meta.pillFg
                  )}
                >
                  {meta.label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </CardShell>
  )
}
