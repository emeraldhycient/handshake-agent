/**
 * Typed admin notification-template API clients (Phase 4) — the Comms console's
 * view of the multilingual, channel-specific templates. List + read-one + a
 * deterministic, pure-render preview are read-only; create (POST) and edit
 * (PATCH) are sensitive and may 403 with ADMIN_STEP_UP_REQUIRED (the caller wraps
 * them in `useStepUpRetry`). Each parses its input through the request schema
 * before the request fires and parses the response through the response schema
 * after (§3.3 / §8: the FE gate is UX, never the only check; shapes that cross
 * the boundary come from contracts).
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  NotificationTemplateSchema,
  NotificationTemplateListResponseSchema,
  NotificationTemplateUpsertRequestSchema,
  NotificationTemplatePreviewRequestSchema,
  NotificationTemplatePreviewResponseSchema,
  type NotificationChannel,
  type NotificationTemplate,
  type NotificationTemplateListResponse,
  type NotificationTemplateUpsertRequest,
  type NotificationTemplatePreviewRequest,
  type NotificationTemplatePreviewResponse,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** The composite key identifying one template (templateKey, language, channel). */
export interface TemplateRef {
  templateKey: string
  language: string
  channel: NotificationChannel
}

function refPath({ templateKey, language, channel }: TemplateRef): string {
  return `/admin/notification-templates/${encodeURIComponent(
    templateKey
  )}/${encodeURIComponent(language)}/${encodeURIComponent(channel)}`
}

/** GET /admin/notification-templates — all templates the admin can edit. */
export async function listNotificationTemplates(): Promise<NotificationTemplateListResponse> {
  const res = await api.get("/admin/notification-templates")
  return NotificationTemplateListResponseSchema.parse(res.data)
}

/** GET /admin/notification-templates/:templateKey/:language/:channel — one template. */
export async function getNotificationTemplate(
  ref: TemplateRef
): Promise<NotificationTemplate> {
  const res = await api.get(refPath(ref))
  return NotificationTemplateSchema.parse(res.data)
}

/**
 * POST /admin/notification-templates — upsert on the composite unique. Sensitive:
 * may 403 with ADMIN_STEP_UP_REQUIRED. Returns the persisted template.
 */
export async function upsertNotificationTemplate(
  input: NotificationTemplateUpsertRequest
): Promise<NotificationTemplate> {
  const body = NotificationTemplateUpsertRequestSchema.parse(input)
  const res = await api.post("/admin/notification-templates", body)
  return NotificationTemplateSchema.parse(res.data)
}

/**
 * PATCH /admin/notification-templates/:templateKey/:language/:channel — edit an
 * existing template. Sensitive: may 403 with ADMIN_STEP_UP_REQUIRED. Returns the
 * updated template.
 */
export async function updateNotificationTemplate(
  ref: TemplateRef,
  input: NotificationTemplateUpsertRequest
): Promise<NotificationTemplate> {
  const body = NotificationTemplateUpsertRequestSchema.parse(input)
  const res = await api.patch(refPath(ref), body)
  return NotificationTemplateSchema.parse(res.data)
}

/**
 * POST /admin/notification-templates/preview — pure deterministic render of the
 * supplied content + variables. Read-only (no template is persisted).
 */
export async function previewNotificationTemplate(
  input: NotificationTemplatePreviewRequest
): Promise<NotificationTemplatePreviewResponse> {
  const body = NotificationTemplatePreviewRequestSchema.parse(input)
  const res = await api.post("/admin/notification-templates/preview", body)
  return NotificationTemplatePreviewResponseSchema.parse(res.data)
}
