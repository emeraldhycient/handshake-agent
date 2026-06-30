"use client"

/**
 * KycReviewPage — the compliance reviewer's queue. Lists submissions awaiting
 * review (userId / email / status / submittedAt); clicking a row opens the
 * `KycSubmission` drawer to review and Approve / Reject.
 *
 * Four async branches on the queue query: loading / error / empty / data.
 */
import { useState } from "react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { KycStatusBadge } from "@/components/admin/user-status-badge"
import { KycSubmission } from "@/components/admin/kyc-submission"
import { useKycQueue } from "@/lib/query/hooks"

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

export function KycReviewPage() {
  const queue = useKycQueue()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          KYC review
        </h1>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {queue.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {queue.isError && (
        <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">
            Failed to load the KYC queue
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {queue.isSuccess && queue.data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No submissions awaiting review.
        </p>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {queue.isSuccess && queue.data.items.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.data.items.map((item) => (
                <TableRow
                  key={item.userId}
                  role="button"
                  tabIndex={0}
                  aria-label={`Review ${item.email ?? item.userId}`}
                  className="cursor-pointer focus-visible:bg-muted focus-visible:outline-none"
                  onClick={() => setSelectedId(item.userId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      setSelectedId(item.userId)
                    }
                  }}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {item.userId.slice(0, 8)}…
                  </TableCell>
                  <TableCell className="font-medium text-foreground">
                    {item.email ?? "—"}
                  </TableCell>
                  <TableCell>
                    <KycStatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatDate(item.submittedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <KycSubmission
        userId={selectedId}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      />
    </div>
  )
}
