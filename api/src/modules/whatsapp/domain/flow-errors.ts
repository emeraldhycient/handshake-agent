/**
 * Domain errors for WhatsApp Flows E2E encryption.
 *
 * These are pure value objects — no framework deps. The controller (6.2)
 * maps them to HTTP 421 so the client refreshes the public key (§3.5).
 */

/** Thrown when AES-128-GCM decryption fails (auth tag mismatch, malformed data, etc.). */
export class FlowDecryptError extends Error {
  constructor(cause?: unknown) {
    super('Flow payload decryption failed');
    this.name = 'FlowDecryptError';
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when `WHATSAPP_FLOW_PRIVATE_KEY` is empty or not configured.
 * The operator must add the RSA private key (PEM) before Flows go live.
 * The controller maps this to HTTP 421 too — client will retry after the
 * operator provides the key.
 */
export class FlowKeyNotConfiguredError extends Error {
  constructor() {
    super(
      'WHATSAPP_FLOW_PRIVATE_KEY is not configured — operator must provide a valid RSA private key PEM',
    );
    this.name = 'FlowKeyNotConfiguredError';
  }
}

/**
 * Thrown when a flow_token HMAC fails verification or the token is expired.
 * The controller maps this to an ERROR screen response (no internals exposed).
 */
export class FlowTokenError extends Error {
  constructor(reason: string) {
    super(`Flow token invalid: ${reason}`);
    this.name = 'FlowTokenError';
  }
}
