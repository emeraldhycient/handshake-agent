"use client"

/**
 * ComplianceReportDraftDialog — draft a SAR/STR report (Phase 3, sub-area C).
 * Captures the report type (sar / str), a newline-separated list of related event
 * ids, and the report content as raw JSON (parsed before submit; invalid JSON
 * surfaces inline).
 *
 * Drafting is sensitive — we attempt the mutation, and if it 403s with
 * ADMIN_STEP_UP_REQUIRED we open the StepUpDialog and retry after re-auth
 * (`useStepUpRetry`). The form body mounts only while open so its `useState`
 * initializers reset on each open without a state-syncing effect.
 */
import { useState } from "react"
import { ComplianceReportDraftRequestSchema } from "@handshake-agent/contracts"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useAdminMe, useDraftReport } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import type { ComplianceReportDraftDialogProps } from "@/types/components"

const REPORT_TYPES = ComplianceReportDraftRequestSchema.shape.reportType.options

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

function DraftForm({ onClose }: { onClose: () => void }) {
  const me = useAdminMe()
  const draft = useDraftReport()
  const stepUp = useStepUpRetry()

  const [reportType, setReportType] = useState<(typeof REPORT_TYPES)[number]>(
    REPORT_TYPES[0]
  )
  const [eventsText, setEventsText] = useState("")
  const [content, setContent] = useState("{}")
  const [localError, setLocalError] = useState<string | null>(null)

  function onSubmit() {
    setLocalError(null)
    let parsedContent: Record<string, unknown>
    try {
      const value: unknown = JSON.parse(content)
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        setLocalError("Content must be a JSON object.")
        return
      }
      parsedContent = value as Record<string, unknown>
    } catch {
      setLocalError("Content is not valid JSON.")
      return
    }

    const relatedEvents = eventsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)

    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          draft
            .mutateAsync(
              ComplianceReportDraftRequestSchema.parse({
                reportType,
                relatedEvents,
                content: parsedContent,
              })
            )
            .then(() => undefined)
        )
        if (ok) onClose()
      } catch (error) {
        setLocalError(errorMessage(error))
      }
    })()
  }

  const busy = draft.isPending

  return (
    <>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Draft compliance report</DialogTitle>
          <DialogDescription>
            Create a SAR/STR draft from related compliance events.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-type">Report type</Label>
            <NativeSelect
              id="report-type"
              className="w-32"
              value={reportType}
              disabled={busy}
              onChange={(e) =>
                setReportType(e.target.value as (typeof REPORT_TYPES)[number])
              }
            >
              {REPORT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.toUpperCase()}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-events">Related event ids</Label>
            <textarea
              id="report-events"
              value={eventsText}
              disabled={busy}
              onChange={(e) => setEventsText(e.target.value)}
              placeholder="One event id per line"
              rows={3}
              spellCheck={false}
              className="min-h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-content">Content (JSON)</Label>
            <textarea
              id="report-content"
              value={content}
              disabled={busy}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              spellCheck={false}
              className="min-h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
            />
          </div>

          {localError && (
            <p role="alert" className="text-xs text-destructive">
              {localError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={busy} aria-busy={busy}>
            Draft
          </Button>
        </DialogFooter>
      </DialogContent>

      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .then((ok) => {
              if (ok) onClose()
            })
            .catch((error) => setLocalError(errorMessage(error)))
        }}
      />
    </>
  )
}

export function ComplianceReportDraftDialog({
  open,
  onOpenChange,
}: ComplianceReportDraftDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <DraftForm onClose={() => onOpenChange(false)} />}
    </Dialog>
  )
}
