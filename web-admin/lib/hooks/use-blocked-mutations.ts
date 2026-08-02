"use client"

import { useState } from "react"

import {
  useAddBlocked,
  useAdminMe,
  useBlockedList,
  useSupersedeBlocked,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import { pushToast } from "@/lib/store/toast-store"
import { deriveKind } from "@/lib/blocked/format"
import type { PendingAdd, PendingReplay, SupersedeFlow } from "@/types"

/** Deny-list failures always surface a string toast (never null). */
function toastError(error: unknown): string {
  return toErrorMessage(error) ?? "Something went wrong."
}

/**
 * The Blocked-list state machine: the live deny-list query + the two append-only write
 * paths (add / supersede), each routed through the shared reason → step-up flow. Lifting
 * a block SUPERSEDES the row (§3.4 — nothing is deleted); neither path moves money
 * (§3.1). A 403 opens the StepUpDialog and the POST replays after re-auth. Extracted from
 * the page so the orchestrator is pure composition.
 */
export function useBlockedMutations() {
  const list = useBlockedList()
  const entries = list.data?.items ?? []

  const me = useAdminMe()
  const add = useAddBlocked()
  const supersede = useSupersedeBlocked()
  const stepUp = useStepUpRetry()

  const [addOpen, setAddOpen] = useState(false)
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null)
  const [flow, setFlow] = useState<SupersedeFlow | null>(null)
  // The action awaiting a server step-up replay (so the success toast reads right).
  const [replay, setReplay] = useState<PendingReplay | null>(null)

  const denylist = entries.map((e) => e.value)

  /**
   * The AddBlockedDialog's onSave: it hands back the whole next denylist. Recover the
   * newly added value, close the dialog, and open the ReasonModal to capture the audited
   * reason before the POST fires (the reason is required server-side, §3.3).
   */
  async function onDialogSave(next: string[]) {
    const value = next.find((v) => !denylist.includes(v))
    if (!value) return
    setAddOpen(false)
    setPendingAdd({ value })
  }

  /** Fire the add through the server step-up guard; a 403 opens StepUpDialog. */
  function submitAdd(value: string, reason: string) {
    setPendingAdd(null)
    setReplay({ kind: "add", value })
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          add
            .mutateAsync({ kind: deriveKind(value), value, reason })
            .then(() => undefined)
        )
        if (ok) {
          pushToast(`Added to blocked list · ${value}`, "ok")
          setReplay(null)
        }
      } catch (error) {
        pushToast(toastError(error), "warn")
        setReplay(null)
      }
    })()
  }

  /** Fire the supersede through the server step-up guard; a 403 opens StepUpDialog. */
  function submitSupersede(id: string, value: string, reason: string) {
    setFlow(null)
    setReplay({ kind: "supersede", value })
    void (async () => {
      try {
        const ok = await stepUp.run(() => supersede.mutateAsync({ id, reason }))
        if (ok) {
          pushToast(`Unblocked · ${value}`, "ok")
          setReplay(null)
        }
      } catch (error) {
        pushToast(toastError(error), "warn")
        setReplay(null)
      }
    })()
  }

  function onStepUpSuccess() {
    void stepUp
      .retry()
      .then((ok) => {
        if (ok && replay) {
          pushToast(
            replay.kind === "add"
              ? `Added to blocked list · ${replay.value}`
              : `Unblocked · ${replay.value}`,
            "ok"
          )
        }
        setReplay(null)
      })
      .catch((error) => {
        pushToast(toastError(error), "warn")
        setReplay(null)
      })
  }

  return {
    list,
    entries,
    denylist,
    me,
    stepUp,
    addOpen,
    setAddOpen,
    pendingAdd,
    setPendingAdd,
    flow,
    setFlow,
    onDialogSave,
    submitAdd,
    submitSupersede,
    onStepUpSuccess,
  }
}
