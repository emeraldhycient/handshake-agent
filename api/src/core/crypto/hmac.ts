import * as crypto from 'crypto';

/**
 * Returns a lowercase hex SHA-256 digest of a UTF-8 string.
 *
 * Used for nonce hashing in DirectiveGrant (plain nonce never stored — only
 * its hash is persisted). Centralised here to avoid re-implementing in each
 * layer that needs it.
 */
export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Returns a lowercase hex HMAC digest.
 *
 * Supports sha256 (WhatsApp/Meta X-Hub-Signature-256) and sha512
 * (Blockradar deposit webhooks — keyed by API key per ADR-0006).
 * Node `crypto` only; no external dependencies.
 */
export function hmacHex(
  algo: 'sha256' | 'sha512',
  key: string,
  payload: Buffer | string,
): string {
  return crypto.createHmac(algo, key).update(payload).digest('hex');
}

/**
 * Verifies a `<prefix><lowercasehex>` webhook signature header.
 *
 * Returns `false` rather than throwing on any bad input — callers convert
 * falsy returns to 401/403 responses and must never leak timing information
 * about the comparison (hence `timingSafeEqual`).
 *
 * Length-mismatch guard: `timingSafeEqual` throws when buffers differ in
 * length, so we check lengths before comparing and short-circuit to `false`.
 */
export function verifyHmacHeader(
  algo: 'sha256' | 'sha512',
  key: string,
  payload: Buffer,
  headerValue: string | undefined,
  prefix = 'sha256=',
): boolean {
  try {
    // Null/undefined header → reject.
    if (!headerValue) return false;

    // Must start with the expected prefix.
    if (!headerValue.startsWith(prefix)) return false;

    const receivedHex = headerValue.slice(prefix.length);

    // Reject obviously invalid hex (odd length, non-hex chars, empty).
    if (receivedHex.length === 0 || receivedHex.length % 2 !== 0) return false;
    if (!/^[0-9a-fA-F]+$/.test(receivedHex)) return false;

    const expectedHex = hmacHex(algo, key, payload);

    // Encode both sides as UTF-8 Buffers for `timingSafeEqual`.
    // Length must match before the call or it throws.
    const expected = Buffer.from(expectedHex, 'utf8');
    const received = Buffer.from(receivedHex, 'utf8');

    if (expected.length !== received.length) return false;

    return crypto.timingSafeEqual(expected, received);
  } catch {
    // Any unexpected error (e.g., malformed input passed through `any`)
    // must never propagate — return false to fail closed.
    return false;
  }
}
