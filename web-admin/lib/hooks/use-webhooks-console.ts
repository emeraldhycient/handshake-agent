"use client"

import { useMemo, useState } from "react"

import { useAdminMe, useRetryWebhook, useWebhooks } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import { pushToast } from "@/lib/store/toast-store"
import { EMPTY_FILTER } from "@/constants/webhooks"
import type { WebhookQuery } from "@/lib/api/webhooks"
import type { WebhookFilterState } from "@/types"

/** Webhook failures always surface a string toast (never null). */
function toastError(error: unknown): string {
  return toErrorMessage(error) ?? "Something went wrong."
}

/**
 * The webhooks-console view-model: the queue filter/query, the selected detail id, and the
 * replay flow (ReasonModal → the real step-up-guarded retry POST). The server re-enqueues
 * the webhook (engine-brokered, §3.1) + records the reason; it moves no money. A 403 opens
 * the StepUpDialog and the POST replays after re-auth. Extracted so the page is composition.
 */
export function useWebhooksConsole() {
  const [filter, setFilter] = useState<WebhookFilterState>(EMPTY_FILTER)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The webhook awaiting a reason before its (step-up-guarded) replay fires.
  const [reasonFor, setReasonFor] = useState<string | null>(null)

  // Project the local filter onto the query — omit empty fields so the key stays stable
  // and the backend receives only the filters the operator set.
  const query = useMemo<WebhookQuery>(() => {
    const q: WebhookQuery = {}
    if (filter.provider) q.provider = filter.provider
    if (filter.status) q.status = filter.status
    if (filter.from) q.from = filter.from
    if (filter.to) q.to = filter.to
    return q
  }, [filter])

  const webhooksQuery = useWebhooks(query)
  const items = webhooksQuery.data?.items ?? []

  const me = useAdminMe()
  const retry = useRetryWebhook()
  const stepUp = useStepUpRetry()

  /** Replay a webhook through the real step-up-guarded POST. */
  function replay(id: string, reason: string) {
    setReasonFor(null)
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          retry.mutateAsync({ id, input: { reason } }).then(() => undefined)
        )
        if (ok) pushToast("Webhook re-enqueued", "ok")
      } catch (error) {
        pushToast(toastError(error), "warn")
      }
    })()
  }

  function onStepUpSuccess() {
    void stepUp
      .retry()
      .then((ok) => {
        if (ok) pushToast("Webhook re-enqueued", "ok")
      })
      .catch((error) => pushToast(toastError(error), "warn"))
  }

  return {
    filter,
    setFilter,
    selectedId,
    setSelectedId,
    reasonFor,
    setReasonFor,
    webhooksQuery,
    items,
    me,
    retry,
    stepUp,
    replay,
    onStepUpSuccess,
  }
}
