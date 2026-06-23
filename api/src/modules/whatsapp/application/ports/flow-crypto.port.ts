/**
 * Port: WhatsApp Flows E2E crypto
 *
 * The application depends on this abstraction; infrastructure provides the
 * Node-`crypto` implementation (`FlowCryptoService`).
 *
 * Follows the same Symbol-token + interface pattern as `whatsapp-sender.port.ts`.
 *
 * Crypto spec (must match Meta's reference — WhatsApp-Flows-Tools encryption.js):
 *   - Decrypt: RSA-OAEP-SHA256 unwraps AES key → AES-128-GCM with last-16-byte
 *     auth tag decrypts the flow data.
 *   - Encrypt: SAME AES key, IV bit-flipped (bitwise NOT each byte) → AES-128-GCM
 *     ciphertext+tag, base64-encoded.
 *
 * Both ops live in a single port so the controller (6.2) can call decrypt +
 * encrypt through one injected dependency, keeping wiring minimal.
 */

/** DI token for the Flow crypto service. */
export const FLOW_CRYPTO = Symbol('FLOW_CRYPTO');

/** The three base64-encoded fields Meta sends in the data-exchange request body. */
export interface FlowEncryptedBody {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}

/** Successful result of `decryptRequest`. Callers MUST pass `aesKey` + `iv` to `encryptResponse`. */
export interface FlowDecryptResult {
  /** The parsed JSON payload Meta encrypted for this flow step. */
  decrypted: unknown;
  /** The 16-byte AES key unwrapped from the RSA-OAEP envelope. */
  aesKey: Buffer;
  /** The 16-byte IV from the request (before bit-flip). */
  iv: Buffer;
}

/**
 * Contract for WhatsApp Flows E2E encryption / decryption.
 *
 * Both methods use Node `crypto` only — no third-party crypto libs.
 *
 * `decryptRequest` throws `FlowKeyNotConfiguredError` when the private key env
 * var is absent, and `FlowDecryptError` on any crypto failure (including
 * GCM auth-tag mismatch from tampered data).
 */
export interface IFlowCrypto {
  /**
   * Decrypt a Meta Flow data-exchange request.
   *
   * @throws {FlowKeyNotConfiguredError} when `WHATSAPP_FLOW_PRIVATE_KEY` is empty.
   * @throws {FlowDecryptError} on any RSA/AES failure.
   */
  decryptRequest(body: FlowEncryptedBody): FlowDecryptResult;

  /**
   * Encrypt a response object to send back to the Flow client.
   *
   * Uses the SAME `aesKey` from `decryptRequest`, with the IV bit-flipped.
   * Returns a raw base64 string — the HTTP body, NOT JSON-wrapped.
   *
   * @param response  Any JSON-serialisable object.
   * @param aesKey    16-byte AES key from `decryptRequest`.
   * @param iv        Original IV from `decryptRequest` (before bit-flip).
   */
  encryptResponse(response: unknown, aesKey: Buffer, iv: Buffer): string;
}
