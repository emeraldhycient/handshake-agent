/**
 * Port: WhatsApp outbound sender
 *
 * Application depends on this abstraction; infrastructure provides the
 * Cloud API adapter. Follows the same Symbol-token + interface pattern as
 * `rate-provider.port.ts` in the quotes module.
 *
 * `sendFlow` is declared in Phase 6 — see the brief. It is intentionally
 * omitted here to avoid a silent stub.
 */

/** DI token for the WhatsApp outbound sender. */
export const WHATSAPP_SENDER = Symbol('WHATSAPP_SENDER');

/**
 * The canonical result returned by every outbound send operation.
 * `externalMessageId` is the `wamid.*` returned by the Cloud API.
 */
export type SendResult = { externalMessageId: string };

/**
 * The application depends on this abstraction, never on the Cloud API
 * directly. Infrastructure implements it (`CloudApiSender`); extraction
 * to a standalone service = swap the binding, zero caller changes.
 */
export interface IWhatsAppSender {
  /**
   * Send a plain-text message to a WhatsApp user.
   * @param to  Recipient phone number in E.164 without the leading '+'.
   * @param body  Text body (max 4096 chars per the Cloud API).
   */
  sendText(to: string, body: string): Promise<SendResult>;

  /**
   * Send a pre-approved template message.
   * @param to            Recipient phone number (E.164, no '+').
   * @param name          Template name as registered in Meta's template manager.
   * @param languageCode  BCP-47 locale code, e.g. `'en_US'`.
   * @param components    Optional header / body / button fill-in components.
   */
  sendTemplate(
    to: string,
    name: string,
    languageCode: string,
    components?: unknown[],
  ): Promise<SendResult>;
}
