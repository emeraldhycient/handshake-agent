import { z } from "zod";

// Notification-template DTOs — the admin Comms console's view of the multilingual,
// admin-editable, channel-specific templates (Prisma `NotificationTemplate`, NTF-07).
// CRUD + a pure-render preview. The render itself is deterministic; no raw HTML is
// injected (root CLAUDE.md §3.1 — the model never authors templates, an admin does).

/**
 * Delivery channels a template targets. A subset of the Prisma `Channel` enum —
 * `web` is an identity/agent surface, not a notification delivery channel, so it
 * is intentionally excluded here.
 */
export const NotificationChannelSchema = z.enum([
  "whatsapp",
  "email",
  "sms",
  "in_app",
]);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

/** One documented template variable (`NotificationTemplate.variables[]` entry). */
export const TemplateVariableSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string(),
});
export type TemplateVariable = z.infer<typeof TemplateVariableSchema>;

/** A persisted template as the admin console reads it. */
export const NotificationTemplateSchema = z.object({
  id: z.string().uuid(),
  templateKey: z.string(),
  language: z.string(),
  channel: NotificationChannelSchema,
  subject: z.string().nullable(),
  contentText: z.string(),
  contentHtml: z.string().nullable(),
  whatsappTemplateId: z.string().nullable(),
  variables: z.array(TemplateVariableSchema),
});
export type NotificationTemplate = z.infer<typeof NotificationTemplateSchema>;

export const NotificationTemplateListResponseSchema = z.object({
  items: z.array(NotificationTemplateSchema),
});
export type NotificationTemplateListResponse = z.infer<
  typeof NotificationTemplateListResponseSchema
>;

/**
 * POST/PATCH body — an upsert on the composite unique (templateKey, language,
 * channel). `subject`/`contentHtml`/`whatsappTemplateId` are optional; `variables`
 * defaults to an empty array.
 */
export const NotificationTemplateUpsertRequestSchema = z.object({
  templateKey: z.string().min(1),
  language: z.string().min(2),
  channel: NotificationChannelSchema,
  subject: z.string().optional(),
  contentText: z.string().min(1),
  contentHtml: z.string().optional(),
  whatsappTemplateId: z.string().optional(),
  variables: z.array(TemplateVariableSchema).default([]),
});
export type NotificationTemplateUpsertRequest = z.infer<
  typeof NotificationTemplateUpsertRequestSchema
>;

/** POST /admin/notification-templates/preview body — content + the render vars. */
export const NotificationTemplatePreviewRequestSchema = z.object({
  contentText: z.string(),
  subject: z.string().optional(),
  variables: z.record(z.string()),
});
export type NotificationTemplatePreviewRequest = z.infer<
  typeof NotificationTemplatePreviewRequestSchema
>;

/** The rendered preview — subject is null when no subject was supplied. */
export const NotificationTemplatePreviewResponseSchema = z.object({
  renderedSubject: z.string().nullable(),
  renderedText: z.string(),
});
export type NotificationTemplatePreviewResponse = z.infer<
  typeof NotificationTemplatePreviewResponseSchema
>;

// ── Delivery log (Phase 6b, Comms READ enrichment) ───────────────────────────────
// The read-only delivery log the Comms console shows below the broadcast composer:
// one row per issued `Notification`, plus aggregate bounce/complaint stats derived
// from the per-attempt `ChannelOutboundDispatch` rows. READ ONLY — this surfaces
// what the outbox already recorded; it never sends anything (root CLAUDE.md §3.1).

/**
 * A delivery attempt's terminal state, derived server-side from the notification's
 * `isSent` / `isFailed` flags + its per-attempt delivery log. `delivered` = a
 * dispatch confirmed delivered; `sent` = handed to the provider; `bounced` /
 * `failed` = a hard failure; `sending` = still in flight (not yet sent/failed).
 */
export const DeliveryLogStatusSchema = z.enum([
  "delivered",
  "sent",
  "sending",
  "bounced",
  "failed",
]);
export type DeliveryLogStatus = z.infer<typeof DeliveryLogStatusSchema>;

/**
 * One row of the delivery log — an issued notification with its resolved primary
 * channel, template key (the message name), the triggering event type (the audience
 * context), issue time, and derived status. No PII: only the opaque event ref and
 * template/event identifiers cross this boundary (§3.4).
 */
export const DeliveryLogEntrySchema = z.object({
  id: z.string().uuid(),
  channel: NotificationChannelSchema,
  /** The template key that rendered the message, or null for a plain fallback. */
  templateKey: z.string().nullable(),
  /** The domain event that triggered the notification (e.g. `kyc_approved`). */
  eventType: z.string(),
  /** ISO-8601 issue time (the notification's `createdAt`). */
  createdAt: z.string().datetime(),
  status: DeliveryLogStatusSchema,
});
export type DeliveryLogEntry = z.infer<typeof DeliveryLogEntrySchema>;

/**
 * Aggregate delivery-health stats over the sampled window: the bounce rate and
 * the complaint rate as fractions in [0,1] (the FE renders them as percentages),
 * plus the dispatch sample size they were computed from. `complaintRate` is 0 when
 * the provider surfaces no complaint signal — never fabricated.
 */
export const DeliveryStatsSchema = z.object({
  bounceRate: z.number().min(0).max(1),
  complaintRate: z.number().min(0).max(1),
  /** Number of dispatch attempts the rates were computed over. */
  sampleSize: z.number().int().nonnegative(),
});
export type DeliveryStats = z.infer<typeof DeliveryStatsSchema>;

/** GET /admin/notifications/delivery-log — recent delivery rows + aggregate stats. */
export const DeliveryLogResponseSchema = z.object({
  items: z.array(DeliveryLogEntrySchema),
  stats: DeliveryStatsSchema,
});
export type DeliveryLogResponse = z.infer<typeof DeliveryLogResponseSchema>;
