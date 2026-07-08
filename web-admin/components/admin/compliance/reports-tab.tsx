"use client"

import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useComplianceReports } from "@/lib/query/hooks"
import {
  ErrorPanel,
  LoadingRows,
  TableCard,
  EmptyNote,
} from "@/components/admin/compliance/compliance-shells"
import { REPORT_VARIANT } from "@/constants/compliance"
import { formatDate } from "@/lib/compliance/format"
import type { ReportsTabProps } from "@/types/components"

/** Reports tab — SAR/STR filings; a draft row exposes a Submit. */
export function ReportsTab({ onSubmit }: ReportsTabProps) {
  const reports = useComplianceReports()

  if (reports.isLoading) return <LoadingRows />
  if (reports.isError) return <ErrorPanel what="compliance reports" />
  if (reports.isSuccess && reports.data.items.length === 0) {
    return <EmptyNote>No reports.</EmptyNote>
  }
  if (!reports.isSuccess) return null

  return (
    <TableCard>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Events</TableHead>
          <TableHead>Submitted</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {reports.data.items.map((report) => (
          <TableRow key={report.id}>
            <TableCell className="font-semibold text-ink">
              {report.reportType.toUpperCase()}
            </TableCell>
            <TableCell>
              <Badge variant={REPORT_VARIANT[report.status]}>
                {report.status}
              </Badge>
            </TableCell>
            <TableCell className="text-right text-ink2 tabular-nums">
              {report.relatedEvents.length}
            </TableCell>
            <TableCell className="text-ink2 tabular-nums">
              {formatDate(report.submittedAt)}
            </TableCell>
            <TableCell className="text-right">
              {report.status === "draft" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSubmit(report)}
                >
                  Submit
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableCard>
  )
}
