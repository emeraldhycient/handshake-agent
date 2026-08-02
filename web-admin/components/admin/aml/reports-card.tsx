"use client"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { useComplianceReports } from "@/lib/query/hooks"
import { CardShell, InlineError } from "@/components/admin/aml/aml-shells"
import { REPORT_STATUS_META } from "@/constants/aml"
import type { ReportsCardProps } from "@/types"

/**
 * Compliance-reports card — the SAR/STR filing list (wired to `useComplianceReports`).
 * A `draft` row exposes a step-up-gated "Submit report" affordance (`onSubmit`).
 */
export function ReportsCard({ onSubmit }: ReportsCardProps) {
  const query = useComplianceReports()
  const reports = query.data?.items ?? []

  return (
    <CardShell>
      <div className="mb-2.5 text-[13px] font-extrabold text-ink">
        Compliance reports{" "}
        <span className="font-semibold text-ink3">· SAR / STR filings</span>
      </div>

      {query.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-[36px] rounded-[10px]" />
          <Skeleton className="h-[36px] rounded-[10px]" />
        </div>
      ) : query.isError ? (
        <InlineError
          label="Couldn't load compliance reports."
          onRetry={() => query.refetch()}
        />
      ) : reports.length === 0 ? (
        <p className="py-1 text-[12px] text-ink3">No reports filed yet.</p>
      ) : (
        <div>
          {reports.map((report) => {
            const meta = REPORT_STATUS_META[report.status]
            const when = new Date(
              report.submittedAt ?? report.createdAt
            ).toLocaleDateString()
            return (
              <div
                key={report.id}
                className="flex items-center gap-[11px] border-b border-line2 py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-bold text-ink uppercase">
                    {report.reportType}
                  </div>
                  <div className="truncate text-[10.5px] text-ink3">
                    {report.relatedEvents.length}{" "}
                    {report.relatedEvents.length === 1 ? "case" : "cases"} ·{" "}
                    {when}
                    {report.submissionRef ? ` · ${report.submissionRef}` : ""}
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
                {report.status === "draft" && (
                  <button
                    type="button"
                    onClick={() => onSubmit(report)}
                    aria-label={`Submit report ${report.reportType.toUpperCase()}`}
                    className="flex-none rounded-[9px] border border-line px-2.5 py-1 text-[11px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    Submit report
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </CardShell>
  )
}
