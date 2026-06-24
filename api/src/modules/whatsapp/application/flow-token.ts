/**
 * WhatsApp Flow token signer / verifier (Task 6.2).
 *
 * A flow_token is a short-lived signed envelope that carries the proposal context
 * from the WhatsApp conversation into the E2E-encrypted Flow payload. It binds
 * proposalId + directiveId + userId so the Flow endpoint can call executeBuy
 * without reading from the DB for this lookup.
 *
 * Format: `<base64url(json)>.<hmacHex>`
 *   - json = { proposalId, directiveId, userId, exp } (exp = Unix seconds)
 *   - HMAC-SHA256 over the json string, keyed by DIRECTIVE_SIGNING_KEY
 *
 * Security:
 *   - verifyFlowToken uses timingSafeEqual to prevent timing attacks.
 *   - exp is checked server-side; expired tokens are rejected.
 *   - ConversationService (6.3) mints tokens; the controller (6.2) verifies them.
 *
 * Testable without Nest: key is passed as a plain string parameter.
 * The controller reads DIRECTIVE_SIGNING_KEY via ConfigService and passes it here.
 */

import * as crypto from 'crypto';
import { hmacHex } from '../../../core/crypto/hmac';
import { FlowTokenError } from '../domain/flow-errors';

/** Default TTL for flow tokens (5 minutes — same as directive grant). */
const DEFAULT_TTL_SECONDS = 300;

export interface FlowTokenPayload {
  proposalId: string;
  directiveId: string;
  userId: string;
  exp: number;
}

export interface FlowTokenInput {
  proposalId: string;
  directiveId: string;
  userId: string;
  /** If provided, used as-is (for testing); otherwise exp = now + ttlSeconds. */
  exp?: number;
}

/**
 * Signs a flow token payload with the given key.
 *
 * @param payload  The fields to embed.
 * @param key      DIRECTIVE_SIGNING_KEY from env.
 * @param ttlSeconds  Token lifetime in seconds (default 300). Ignored when payload.exp is set.
 * @returns  `<base64url(json)>.<hmacHex>`
 */
export function signFlowToken(
  payload: FlowTokenInput,
  key: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  const exp =
    payload.exp !== undefined
      ? payload.exp
      : Math.floor(Date.now() / 1000) + ttlSeconds;

  const json = JSON.stringify({
    proposalId: payload.proposalId,
    directiveId: payload.directiveId,
    userId: payload.userId,
    exp,
  } satisfies FlowTokenPayload);

  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = hmacHex('sha256', key, b64);

  return `${b64}.${sig}`;
}

/**
 * Verifies a flow token and returns its payload.
 *
 * @throws {FlowTokenError} when the token is malformed, signature-invalid, or expired.
 */
export function verifyFlowToken(token: string, key: string): FlowTokenPayload {
  const dotIdx = token.indexOf('.');
  if (dotIdx === -1) {
    throw new FlowTokenError('malformed (missing signature separator)');
  }

  const b64 = token.slice(0, dotIdx);
  const receivedSig = token.slice(dotIdx + 1);

  // Recompute HMAC — constant-time compare below.
  const expectedSig = hmacHex('sha256', key, b64);

  // Constant-time comparison to prevent timing attacks.
  if (!timingSafeEqualHex(expectedSig, receivedSig)) {
    throw new FlowTokenError('signature mismatch');
  }

  // Decode payload.
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  } catch {
    throw new FlowTokenError('malformed (invalid JSON)');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).proposalId !== 'string' ||
    typeof (parsed as Record<string, unknown>).directiveId !== 'string' ||
    typeof (parsed as Record<string, unknown>).userId !== 'string' ||
    typeof (parsed as Record<string, unknown>).exp !== 'number'
  ) {
    throw new FlowTokenError('malformed (missing required fields)');
  }

  const payload = parsed as FlowTokenPayload;

  if (Math.floor(Date.now() / 1000) > payload.exp) {
    throw new FlowTokenError('expired');
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Constant-time hex string comparison.
 *
 * `crypto.timingSafeEqual` requires equal-length Buffers; we normalise both
 * sides to the same length (expected length) before comparing — any length
 * mismatch is caught beforehand and returned as false.
 */
function timingSafeEqualHex(expected: string, received: string): boolean {
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(received, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
