import { z } from 'zod'

// ---------------------------------------------------------------------------
// WhatsApp Cloud API — inbound webhook payload (received messages)
//
// Meta delivers events as POST to the webhook URL configured in the Developer
// Console. This schema covers text-message events, media events (audio, image,
// document), and status-update (delivery receipt) events. Unknown message types
// are tolerated so a new media type from Meta does not crash the webhook receiver.
//
// Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
// ---------------------------------------------------------------------------

/** Individual message inside `value.messages[]`. */
const InboundMessageSchema = z.object({
  /** Sender's WhatsApp phone number (E.164 without the '+' prefix). */
  from: z.string(),
  /** WhatsApp message ID (`wamid.*`). */
  id: z.string(),
  /** Unix timestamp in seconds, as a string (Meta sends it that way). */
  timestamp: z.string(),
  /**
   * Message type. "text", "audio", "image", "document" are acted on; unknown
   * types are preserved and skipped by the extractors.
   */
  type: z.string(),
  /** Present only when `type === "text"`. */
  text: z.object({ body: z.string() }).optional(),
  /** Present only when `type === "audio"` (includes voice notes). */
  audio: z
    .object({
      id: z.string(),
      mime_type: z.string(),
      voice: z.boolean().optional(),
    })
    .optional(),
  /** Present only when `type === "image"`. */
  image: z
    .object({
      id: z.string(),
      mime_type: z.string(),
      sha256: z.string().optional(),
    })
    .optional(),
  /** Present only when `type === "document"`. */
  document: z
    .object({
      id: z.string(),
      mime_type: z.string(),
      filename: z.string().optional(),
      sha256: z.string().optional(),
    })
    .optional(),
})

/** Contact profile attached to each inbound message batch. */
const InboundContactSchema = z.object({
  profile: z.object({ name: z.string() }),
  wa_id: z.string(),
})

/**
 * Delivery / read-receipt entry inside `value.statuses[]`.
 * The app currently ignores statuses; we capture them loosely with
 * `passthrough()` so new status fields from Meta do not break parsing.
 */
const InboundStatusSchema = z.object({}).passthrough()

/** The `value` sub-object inside each `changes[]` entry. */
const ChangeValueSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({
    display_phone_number: z.string(),
    phone_number_id: z.string(),
  }),
  /** Present on inbound message events; absent on status-only events. */
  contacts: z.array(InboundContactSchema).optional(),
  /** One or more received messages. */
  messages: z.array(InboundMessageSchema).optional(),
  /** Delivery / read receipts — tolerated, ignored by the message extractor. */
  statuses: z.array(InboundStatusSchema).optional(),
})

/** One entry in the top-level `entry[]` array. */
const EntrySchema = z.object({
  id: z.string(),
  changes: z.array(
    z.object({
      field: z.string(),
      value: ChangeValueSchema,
    }),
  ),
})

/**
 * Full WhatsApp Cloud API webhook payload.
 *
 * Permissive by design: unknown `type` values are allowed, and the three
 * optional arrays (`messages`, `contacts`, `statuses`) may all be absent in
 * the same payload (e.g. a status-only delivery receipt has no `messages`).
 */
export const WhatsAppInboundSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(EntrySchema),
})

export type WhatsAppInbound = z.infer<typeof WhatsAppInboundSchema>

// ---------------------------------------------------------------------------
// Inbound event union
// ---------------------------------------------------------------------------

/**
 * Fields common to every inbound event kind.
 */
export type InboundCommon = {
  /** The WhatsApp message ID (`wamid.*`). */
  externalMessageId: string
  /** Sender's WhatsApp phone number (E.164 without the '+' prefix). */
  from: string
  /** The phone number ID of the receiving business account. */
  phoneNumberId: string
  /** The sender's WhatsApp display name (from the contacts array). */
  waName: string | undefined
  /** Unix timestamp in seconds as a string. */
  timestamp: string
}

/**
 * Discriminated union of every inbound message kind the application handles.
 * Supported: `text`, `audio` (includes voice notes), `image`, `document`.
 */
export type InboundEvent =
  | (InboundCommon & { kind: 'text'; text: string })
  | (InboundCommon & {
      kind: 'audio'
      mediaId: string
      mimeType: string
      /** True when Meta marks the audio as a voice note (PTT). Defaults to false. */
      voice: boolean
    })
  | (InboundCommon & { kind: 'image'; mediaId: string; mimeType: string })
  | (InboundCommon & {
      kind: 'document'
      mediaId: string
      mimeType: string
      filename?: string
    })

/**
 * Walks a parsed payload and returns one InboundEvent per supported message.
 * Supported kinds: text, audio (incl. voice notes), image, document. Status
 * updates and unknown/unsupported types are skipped.
 */
export function extractInboundEvents(payload: WhatsAppInbound): InboundEvent[] {
  const out: InboundEvent[] = []
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const { value } = change
      if (!value.messages) continue
      const nameByWaId: Record<string, string> = {}
      for (const c of value.contacts ?? []) nameByWaId[c.wa_id] = c.profile.name

      for (const m of value.messages) {
        const common: InboundCommon = {
          externalMessageId: m.id,
          from: m.from,
          phoneNumberId: value.metadata.phone_number_id,
          waName: nameByWaId[m.from],
          timestamp: m.timestamp,
        }
        if (m.type === 'text' && m.text?.body)
          out.push({ ...common, kind: 'text', text: m.text.body })
        else if (m.type === 'audio' && m.audio)
          out.push({
            ...common,
            kind: 'audio',
            mediaId: m.audio.id,
            mimeType: m.audio.mime_type,
            voice: m.audio.voice ?? false,
          })
        else if (m.type === 'image' && m.image)
          out.push({
            ...common,
            kind: 'image',
            mediaId: m.image.id,
            mimeType: m.image.mime_type,
          })
        else if (m.type === 'document' && m.document)
          out.push({
            ...common,
            kind: 'document',
            mediaId: m.document.id,
            mimeType: m.document.mime_type,
            filename: m.document.filename,
          })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Extracted text-message shape
// ---------------------------------------------------------------------------

/**
 * The fields the application needs from a single inbound text message.
 * Derives from `InboundCommon` and adds the text body.
 * `waName` may be undefined if Meta omits the contacts array (rare but valid).
 */
export type InboundTextMessage = InboundCommon & { text: string }

/**
 * Walks a parsed `WhatsAppInbound` payload and returns one `InboundTextMessage`
 * per text-type message found. Status updates, non-text messages (image, audio,
 * document, etc.), and messages with no `text.body` are silently skipped.
 *
 * Implemented over `extractInboundEvents` — behavior and return shape are
 * identical to the original implementation.
 */
export function extractTextMessages(
  payload: WhatsAppInbound,
): InboundTextMessage[] {
  return extractInboundEvents(payload)
    .filter(
      (e): e is InboundCommon & { kind: 'text'; text: string } =>
        e.kind === 'text',
    )
    .map((e) => ({
      externalMessageId: e.externalMessageId,
      from: e.from,
      phoneNumberId: e.phoneNumberId,
      waName: e.waName,
      text: e.text,
      timestamp: e.timestamp,
    }))
}
