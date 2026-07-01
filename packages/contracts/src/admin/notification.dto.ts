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
