"use client"

import { useState } from "react"
import type { BulkMessageEventType } from "@handshake-agent/contracts"

import {
  useAdminMe,
  useApplyUserTags,
  useSendBulkMessage,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { pushToast } from "@/lib/store/toast-store"
import { toErrorMessage } from "@/lib/error-message"
import { isBulkConfirmError } from "@/lib/users/bulk"
import { EVENT_TYPES } from "@/constants/users-bulk"
import type { UsersBulkActionsProps } from "@/types/components"

/**
 * The Users bulk-bar WRITE state machine: apply an operator TAG or queue a templated
 * MESSAGE over the current selection. Neither moves money (§3.1). Both are step-up
 * guarded — a 403 opens the StepUpDialog and the mutation replays after re-auth. A large
 * message selection 422s with `ADMIN_BULK_CONFIRMATION_REQUIRED`; the operator ticks the
 * confirm box and resubmits (re-checked server-side, §3.3). Extracted so the dialogs are
 * presentation.
 */
export function useUsersBulkActions({
  selectedIds,
  onDone,
}: UsersBulkActionsProps) {
  const me = useAdminMe()
  const applyTags = useApplyUserTags()
  const sendMessage = useSendBulkMessage()
  const stepUp = useStepUpRetry()

  const [tagOpen, setTagOpen] = useState(false)
  const [messageOpen, setMessageOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Tag form
  const [tag, setTag] = useState("")
  const [tagReason, setTagReason] = useState("")

  // Message form
  const [eventType, setEventType] = useState<BulkMessageEventType>(
    EVENT_TYPES[0]
  )
  const [templateKey, setTemplateKey] = useState("")
  const [msgReason, setMsgReason] = useState("")
  const [confirmLargeSet, setConfirmLargeSet] = useState(false)

  const ids = [...selectedIds]
  const busy = applyTags.isPending || sendMessage.isPending

  function resetTag() {
    setTag("")
    setTagReason("")
    setError(null)
  }

  function resetMessage() {
    setEventType(EVENT_TYPES[0])
    setTemplateKey("")
    setMsgReason("")
    setConfirmLargeSet(false)
    setError(null)
  }

  async function submitTag() {
    setError(null)
    try {
      const done = await stepUp.run(() =>
        applyTags
          .mutateAsync({ userIds: ids, tag, reason: tagReason })
          .then((res) => {
            pushToast(`Tag "${res.tag}" applied to ${res.applied} users`, "ok")
            setTagOpen(false)
            resetTag()
            onDone()
          })
      )
      // A step-up challenge was raised — the StepUpDialog is now open; the retry
      // replays the same action on success.
      if (!done) return
    } catch (err) {
      setError(toErrorMessage(err))
    }
  }

  async function submitMessage() {
    setError(null)
    try {
      const done = await stepUp.run(() =>
        sendMessage
          .mutateAsync({
            userIds: ids,
            eventType,
            templateKey,
            variables: {},
            reason: msgReason,
            confirmLargeSet,
          })
          .then((res) => {
            pushToast(`Broadcast queued to ${res.queued} users`, "info")
            setMessageOpen(false)
            resetMessage()
            onDone()
          })
      )
      if (!done) return
    } catch (err) {
      // A large selection needs an explicit confirmation — surface the checkbox
      // rather than a raw error, so the operator can acknowledge and resubmit.
      if (isBulkConfirmError(err)) {
        setConfirmLargeSet(false)
        setError(
          "This selection is over the large-set threshold. Tick “Confirm large broadcast” and resend."
        )
        return
      }
      setError(toErrorMessage(err))
    }
  }

  function openTag() {
    resetTag()
    setTagOpen(true)
  }

  function openMessage() {
    resetMessage()
    setMessageOpen(true)
  }

  function onStepUpSuccess() {
    void stepUp.retry().catch((err) => setError(toErrorMessage(err)))
  }

  return {
    ids,
    error,
    busy,
    stepUp,
    mfaEnabled: me.data?.mfaEnabled ?? false,
    openTag,
    openMessage,
    onStepUpSuccess,
    tag: {
      open: tagOpen,
      setOpen: setTagOpen,
      value: tag,
      setValue: setTag,
      reason: tagReason,
      setReason: setTagReason,
      submit: submitTag,
      applying: applyTags.isPending,
    },
    message: {
      open: messageOpen,
      setOpen: setMessageOpen,
      eventType,
      setEventType,
      templateKey,
      setTemplateKey,
      reason: msgReason,
      setReason: setMsgReason,
      confirmLargeSet,
      setConfirmLargeSet,
      submit: submitMessage,
      queueing: sendMessage.isPending,
    },
  }
}
