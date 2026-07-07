"use client"

import { useState } from "react"
import { ComplianceReportDraftRequestSchema } from "@handshake-agent/contracts"

import { REPORT_TYPES } from "@/constants/compliance-report-draft"
import { toErrorMessage } from "@/lib/error-message"
import {
  parseRelatedEvents,
  parseReportContent,
} from "@/lib/compliance/report-draft"
import { useAdminMe, useDraftReport } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import type { ComplianceReportType } from "@/types/components"

/**
 * View-model for the "Draft compliance report" dialog. Owns the form state
 * (report type, related event ids, JSON content, inline error) and the submit /
 * step-up flow. Drafting is sensitive: `submit` runs through `useStepUpRetry`, so
 * a 403 `ADMIN_STEP_UP_REQUIRED` opens the StepUpDialog and the mutation replays
 * after re-auth. The model still only proposes — the engine re-validates and
 * settles server-side (§3.1). `onClose` fires only on a successful draft.
 */
export function useComplianceReportDraft(onClose: () => void) {
  const me = useAdminMe()
  const draft = useDraftReport()
  const stepUp = useStepUpRetry()

  const [reportType, setReportType] = useState<ComplianceReportType>(
    REPORT_TYPES[0]
  )
  const [eventsText, setEventsText] = useState("")
  const [content, setContent] = useState("{}")
  const [localError, setLocalError] = useState<string | null>(null)

  function submit() {
    setLocalError(null)
    const parsed = parseReportContent(content)
    if (!parsed.ok) {
      setLocalError(parsed.error)
      return
    }
    const relatedEvents = parseRelatedEvents(eventsText)

    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          draft
            .mutateAsync(
              ComplianceReportDraftRequestSchema.parse({
                reportType,
                relatedEvents,
                content: parsed.value,
              })
            )
            .then(() => undefined)
        )
        if (ok) onClose()
      } catch (error) {
        setLocalError(toErrorMessage(error))
      }
    })()
  }

  function onStepUpSuccess() {
    void stepUp
      .retry()
      .then((ok) => {
        if (ok) onClose()
      })
      .catch((error) => setLocalError(toErrorMessage(error)))
  }

  return {
    me,
    reportType,
    setReportType,
    eventsText,
    setEventsText,
    content,
    setContent,
    localError,
    busy: draft.isPending,
    stepUp,
    submit,
    onStepUpSuccess,
  }
}
