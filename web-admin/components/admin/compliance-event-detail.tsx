"use client"

/**
 * ComplianceEventDetail — the flagged-event drawer (a right-side Sheet). Composition
 * only: `useComplianceEventDetail` owns the detail read + the step-up-gated disposition
 * state machine; the metadata + screening payload live in `ComplianceEventSummary` and
 * the disposition controls in `ComplianceDispositionForm`.
 *
 * Disposition is sensitive — the PATCH routes through the step-up gate (403 →
 * StepUpDialog → replay). Nothing here moves money (§3.1). Four async branches on the
 * detail query: loading / error / empty / data.
 */
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { ComplianceEventSummary } from "@/components/admin/compliance/event-detail/event-summary"
import { ComplianceDispositionForm } from "@/components/admin/compliance/event-detail/disposition-form"
import { useComplianceEventDetail } from "@/lib/hooks/use-compliance-event-detail"
import type { ComplianceEventDetailProps } from "@/types/components"

export function ComplianceEventDetail({
  eventId,
  onOpenChange,
}: ComplianceEventDetailProps) {
  const d = useComplianceEventDetail(eventId)
  const { detail, event } = d

  return (
    <Sheet open={eventId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Compliance event</SheetTitle>
          <SheetDescription>
            {event ? event.eventType : "Loading event"}
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
                Failed to load this event
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Close and try again.
              </p>
            </div>
          )}

          {/* ── Data ─────────────────────────────────────────────────────── */}
          {detail.isSuccess && event && (
            <>
              <ComplianceEventSummary event={event} />
              <Separator />
              <ComplianceDispositionForm
                status={d.status}
                onStatusChange={d.setStatus}
                comment={d.comment}
                onCommentChange={d.setComment}
                busy={d.busy}
                onApply={() => d.onDispose(event.id)}
                localError={d.localError}
              />
            </>
          )}
        </div>

        <StepUpDialog
          open={d.stepUp.open}
          mfaEnabled={d.me.data?.mfaEnabled ?? false}
          onOpenChange={d.stepUp.setOpen}
          onSuccess={d.onStepUpSuccess}
        />
      </SheetContent>
    </Sheet>
  )
}
