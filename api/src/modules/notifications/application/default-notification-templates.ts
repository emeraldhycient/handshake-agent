/**
 * Platform-default notification templates (NTF-07).
 *
 * These are the REAL default message bodies the platform sends today — derived
 * directly from the transaction engine's WhatsApp receipt/notice text
 * (`execution.service.ts`: send/sell complete + failed), the deposit-webhook
 * receipt (`blockradar-webhook.controller.ts`), and the buy-payment receipt
 * (`flutterwave-webhook.controller.ts`), keyed to the `NotificationEventType`
 * enum. They are seeded so an operator can VIEW and EDIT the canonical copy from
 * the admin Comms console instead of facing an empty screen — they are NOT
 * fabricated samples (root CLAUDE.md §3.6). The hardcoded literals in the send
 * sites remain authoritative until a runtime dispatcher renders by templateKey;
 * this seed makes the same copy admin-visible/editable as the migration target.
 *
 * The `templateKey` is the `NotificationEventType` value (the schema's
 * `Notification.templateKey` "Points at a NotificationTemplate.templateKey").
 * Bodies use the deterministic `{{var}}` placeholder the renderer substitutes.
 * Every seed row is platform-authored (`updatedByAdminId = null`) and inserted
 * idempotently — it NEVER overwrites an admin's later edit.
 */

/** One committed default template row (a subset of the upsert input). */
export interface DefaultNotificationTemplate {
  /** The NotificationEventType value referenced by Notification.templateKey. */
  templateKey: string;
  /** BCP-47 tag. All defaults ship in English; other languages are admin-authored. */
  language: string;
  /** Delivery channel. WhatsApp is the platform's primary notification channel. */
  channel: 'whatsapp' | 'email' | 'sms' | 'in_app';
  /** Email subject (only meaningful for the email channel). */
  subject?: string;
  /** The message body with `{{var}}` placeholders. */
  contentText: string;
  /** Documented variables the body interpolates. */
  variables: Array<{ name: string; type: string; description: string }>;
}

const VAR = (
  name: string,
  description: string,
): { name: string; type: string; description: string } => ({
  name,
  type: 'string',
  description,
});

/**
 * The real default templates, one per money-moving domain event the platform
 * currently notifies on. Copy is verbatim from the send sites (emoji + line
 * breaks preserved), with the interpolated values turned into `{{var}}` tokens.
 */
export const DEFAULT_NOTIFICATION_TEMPLATES: readonly DefaultNotificationTemplate[] =
  [
    // Buy: Flutterwave settleAndNotify → buildReceiptText (crypto purchase complete).
    {
      templateKey: 'transaction_completed',
      language: 'en',
      channel: 'whatsapp',
      contentText:
        '✅ Your crypto purchase is complete!\n' +
        'Receipt: {{receiptNumber}}\n' +
        'Your {{assetSymbol}} has been credited to your Handshake wallet. ' +
        'Reply "balance" to check your balance.',
      variables: [
        VAR('receiptNumber', 'The settlement receipt number'),
        VAR('assetSymbol', 'The crypto asset credited (e.g. USDT)'),
      ],
    },
    // Send: execution.service notifySendComplete (crypto send complete).
    {
      templateKey: 'withdrawal_initiated',
      language: 'en',
      channel: 'whatsapp',
      contentText:
        '✅ Your crypto send is complete!\n' +
        'Receipt: {{receiptNumber}}\n' +
        'You sent {{cryptoAmount}} to {{toAddress}}.',
      variables: [
        VAR('receiptNumber', 'The settlement receipt number'),
        VAR('cryptoAmount', 'The formatted crypto amount sent'),
        VAR('toAddress', 'The destination on-chain address'),
      ],
    },
    // Sell: execution.service notifySellComplete (crypto sell payout complete).
    {
      templateKey: 'balance_update',
      language: 'en',
      channel: 'whatsapp',
      contentText:
        '✅ Your crypto sell is complete!\n' +
        'Receipt: {{receiptNumber}}\n' +
        'You sold {{cryptoAmount}} — {{fiatAmount}} is on its way to your bank account.',
      variables: [
        VAR('receiptNumber', 'The settlement receipt number'),
        VAR('cryptoAmount', 'The formatted crypto amount sold'),
        VAR('fiatAmount', 'The formatted net fiat payout'),
      ],
    },
    // Deposit: blockradar-webhook buildReceiptText (on-chain deposit credited).
    {
      templateKey: 'deposit_confirmed',
      language: 'en',
      channel: 'whatsapp',
      contentText:
        '✅ Deposit received\n' +
        '{{amount}} {{assetName}} credited\n' +
        'Network: {{networkName}}\n' +
        'Tx: {{txHash}}\n' +
        'New balance: {{newBalance}}\n',
      variables: [
        VAR('amount', 'The formatted deposited amount'),
        VAR('assetName', 'The asset display name'),
        VAR('networkName', 'The network display name'),
        VAR('txHash', 'The shortened on-chain transaction hash'),
        VAR('newBalance', 'The formatted new wallet balance'),
      ],
    },
    // Send/sell refund: notifySendFailed / notifySellFailed (payout failed → refund).
    {
      templateKey: 'transaction_failed',
      language: 'en',
      channel: 'whatsapp',
      contentText:
        '⚠️ Transaction failed\n' +
        'Your {{cryptoAmount}} has been refunded to your Handshake wallet.',
      variables: [VAR('cryptoAmount', 'The formatted crypto amount refunded')],
    },
    // Refund issued (engine-brokered compensation completed).
    {
      templateKey: 'refund_issued',
      language: 'en',
      channel: 'whatsapp',
      contentText:
        '↩️ Refund issued\n' +
        'Your {{cryptoAmount}} has been returned to your Handshake wallet.',
      variables: [VAR('cryptoAmount', 'The formatted crypto amount refunded')],
    },
  ];
