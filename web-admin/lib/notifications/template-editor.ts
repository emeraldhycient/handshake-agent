import {
  NotificationTemplateUpsertRequestSchema,
  type NotificationChannel,
  type NotificationTemplate,
  type NotificationTemplateUpsertRequest,
  type TemplateVariable,
} from "@handshake-agent/contracts"

import type { TemplateRef } from "@/lib/api/notifications"

/** The editable form field values that compose an upsert body. */
export interface TemplateFormFields {
  templateKey: string
  language: string
  channel: NotificationChannel
  subject: string
  contentText: string
  contentHtml: string
  whatsappTemplateId: string
  variables: TemplateVariable[]
}

/** Parse the sample-variables textarea into a flat string record for the render. */
export function parseSampleVariables(
  raw: string
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: {} }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return { ok: false, error: "Sample variables must be a JSON object." }
    }
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      out[key] = String(value)
    }
    return { ok: true, value: out }
  } catch {
    return { ok: false, error: "Sample variables is not valid JSON." }
  }
}

/**
 * Validate the editable fields into an upsert body — optional subject / contentHtml /
 * whatsappTemplateId are omitted when blank. Throws (ZodError) on invalid input; the
 * caller surfaces the message inline. Nothing here persists.
 */
export function buildUpsertBody(
  fields: TemplateFormFields
): NotificationTemplateUpsertRequest {
  return NotificationTemplateUpsertRequestSchema.parse({
    templateKey: fields.templateKey,
    language: fields.language,
    channel: fields.channel,
    ...(fields.subject.trim() ? { subject: fields.subject } : {}),
    contentText: fields.contentText,
    ...(fields.contentHtml.trim() ? { contentHtml: fields.contentHtml } : {}),
    ...(fields.whatsappTemplateId.trim()
      ? { whatsappTemplateId: fields.whatsappTemplateId }
      : {}),
    variables: fields.variables,
  })
}

/**
 * On edit, the PATCH targets the immutable composite key (templateKey + language +
 * channel); on create there is no ref (POST). Derived from the editing template.
 */
export function buildTemplateRef(
  template: NotificationTemplate | null
): TemplateRef | null {
  return template
    ? {
        templateKey: template.templateKey,
        language: template.language,
        channel: template.channel,
      }
    : null
}
