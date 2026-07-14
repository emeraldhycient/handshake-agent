import { z } from "zod";

// Admin console DTOs for the durable inbound-webhook queue (Track A). Mirrors the
// Prisma `WebhookEvent` model. Money never moves through these shapes — the retry
// action only re-enqueues (engine-brokered, §3.1).

export const WebhookProviderSchema = z.enum([
  "blockradar",
  "flutterwave",
  "whatsapp",
  "sumsub",
]);
export type WebhookProvider = z.infer<typeof WebhookProviderSchema>;

export const WebhookEventStatusSchema = z.enum([
  "received",
  "processing",
  "succeeded",
  "failed",
  "dead",
]);
export type WebhookEventStatus = z.infer<typeof WebhookEventStatusSchema>;

/** List filters + keyset cursor. `limit` is coerced (query strings arrive as text). */
export const WebhookListQuerySchema = z.object({
  provider: WebhookProviderSchema.optional(),
  status: WebhookEventStatusSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type WebhookListQuery = z.infer<typeof WebhookListQuerySchema>;

export const WebhookListItemSchema = z.object({
  id: z.string(),
  provider: WebhookProviderSchema,
  providerEventId: z.string(),
  status: WebhookEventStatusSchema,
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  receivedAt: z.string(),
  processedAt: z.string().nullable(),
});
export type WebhookListItem = z.infer<typeof WebhookListItemSchema>;

export const WebhookListResponseSchema = z.object({
  items: z.array(WebhookListItemSchema),
  nextCursor: z.string().nullable(),
});
export type WebhookListResponse = z.infer<typeof WebhookListResponseSchema>;

export const WebhookDetailSchema = WebhookListItemSchema.extend({
  /** Verbatim webhook body (parsed JSON, or `{ raw: string }` for non-JSON). */
  payload: z.unknown(),
  headers: z.record(z.string(), z.unknown()),
  signature: z.string().nullable(),
  lastAttemptAt: z.string().nullable(),
  deadAt: z.string().nullable(),
});
export type WebhookDetail = z.infer<typeof WebhookDetailSchema>;

/** Retry re-enqueues the webhook for processing. `reason` is audited. */
export const WebhookRetryRequestSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type WebhookRetryRequest = z.infer<typeof WebhookRetryRequestSchema>;

/** Queue-depth + failed reads for the (later) metrics dashboard (requirement 5). */
export const WebhookMetricsSchema = z.object({
  byStatus: z.record(WebhookEventStatusSchema, z.number().int()),
  /** received + processing — the in-flight backlog. */
  depth: z.number().int(),
  /** failed (retryable) rows. */
  failed: z.number().int(),
  /** dead-lettered rows awaiting an admin replay. */
  dead: z.number().int(),
});
export type WebhookMetrics = z.infer<typeof WebhookMetricsSchema>;
