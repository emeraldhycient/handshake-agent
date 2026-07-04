/**
 * Typed admin webhooks-console API clients (Track A) — the durable inbound-webhook
 * queue: list (filtered + keyset-paginated), queue metrics, one webhook's detail
 * (verbatim payload + headers), and a step-up-gated retry that re-enqueues the event
 * for engine-brokered processing. Each parses its input through the request schema
 * before the request fires and parses the response through the response schema after
 * (§3.3 / §8: the FE gate is UX, never the only check; shapes that cross the boundary
 * come from contracts).
 *
 * The retry is sensitive and may 403 with ADMIN_STEP_UP_REQUIRED; the caller wraps it
 * in `useStepUpRetry`. Money never moves through these shapes — retry only re-enqueues
 * (engine-brokered, §3.1).
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  WebhookListResponseSchema,
  WebhookMetricsSchema,
  WebhookDetailSchema,
  WebhookRetryRequestSchema,
  type WebhookListResponse,
  type WebhookMetrics,
  type WebhookDetail,
  type WebhookRetryRequest,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** The webhook-queue filter (mirrors the API presentation DTO). */
export interface WebhookQuery {
  provider?: string
  status?: string
  from?: string
  to?: string
  cursor?: string
  limit?: number
}

/** GET /admin/webhooks — the filtered, keyset-paginated inbound-webhook queue. */
export async function listWebhooks(
  query: WebhookQuery
): Promise<WebhookListResponse> {
  const res = await api.get("/admin/webhooks", { params: query })
  return WebhookListResponseSchema.parse(res.data)
}

/** GET /admin/webhooks/metrics — queue depth + failed/dead counts (metrics strip). */
export async function getWebhookMetrics(): Promise<WebhookMetrics> {
  const res = await api.get("/admin/webhooks/metrics")
  return WebhookMetricsSchema.parse(res.data)
}

/** GET /admin/webhooks/:id — one webhook's detail (verbatim payload + headers). */
export async function getWebhookDetail(id: string): Promise<WebhookDetail> {
  const res = await api.get(`/admin/webhooks/${id}`)
  return WebhookDetailSchema.parse(res.data)
}

/**
 * POST /admin/webhooks/:id/retry — re-enqueue a webhook for processing. Sensitive —
 * may 403 with code ADMIN_STEP_UP_REQUIRED (the caller wraps it in `useStepUpRetry`).
 * The server re-enqueues (engine-brokered, §3.1) and records the audited `reason`; it
 * moves no money. Body parsed before the request, response after. Returns the updated
 * detail.
 */
export async function retryWebhook(
  id: string,
  input: WebhookRetryRequest
): Promise<WebhookDetail> {
  const body = WebhookRetryRequestSchema.parse(input)
  const res = await api.post(`/admin/webhooks/${id}/retry`, body)
  return WebhookDetailSchema.parse(res.data)
}
