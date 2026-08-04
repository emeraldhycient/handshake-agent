/** Webhooks console (Track A). */

// ─── Webhooks console (Track A) ───────────────────────────────────────────────────

/** The webhook-queue filter held in local state; empty strings mean "no filter" (All). */
export interface WebhookFilterState {
  provider: string
  status: string
  from: string
  to: string
}

/** The webhook-queue filter bar (provider / status / from-to). */
export interface WebhookFilterBarProps {
  filter: WebhookFilterState
  onChange: (next: WebhookFilterState) => void
}

/** The webhook queue — loading / error / empty / data over the table. */
export interface WebhookQueueProps {
  items: readonly import("@handshake-agent/contracts").WebhookListItem[]
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  onRetry: () => void
  onView: (id: string) => void
}

/** The right-side webhook detail drawer (verbatim payload + headers + Retry). */
export interface WebhookDetailDrawerProps {
  webhookId: string | null
  onOpenChange: (open: boolean) => void
  onRetry: (id: string) => void
  retrying: boolean
}
