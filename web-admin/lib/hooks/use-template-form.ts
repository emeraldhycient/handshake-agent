"use client"

import { useState } from "react"
import type {
  NotificationChannel,
  NotificationTemplate,
  TemplateVariable,
} from "@handshake-agent/contracts"

import { useAdminMe, useUpsertTemplate } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import {
  buildTemplateRef,
  buildUpsertBody,
} from "@/lib/notifications/template-editor"
import { CHANNELS } from "@/constants/template-editor"

/**
 * The template create/edit form state machine. Mounted only while the dialog is open,
 * so the `useState` initializers seed from `template` without a state-syncing effect;
 * closing remounts it fresh. On save it validates the body, then runs the upsert through
 * the step-up gate — a 403 opens the StepUpDialog and the mutation replays after re-auth.
 * On edit the composite key (templateKey + language + channel) is immutable. Nothing here
 * moves money (§3.1). Extracted so the form is presentation.
 */
export function useTemplateForm(
  template: NotificationTemplate | null,
  onClose: () => void
) {
  const isEdit = template !== null
  const me = useAdminMe()
  const upsert = useUpsertTemplate()
  const stepUp = useStepUpRetry()

  const [templateKey, setTemplateKey] = useState(template?.templateKey ?? "")
  const [language, setLanguage] = useState(template?.language ?? "en")
  const [channel, setChannel] = useState<NotificationChannel>(
    template?.channel ?? CHANNELS[0]
  )
  const [subject, setSubject] = useState(template?.subject ?? "")
  const [contentText, setContentText] = useState(template?.contentText ?? "")
  const [contentHtml, setContentHtml] = useState(template?.contentHtml ?? "")
  const [whatsappTemplateId, setWhatsappTemplateId] = useState(
    template?.whatsappTemplateId ?? ""
  )
  const [variables, setVariables] = useState<TemplateVariable[]>(
    template?.variables ?? []
  )
  const [localError, setLocalError] = useState<string | null>(null)

  function onSubmit() {
    setLocalError(null)
    let body
    try {
      body = buildUpsertBody({
        templateKey,
        language,
        channel,
        subject,
        contentText,
        contentHtml,
        whatsappTemplateId,
        variables,
      })
    } catch (error) {
      setLocalError(toErrorMessage(error))
      return
    }

    const ref = buildTemplateRef(template)

    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          upsert.mutateAsync({ ref, input: body }).then(() => undefined)
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
    isEdit,
    me,
    stepUp,
    busy: upsert.isPending,
    localError,
    fields: {
      templateKey,
      language,
      channel,
      subject,
      contentText,
      contentHtml,
      whatsappTemplateId,
      variables,
    },
    set: {
      templateKey: setTemplateKey,
      language: setLanguage,
      channel: setChannel,
      subject: setSubject,
      contentText: setContentText,
      contentHtml: setContentHtml,
      whatsappTemplateId: setWhatsappTemplateId,
      variables: setVariables,
    },
    onSubmit,
    onStepUpSuccess,
  }
}
