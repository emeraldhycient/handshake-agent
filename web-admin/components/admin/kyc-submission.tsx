"use client"

/**
 * KycSubmission — the reviewer's drawer for one KYC submission (a right-side
 * Sheet). Opened by the queue with a `userId`; fetches the reviewable detail via
 * `useKycSubmission` and renders the applicant's names, DOB, **last-4 of NIN/BVN
 * only** (PII minimization, root §3.x), ID document type, liveness, and status,
 * plus the Approve / Reject actions.
 *
 * Four async branches on the submission query: loading / error / empty / data.
 */
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { KycStatusBadge } from "@/components/admin/user-status-badge"
import { KycReviewActions } from "@/components/admin/kyc-review-actions"
import { useKycSubmission } from "@/lib/query/hooks"
import type { KycSubmissionProps } from "@/types"

function fullName(first: string | null, last: string | null): string {
  const name = [first, last].filter(Boolean).join(" ")
  return name.length > 0 ? name : "Unknown applicant"
}

/** Show last-4 as a masked value, or em-dash when absent. Never the full digits. */
function mask4(last4: string | null): string {
  return last4 ? `•••• ${last4}` : "—"
}

export function KycSubmission({ userId, onOpenChange }: KycSubmissionProps) {
  const detail = useKycSubmission(userId)
  const submission = detail.data

  return (
    <Sheet open={userId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>KYC submission</SheetTitle>
          <SheetDescription>
            {submission
              ? fullName(submission.firstName, submission.lastName)
              : "Loading submission"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 p-4 pt-0">
          {/* ── Loading ──────────────────────────────────────────────────── */}
          {detail.isLoading && (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-24 w-full rounded-md" />
              <Skeleton className="h-24 w-full rounded-md" />
            </div>
          )}

          {/* ── Error ────────────────────────────────────────────────────── */}
          {detail.isError && (
            <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
              <p className="text-sm font-semibold text-destructive">
                Failed to load this submission
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Close and try again.
              </p>
            </div>
          )}

          {/* ── Data ─────────────────────────────────────────────────────── */}
          {detail.isSuccess && submission && (
            <>
              <section className="flex flex-col gap-2">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">First name</dt>
                  <dd className="text-foreground">
                    {submission.firstName ?? "—"}
                  </dd>
                  <dt className="text-muted-foreground">Last name</dt>
                  <dd className="text-foreground">
                    {submission.lastName ?? "—"}
                  </dd>
                  <dt className="text-muted-foreground">Date of birth</dt>
                  <dd className="text-foreground tabular-nums">
                    {submission.dateOfBirth ?? "—"}
                  </dd>
                  <dt className="text-muted-foreground">NIN</dt>
                  <dd className="text-foreground tabular-nums">
                    {mask4(submission.ninLast4)}
                  </dd>
                  <dt className="text-muted-foreground">BVN</dt>
                  <dd className="text-foreground tabular-nums">
                    {mask4(submission.bvnLast4)}
                  </dd>
                  <dt className="text-muted-foreground">ID document</dt>
                  <dd className="text-foreground">
                    {submission.idDocumentType ?? "—"}
                  </dd>
                  <dt className="text-muted-foreground">Liveness</dt>
                  <dd className="text-foreground">
                    {submission.livenessResult}
                  </dd>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <KycStatusBadge status={submission.status} />
                  </dd>
                  <dt className="text-muted-foreground">Requested tier</dt>
                  <dd className="text-foreground">{submission.tier}</dd>
                </dl>
                {submission.rejectionReason && (
                  <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    Previously rejected: {submission.rejectionReason}
                  </p>
                )}
                <Badge variant="outline" className="w-fit">
                  PII minimized · last-4 only
                </Badge>
              </section>

              <Separator />

              <section className="flex flex-col gap-2">
                <h3 className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
                  Review
                </h3>
                <KycReviewActions submission={submission} />
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
