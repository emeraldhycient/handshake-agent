"use client"

import { useState } from "react"

import {
  useAdminMe,
  useDisposeSanctions,
  useSanctions,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import { pushToast } from "@/lib/store/toast-store"
import { DONE_META } from "@/constants/sanctions"
import type { SanctionsRecordItem } from "@handshake-agent/contracts"
import type {
  SanctionsActiveFlow,
  SanctionsMatchDone,
} from "@/types/components"

/** Sanctions failures always surface a string toast (never null). */
function toastError(error: unknown): string {
  return toErrorMessage(error) ?? "Something went wrong."
}

/**
 * The Sanctions-page disposition state machine: the live screening records + the
 * Clear/Escalate/Block flow (Clear/Block capture a reason via the ReasonModal —
 * threaded into the audited `comment`; Escalate confirms via the maker-checker
 * modal's honest immediate copy). The server writes the disposition ANNOTATION
 * (never the immutable screener verdict, §3.1) + an `admin_review` audit; it moves
 * no money. The REAL step-up is server-driven: a 403 opens the StepUpDialog and the
 * POST replays after re-auth. Extracted so the page is composition.
 */
export function useSanctionsDispositions() {
  const sanctions = useSanctions()
  const records = sanctions.data?.items ?? []

  const me = useAdminMe()
  const dispose = useDisposeSanctions()
  const stepUp = useStepUpRetry()

  // Local optimistic outcomes layered over the server disposition (the source of truth
  // once the sanctions query re-resolves).
  const [outcomes, setOutcomes] = useState<Record<string, SanctionsMatchDone>>(
    {}
  )
  const [flow, setFlow] = useState<SanctionsActiveFlow>(null)
  // The disposition awaiting a server step-up replay (so the toast/flip after re-auth
  // targets the right match).
  const [pending, setPending] = useState<{
    matchId: string
    done: SanctionsMatchDone
  } | null>(null)

  /** The card's effective done-state: the server disposition, then any local override. */
  function doneOf(record: SanctionsRecordItem): SanctionsMatchDone | null {
    return outcomes[record.id] ?? record.disposition
  }

  function labelOf(matchId: string): string {
    return records.find((r) => r.id === matchId)?.counterpartyId ?? "match"
  }

  /**
   * Apply a disposition through the real step-up-guarded POST. The typed reason
   * (when the flow captured one) is threaded through as the audited `comment` —
   * never silently dropped.
   */
  function disposition(
    matchId: string,
    done: SanctionsMatchDone,
    comment?: string
  ) {
    setFlow(null)
    setPending({ matchId, done })
    const input = {
      disposition: done,
      ...(comment ? { comment } : {}),
    }
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          dispose.mutateAsync({ id: matchId, input }).then(() => undefined)
        )
        if (ok) {
          setOutcomes((prev) => ({ ...prev, [matchId]: done }))
          pushToast(`${labelOf(matchId)} · ${DONE_META[done].label}`, "ok")
          setPending(null)
        }
      } catch (error) {
        pushToast(toastError(error), "warn")
        setPending(null)
      }
    })()
  }

  function onStepUpSuccess() {
    void stepUp
      .retry()
      .then((ok) => {
        if (ok && pending) {
          setOutcomes((prev) => ({ ...prev, [pending.matchId]: pending.done }))
          pushToast(
            `${labelOf(pending.matchId)} · ${DONE_META[pending.done].label}`,
            "ok"
          )
        }
        setPending(null)
      })
      .catch((error) => {
        pushToast(toastError(error), "warn")
        setPending(null)
      })
  }

  return {
    sanctions,
    records,
    me,
    stepUp,
    flow,
    setFlow,
    doneOf,
    labelOf,
    disposition,
    onStepUpSuccess,
  }
}
