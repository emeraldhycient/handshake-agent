/**
 * Webhooks-console constants (Track A). The empty filter sentinel + the status → Badge
 * variant map. Colour follows severity but is never the sole signal — the status word is
 * the label.
 */
import type { WebhookEventStatus } from "@handshake-agent/contracts"
import type { WebhookFilterState } from "@/types"

/** The queue filter with no filters set (All providers / All statuses). */
export const EMPTY_FILTER: WebhookFilterState = {
  provider: "",
  status: "",
  from: "",
  to: "",
}

/** Status → Badge variant: received=info, processing=warn, succeeded=success, failed/dead=danger. */
export const STATUS_VARIANT: Record<
  WebhookEventStatus,
  "info" | "warn" | "success" | "danger"
> = {
  received: "info",
  processing: "warn",
  succeeded: "success",
  failed: "danger",
  dead: "danger",
}
