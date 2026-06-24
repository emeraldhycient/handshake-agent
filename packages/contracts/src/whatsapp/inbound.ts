import { z } from 'zod'

// ---------------------------------------------------------------------------
// WhatsApp Cloud API — inbound webhook payload (received messages)
//
// Meta delivers events as POST to the webhook URL configured in the Developer
// Console. This schema covers both text-message events and status-update
// (delivery receipt) events. Unknown message types are tolerated so a new
// media type from Meta does not crash the webhook receiver.
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
   * Message type. "text" is the only type the app acts on; unknown types
   * (image, audio, document, reaction, …) are preserved and skipped by
   * `extractTextMessages`.
   */
  type: z.string(),
  /** Present only when `type === "text"`. */
  text: z.object({ body: z.string() }).optional(),
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
// Extracted text-message shape
// ---------------------------------------------------------------------------

/**
 * The fields the application needs from a single inbound text message.
 * `waName` may be undefined if Meta omits the contacts array (rare but valid).
 */
export type InboundTextMessage = {
  /** The WhatsApp message ID (`wamid.*`). */
  externalMessageId: string
  /** Sender's WhatsApp phone number (E.164 without the '+' prefix). */
  from: string
  /** The phone number ID of the receiving business account. */
  phoneNumberId: string
  /** The sender's WhatsApp display name (from the contacts array). */
  waName: string | undefined
  /** The raw text body the user sent. */
  text: string
  /** Unix timestamp in seconds as a string. */
  timestamp: string
}

/**
 * Walks a parsed `WhatsAppInbound` payload and returns one `InboundTextMessage`
 * per text-type message found. Status updates, non-text messages (image, audio,
 * document, etc.), and messages with no `text.body` are silently skipped.
 */
export function extractTextMessages(
  payload: WhatsAppInbound,
): InboundTextMessage[] {
  const results: InboundTextMessage[] = []

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const { value } = change
      if (!value.messages) continue

      // Build a quick wa_id → display name look-up from the contacts array.
      const nameByWaId: Record<string, string> = {}
      for (const contact of value.contacts ?? []) {
        nameByWaId[contact.wa_id] = contact.profile.name
      }

      for (const message of value.messages) {
        // Skip non-text messages or text messages with no body.
        if (message.type !== 'text' || !message.text?.body) continue

        results.push({
          externalMessageId: message.id,
          from: message.from,
          phoneNumberId: value.metadata.phone_number_id,
          waName: nameByWaId[message.from],
          text: message.text.body,
          timestamp: message.timestamp,
        })
      }
    }
  }

  return results
}
