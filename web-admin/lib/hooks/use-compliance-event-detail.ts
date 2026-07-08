"use client"

import { useState } from "react"
import type { ComplianceDispositionRequest } from "@handshake-agent/contracts"

import {
  useAdminMe,
  useComplianceEvent,
  useDisposeEvent,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import { buildDispositionInput } from "@/lib/compliance/event-detail"

/**
 * The flagged-event drawer state machine: fetches the event detail (`useComplianceEvent`)
 * and drives the disposition — a status + optional audited comment PATCHed through the
 * step-up gate (a 403 opens the StepUpDialog and replays after re-auth). Nothing moves
 * money (§3.1). Extracted so the drawer is presentation.
 */
export function useComplianceEventDetail(eventId: string | null) {
  const detail = useComplianceEvent(eventId)
  const me = useAdminMe()
  const dispose = useDisposeEvent()
  const stepUp = useStepUpRetry()

  const [status, setStatus] =
    useState<ComplianceDispositionRequest["status"]>("under_review")
  const [comment, setComment] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)

  function onDispose(id: string) {
    setLocalError(null)
    void (async () => {
      try {
        await stepUp.run(() =>
          dispose
            .mutateAsync({ id, input: buildDispositionInput(status, comment) })
            .then(() => undefined)
        )
      } catch (error) {
        setLocalError(toErrorMessage(error))
      }
    })()
  }

  function onStepUpSuccess() {
    void stepUp.retry().catch((error) => setLocalError(toErrorMessage(error)))
  }

  return {
    detail,
    event: detail.data,
    me,
    stepUp,
    busy: dispose.isPending,
    status,
    setStatus,
    comment,
    setComment,
    localError,
    onDispose,
    onStepUpSuccess,
  }
}
