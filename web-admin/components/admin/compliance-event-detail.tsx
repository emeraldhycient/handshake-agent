"use client"

/**
 * ComplianceEventDetail — the flagged-event drawer (a right-side Sheet). Opened by
 * the events queue with an `eventId`; fetches the detail via `useComplianceEvent`
 * and renders the event metadata, the raw screening payload, and the disposition
 * form (status select: approved / blocked / dismissed / under_review + a comment).
 *
 * Disposition is sensitive — we attempt the mutation, and if it 403s with
 * ADMIN_STEP_UP_REQUIRED we open the StepUpDialog and retry after re-auth
 * (`useStepUpRetry`). Nothing here moves money (§3.1).
 *
 * Four async branches on the detail query: loading / error / empty / data.
 */
import { useState } from "react"
import { ComplianceDispositionRequestSchema } from "@handshake-agent/contracts"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import {
  useAdminMe,
  useComplianceEvent,
  useDisposeEvent,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import type { ComplianceEventDetailProps } from "@/types/components"

const DISPOSITIONS = ComplianceDispositionRequestSchema.shape.status.options

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

export function ComplianceEventDetail({
  eventId,
  onOpenChange,
}: ComplianceEventDetailProps) {
  const detail = useComplianceEvent(eventId)
  const me = useAdminMe()
  const dispose = useDisposeEvent()
  const stepUp = useStepUpRetry()
  const [status, setStatus] =
    useState<(typeof DISPOSITIONS)[number]>("under_review")
  const [comment, setComment] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)

  const event = detail.data

  function onDispose(id: string) {
    setLocalError(null)
    void (async () => {
      try {
        await stepUp.run(() =>
          dispose
            .mutateAsync({
              id,
              input: {
                status,
                ...(comment.trim() ? { comment: comment.trim() } : {}),
              },
            })
            .then(() => undefined)
        )
      } catch (error) {
        setLocalError(errorMessage(error))
      }
    })()
  }

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
              <section className="flex flex-col gap-2">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Severity</dt>
                  <dd>
                    <Badge
                      variant={
                        event.severity === "critical" ||
                        event.severity === "high"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {event.severity}
                    </Badge>
                  </dd>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="text-foreground">{event.status}</dd>
                  <dt className="text-muted-foreground">User</dt>
                  <dd className="font-mono text-xs text-foreground">
                    {event.userId}
                  </dd>
                  <dt className="text-muted-foreground">Transaction</dt>
                  <dd className="font-mono text-xs text-foreground">
                    {event.transactionId ?? "—"}
                  </dd>
                  <dt className="text-muted-foreground">Provider</dt>
                  <dd className="text-foreground">{event.screeningProvider}</dd>
                  <dt className="text-muted-foreground">Rule / hit</dt>
                  <dd className="text-foreground">{event.ruleOrHit ?? "—"}</dd>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd className="text-foreground tabular-nums">
                    {formatDate(event.createdAt)}
                  </dd>
                </dl>
                {event.dispositionComment && (
                  <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    Disposition: {event.dispositionComment}
                    {event.dispositionAt
                      ? ` (${formatDate(event.dispositionAt)})`
                      : ""}
                  </p>
                )}
              </section>

              <Separator />

              <section className="flex flex-col gap-2">
                <h3 className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
                  Screening payload
                </h3>
                <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground">
                  {JSON.stringify(event.details, null, 2)}
                </pre>
              </section>

              <Separator />

              <section className="flex flex-col gap-3">
                <h3 className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
                  Disposition
                </h3>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="event-disposition">Set status</Label>
                  <NativeSelect
                    id="event-disposition"
                    aria-label="Disposition status"
                    className="w-52"
                    value={status}
                    disabled={dispose.isPending}
                    onChange={(e) =>
                      setStatus(e.target.value as (typeof DISPOSITIONS)[number])
                    }
                  >
                    {DISPOSITIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="event-comment">Comment</Label>
                  <textarea
                    id="event-comment"
                    value={comment}
                    disabled={dispose.isPending}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Audited disposition note (optional)"
                    rows={3}
                    className="min-h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                  />
                </div>
                <Button
                  size="sm"
                  className="self-start"
                  disabled={dispose.isPending}
                  aria-busy={dispose.isPending}
                  onClick={() => onDispose(event.id)}
                >
                  Apply disposition
                </Button>
                {localError && (
                  <p role="alert" className="text-xs text-destructive">
                    {localError}
                  </p>
                )}
              </section>
            </>
          )}
        </div>

        <StepUpDialog
          open={stepUp.open}
          mfaEnabled={me.data?.mfaEnabled ?? false}
          onOpenChange={stepUp.setOpen}
          onSuccess={() => {
            void stepUp
              .retry()
              .catch((error) => setLocalError(errorMessage(error)))
          }}
        />
      </SheetContent>
    </Sheet>
  )
}
