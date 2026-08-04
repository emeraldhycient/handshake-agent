"use client"

import { useState } from "react"
import type { ChangeRequest } from "@handshake-agent/contracts"

import {
  useAdminMe,
  useApprovalsInbox,
  useApproveChange,
  useRejectChange,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import { requestTitle } from "@/lib/approvals/rows"
import type { AprTab } from "@/types"

/**
 * The maker-checker approval inbox state machine: resolves the awaiting-me / my-requests
 * buckets from the inbox read and drives the dual-control disposition chain
 * (approve → step-up → POST approve; reject → audited reason → step-up → POST reject).
 * A 403 ADMIN_STEP_UP_REQUIRED opens the StepUpDialog and replays the stashed mutation
 * after re-auth. Nothing here writes the ledger — the engine re-validates and settles
 * on approval (§3.1). Extracted so the page is composition.
 */
export function useApprovalsPage() {
  const [tab, setTab] = useState<AprTab>("awaiting")
  const me = useAdminMe()
  const inbox = useApprovalsInbox()
  const approve = useApproveChange()
  const reject = useRejectChange()
  const stepUp = useStepUpRetry()

  // The request whose Reject reason is being captured (opens ReasonModal).
  const [rejecting, setRejecting] = useState<ChangeRequest | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const awaiting = inbox.data?.awaitingMe ?? []
  const mineList = inbox.data?.myRequests ?? []
  // Prefer the server's authoritative counts; fall back to the loaded list lengths.
  const awaitingCount = inbox.data?.counts.awaitingMe ?? awaiting.length
  const myCount = inbox.data?.counts.myRequests ?? mineList.length
  const visible = tab === "mine" ? mineList : awaiting

  // A request is "mine" when I raised it — dual control means a different admin must
  // approve. Server-authoritative (own requests never land in `awaitingMe`); the UI
  // mirrors it so a stray own-request row still shows the guard, not live actions.
  const myAdminId = me.data?.id
  const busy = approve.isPending || reject.isPending

  // Run a sensitive disposition through the step-up-then-retry gate. `stepUp.run`
  // returns false (and opens the re-auth dialog) on a 403 ADMIN_STEP_UP_REQUIRED;
  // any other error surfaces inline.
  async function runStepUp(action: () => Promise<void>) {
    setActionError(null)
    try {
      await stepUp.run(action)
    } catch (error) {
      setActionError(toErrorMessage(error))
    }
  }

  function onApprove(request: ChangeRequest) {
    void runStepUp(() => approve.mutateAsync(request.id).then(() => undefined))
  }

  function confirmReject(reason: string) {
    const request = rejecting
    setRejecting(null)
    if (!request) return
    void runStepUp(() =>
      reject
        .mutateAsync({ id: request.id, input: { reason } })
        .then(() => undefined)
    )
  }

  function onStepUpSuccess() {
    void stepUp.retry().catch((error) => setActionError(toErrorMessage(error)))
  }

  const rejectTitle = rejecting
    ? `Reject · ${requestTitle(rejecting)}`
    : "Reject"

  return {
    tab,
    setTab,
    me,
    inbox,
    stepUp,
    rejecting,
    setRejecting,
    actionError,
    awaitingCount,
    myCount,
    visible,
    myAdminId,
    busy,
    onApprove,
    confirmReject,
    onStepUpSuccess,
    rejectTitle,
  }
}
