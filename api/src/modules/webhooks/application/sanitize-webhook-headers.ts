/**
 * Pure webhook-secret redaction policy for the durable webhook queue.
 *
 * Inbound webhook headers can carry AUTHENTICATION MATERIAL — most critically
 * Flutterwave's `verif-hash`, which (v3 spec) is plain equality against the
 * STATIC `FLUTTERWAVE_WEBHOOK_SECRET`, so persisting or exposing it leaks the
 * secret itself. Headers are sanitized once at the ingestion choke point
 * (WebhookIngestionService) so every provider's persisted row is clean, and
 * again on admin read (AdminWebhooksService) as defense-in-depth for legacy
 * rows persisted before this policy existed.
 *
 * Per-request HMAC signatures (Blockradar `x-blockradar-signature`, WhatsApp
 * `x-hub-signature-256`) are digests over the body keyed by a secret that never
 * leaves the env — they reveal nothing and stay verbatim for debuggability.
 *
 * Verification always happens at the controller BEFORE persistence; replay
 * (worker/sweeper/admin retry) trusts the persisted verified row and never
 * re-verifies, so redaction cannot break redelivery.
 */

import { sha256Hex } from '../../../core/crypto/hmac';

/** Placeholder stored/returned in place of a secret-bearing header value. */
export const REDACTED_VALUE = '[REDACTED]';

/** Prefix marking a stored signature as a non-reversible digest, not a secret. */
const SIGNATURE_DIGEST_PREFIX = 'sha256:';

/**
 * Lowercase names of headers whose values are (or may be) reusable secrets.
 * `verif-hash` is the Flutterwave static webhook secret; the rest are generic
 * credential carriers that must never land in the database.
 */
const SECRET_HEADER_DENYLIST: ReadonlySet<string> = new Set([
  'verif-hash',
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
]);

/**
 * Returns a copy of `headers` with every denylisted header's value replaced by
 * REDACTED_VALUE. Name matching is case-insensitive (Node lowercases inbound
 * header names, but legacy rows / tests may carry any casing). Never mutates
 * the input.
 */
export function sanitizeWebhookHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    sanitized[name] = SECRET_HEADER_DENYLIST.has(name.toLowerCase())
      ? REDACTED_VALUE
      : value;
  }
  return sanitized;
}

/**
 * Non-reversible stored form of a secret-equality "signature" (Flutterwave
 * `verif-hash`): a sha256:-prefixed hex digest. Supports duplicate-comparison
 * and audit without persisting the secret itself.
 */
export function toStoredSignatureDigest(rawSecret: string): string {
  return `${SIGNATURE_DIGEST_PREFIX}${sha256Hex(rawSecret)}`;
}

/**
 * Read-side redaction for the persisted `signature` column. Flutterwave rows
 * written before the digest policy hold the RAW static secret — anything for
 * that provider not in digest form is redacted. Per-request HMAC signatures
 * (blockradar/whatsapp) pass through verbatim.
 */
export function redactStoredSignature(
  provider: string,
  signature: string | null,
): string | null {
  if (signature === null) return null;
  if (provider !== 'flutterwave') return signature;
  return signature.startsWith(SIGNATURE_DIGEST_PREFIX)
    ? signature
    : REDACTED_VALUE;
}
