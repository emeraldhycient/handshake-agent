"use client"

import { useState, type ChangeEvent } from "react"

import {
  BroadcastAudienceSchema,
  type BroadcastAudience,
  type BroadcastOutcome,
  type BroadcastSendRequest,
} from "@handshake-agent/contracts"

import {
  useAdminMe,
  useNotificationTemplates,
  useSendBroadcast,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import { pushToast } from "@/lib/store/toast-store"
import {
  AUDIENCE_LABEL,
  AUDIENCE_OPTIONS,
  BROAD_AUDIENCES,
  SCHEDULE_OPTIONS,
} from "@/constants/notifications"
import { buildSchedule, toTemplateOptions } from "@/lib/notifications/format"

/** A human message for a failed broadcast send (surfaced as a danger toast). */
function sendErrorMessage(error: unknown): string {
  return (
    toErrorMessage(error) ?? "Couldn't send the broadcast. Please try again."
  )
}

/**
 * The broadcast-composer state machine. A broadcast moves no money (§3.1) but is
 * high-impact: it NEVER sends on click — every send opens the confirm modal first, and
 * only the modal's submit fires the real step-up-wrapped send. The SERVER re-resolves the
 * cohort size and decides dispatched-now vs queued-for-approval (§3.5); the client's
 * broad-audience hint is advisory only. Extracted so the composer component is pure JSX.
 */
export function useBroadcastComposer() {
  // The TEMPLATE options come ONLY from the real notification-templates list —
  // the api fail-closes (422) on unknown keys, so no design fallback keys exist.
  const templatesQuery = useNotificationTemplates()
  const templateOptions =
    templatesQuery.data && templatesQuery.data.items.length > 0
      ? toTemplateOptions(templatesQuery.data.items.map((t) => t.templateKey))
      : []

  const [audience, setAudience] = useState<BroadcastAudience>(
    BroadcastAudienceSchema.parse(AUDIENCE_OPTIONS[0].value)
  )
  const [templateKey, setTemplateKey] = useState("")
  const [when, setWhen] = useState(SCHEDULE_OPTIONS[0].value)
  const [customAt, setCustomAt] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sentOutcome, setSentOutcome] = useState<BroadcastOutcome | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  const me = useAdminMe()
  const sendBroadcast = useSendBroadcast()
  const stepUp = useStepUpRetry()

  // Keep the select controlled against whatever options are live.
  const selectedTemplate = templateOptions.some((o) => o.value === templateKey)
    ? templateKey
    : (templateOptions[0]?.value ?? "")

  // Sending needs a REAL template key. While the list loads / errors / is empty,
  // the Send CTA is disabled and the hint explains why.
  const canSend = selectedTemplate !== ""
  const sendDisabledHint = canSend
    ? null
    : templatesQuery.isLoading
      ? "Loading templates…"
      : templatesQuery.isError
        ? "Couldn't load templates — retry from the Templates page."
        : "Create a notification template before sending a broadcast."

  const isBroadAudience = BROAD_AUDIENCES.has(audience)
  const isCustomSchedule = when === "custom"
  const audienceLabel = AUDIENCE_LABEL[audience]
  const scheduleLabel = isCustomSchedule
    ? customAt || "Custom…"
    : (SCHEDULE_OPTIONS.find((o) => o.value === when)?.label ?? when)

  function onAudienceChange(event: ChangeEvent<HTMLSelectElement>) {
    setAudience(BroadcastAudienceSchema.parse(event.target.value))
    setSentOutcome(null)
  }

  function onFieldChange(setter: (value: string) => void) {
    return (event: ChangeEvent<HTMLSelectElement>) => {
      setter(event.target.value)
      setSentOutcome(null)
    }
  }

  function onCustomAtChange(event: ChangeEvent<HTMLInputElement>) {
    setCustomAt(event.target.value)
    setSentOutcome(null)
  }

  // A broadcast is proposal-only: it never sends on click. Fail-closed without a
  // real template key (the CTA is disabled, but guard anyway).
  function queueBroadcast() {
    if (!canSend) return
    setConfirmOpen(true)
  }

  function buildRequest(): BroadcastSendRequest {
    return {
      audience,
      templateKey: selectedTemplate,
      schedule: buildSchedule(when, customAt),
      reason: `Broadcast to ${audienceLabel}`,
    }
  }

  // The single send action, shared by the first attempt + the post-step-up replay.
  async function runSend(request: BroadcastSendRequest): Promise<void> {
    const result = await sendBroadcast.mutateAsync(request)
    setSentOutcome(result.outcome)
    pushToast(
      result.outcome === "queued_for_approval"
        ? "Broadcast queued for approval"
        : "Broadcast sent",
      "ok"
    )
  }

  // The confirm-modal submit: fire the REAL send (step-up-wrapped).
  async function submitBroadcast() {
    const request = buildRequest()
    try {
      const completed = await stepUp.run(() => runSend(request))
      if (completed || stepUp.open) setConfirmOpen(false)
    } catch (error) {
      setConfirmOpen(false)
      pushToast(sendErrorMessage(error), "warn")
    }
  }

  // Replay the send after a successful step-up re-auth (the StepUpDialog closes
  // itself before invoking this).
  async function retryAfterStepUp() {
    try {
      await stepUp.retry()
    } catch (error) {
      pushToast(sendErrorMessage(error), "warn")
    }
  }

  const ctaLabel =
    sentOutcome === "dispatched"
      ? "Broadcast sent"
      : sentOutcome === "queued_for_approval"
        ? "Queued for approval"
        : "Send broadcast"

  return {
    templateOptions,
    audience,
    selectedTemplate,
    canSend,
    sendDisabledHint,
    mfaEnabled: me.data?.mfaEnabled ?? false,
    when,
    customAt,
    confirmOpen,
    editorOpen,
    isBroadAudience,
    isCustomSchedule,
    audienceLabel,
    scheduleLabel,
    ctaLabel,
    stepUp,
    setConfirmOpen,
    setEditorOpen,
    onAudienceChange,
    onTemplateChange: onFieldChange(setTemplateKey),
    onScheduleChange: onFieldChange(setWhen),
    onCustomAtChange,
    queueBroadcast,
    submitBroadcast,
    retryAfterStepUp,
  }
}
