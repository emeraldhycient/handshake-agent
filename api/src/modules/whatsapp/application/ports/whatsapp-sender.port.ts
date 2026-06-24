/**
 * Port: WhatsApp outbound sender
 *
 * Application depends on this abstraction; infrastructure provides the
 * Cloud API adapter. Follows the same Symbol-token + interface pattern as
 * `rate-provider.port.ts` in the quotes module.
 */

/** DI token for the WhatsApp outbound sender. */
export const WHATSAPP_SENDER = Symbol('WHATSAPP_SENDER');

/**
 * The canonical result returned by every outbound send operation.
 * `externalMessageId` is the `wamid.*` returned by the Cloud API.
 */
export type SendResult = { externalMessageId: string };

/**
 * Input for sending a WhatsApp interactive CTA URL button message (K3).
 * Used for the web-handoff link that opens the KYC flow in the web app.
 * The URL is HTTPS and must never be sent over plaintext; the token is part
 * of the URL — it is a single-use bearer; do NOT log the full URL.
 */
export interface SendCtaUrlInput {
  /** Recipient phone number in E.164 without the leading '+'. */
  to: string;
  /** Text body displayed above the CTA button. */
  body: string;
  /** Label text shown on the CTA button. */
  buttonText: string;
  /** The HTTPS URL the button opens (contains the single-use token). */
  url: string;
}

/**
 * Input for sending a WhatsApp Flow interactive message.
 * The nonce is carried ONLY inside the E2E-encrypted flow payload data —
 * it must never appear in plaintext chat or logs.
 */
export interface SendFlowInput {
  /** Recipient phone number in E.164 without the leading '+'. */
  to: string;
  /** Meta Flow ID as registered in the WhatsApp Business dashboard. */
  flowId: string;
  /**
   * Signed flow_token — opaque to the WhatsApp surface; verified by the
   * flow data-exchange endpoint to bind the session to a proposal+directive.
   */
  flowToken: string;
  /** CTA button label shown on the opening screen. */
  cta: string;
  /** Initial screen name to navigate to (e.g. 'CONFIRM'). */
  screen: string;
  /**
   * Initial data seeded into the Flow screen — carries itemized confirmation
   * fields and the nonce (E2E-encrypted by the WhatsApp client; never
   * in plaintext chat).
   */
  data: Record<string, unknown>;
}

/**
 * Input for sending the beneficiary add/select WhatsApp Flow message (S3).
 * Beneficiary details travel ONLY via Flow E2E encryption — never plaintext.
 */
export interface SendBeneficiaryFlowInput {
  /** Recipient phone number in E.164 without the leading '+'. */
  to: string;
  /** Meta Flow ID for the beneficiary flow (WHATSAPP_BENEFICIARY_FLOW_ID). */
  flowId: string;
  /**
   * Signed flow_token — binds the session to a userId so the flow endpoint
   * can validate beneficiary ownership.
   */
  flowToken: string;
  /** 'bank_account' | 'crypto_address' — determines which add-form screen to show. */
  type: 'bank_account' | 'crypto_address';
  /**
   * Saved beneficiaries seeded into the SELECT screen.
   * Each entry is { id, label } — just enough for the user to pick.
   */
  beneficiaries: Array<{ id: string; label: string }>;
}

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

  /**
   * Send an interactive CTA URL button message (K3 web-handoff).
   *
   * Used to send the web KYC link as a clickable button in WhatsApp chat.
   * The URL contains a single-use bearer token — callers MUST use HTTPS.
   * IMPORTANT: never log the full URL (it embeds the token).
   *
   * @param input  CTA parameters including recipient, body text, button label,
   *               and the HTTPS URL to open.
   */
  sendCtaUrl(input: SendCtaUrlInput): Promise<SendResult>;

  /**
   * Send an E2E-encrypted WhatsApp Flow interactive message.
   *
   * Used for the buy confirmation+PIN flow (Phase 6): the nonce and itemized
   * confirmation data travel ONLY inside the Flow E2E channel — never as
   * plaintext chat. See ADR-0003 and CLAUDE.md §3.5.
   *
   * @param input  Flow parameters including flowId, flowToken, screen, and
   *               the initial data payload (carries nonce and confirmation).
   */
  sendFlow(input: SendFlowInput): Promise<SendResult>;

  /**
   * Send the beneficiary add/select WhatsApp Flow message (S3).
   *
   * Opens a SELECT screen seeded with saved beneficiaries and an "add new"
   * option. Bank/crypto details travel ONLY via the Flow E2E channel — never
   * as plaintext chat. See CLAUDE.md §3.5 and ADR-0003.
   *
   * @param input  Beneficiary flow parameters including flowId, flowToken,
   *               type, and the list of saved beneficiaries.
   */
  sendBeneficiaryFlow(input: SendBeneficiaryFlowInput): Promise<SendResult>;
}
