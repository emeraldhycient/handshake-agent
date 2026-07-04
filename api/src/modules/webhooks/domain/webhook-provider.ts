/**
 * Pure domain helpers for the durable inbound-webhook queue.
 *
 * No Nest, no Prisma — mirrors the `WebhookProvider` / `WebhookEventStatus`
 * enums and derives the dedup key from a provider payload. Kept framework-free
 * so it is unit-testable in isolation and safe to import from any layer.
 */

import { sha256Hex } from '../../../core/crypto/hmac';

export const WEBHOOK_PROVIDERS = [
  'blockradar',
  'flutterwave',
  'whatsapp',
] as const;
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

export const WEBHOOK_EVENT_STATUSES = [
  'received',
  'processing',
  'succeeded',
  'failed',
  'dead',
] as const;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

/**
 * Terminal statuses: a row in one of these is fully drained and must never be
 * re-processed by a re-delivery or a double-enqueue (§3.1 — never double-credit).
 */
export const TERMINAL_WEBHOOK_STATUSES: ReadonlySet<string> = new Set([
  'succeeded',
  'dead',
]);

/** Coerce a natural-id candidate to a non-empty string, or undefined. */
function asId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Reach into `body.entry[0].changes[0].value` defensively (WhatsApp Cloud API). */
function firstWhatsAppValue(
  body: unknown,
): Record<string, unknown> | undefined {
  const entry = (body as { entry?: unknown })?.entry;
  if (!Array.isArray(entry) || entry.length === 0) return undefined;
  const changes = (entry[0] as { changes?: unknown })?.changes;
  if (!Array.isArray(changes) || changes.length === 0) return undefined;
  const value = (changes[0] as { value?: unknown })?.value;
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Derives the provider event id used (with `provider`) as the dedup key.
 *
 * Prefers the provider's own event id; falls back to sha256(rawBody) so an
 * exact re-delivery always dedups even when the provider gives no natural id.
 */
export function deriveWebhookEventId(
  provider: WebhookProvider,
  parsedBody: unknown,
  rawBody: Buffer | string,
): string {
  const natural = naturalEventId(provider, parsedBody);
  if (natural) return natural;
  const raw = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  return sha256Hex(raw);
}

function naturalEventId(
  provider: WebhookProvider,
  body: unknown,
): string | undefined {
  const data = (body as { data?: Record<string, unknown> })?.data;

  if (provider === 'blockradar') {
    return asId(data?.id);
  }

  if (provider === 'flutterwave') {
    return (
      asId(data?.id) ??
      asId(data?.flw_ref) ??
      asId((body as { id?: unknown })?.id)
    );
  }

  // whatsapp — prefer the first inbound message id (wamid), else a status id.
  const value = firstWhatsAppValue(body);
  const messages = value?.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    const id = asId((messages[0] as { id?: unknown })?.id);
    if (id) return id;
  }
  const statuses = value?.statuses;
  if (Array.isArray(statuses) && statuses.length > 0) {
    const id = asId((statuses[0] as { id?: unknown })?.id);
    if (id) return id;
  }
  return undefined;
}
