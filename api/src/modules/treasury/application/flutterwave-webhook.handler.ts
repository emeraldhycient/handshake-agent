/**
 * FlutterwaveWebhookHandler — the async processing body for Flutterwave
 * webhooks (charge.completed / transfer.completed + the legacy flat formats).
 *
 * Runs in the worker on a persisted WebhookEvent AFTER the controller verified
 * the secret hash. Carries the exact routing that used to live inline in the
 * controller, now keyed off `event.payload`.
 *
 * Funds-safety (§3.1): the settle methods RE-VERIFY with the provider and are
 * idempotent. A settlement EXCEPTION is retryable — it propagates so the worker
 * retries with backoff + dead-letters on exhaustion (the SettlementOutbox
 * reconciler also re-drives, so a parallel re-drive never double-settles). A
 * `pending` result is not a failure (payment not confirmed yet) — ack it. A
 * receipt-send failure is best-effort. Unhandled events ack without processing.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { ExecutionService } from '../../transactions/application/execution.service';
import { IdentityService } from '../../identity/application/identity.service';
import {
  WHATSAPP_SENDER,
  type IWhatsAppSender,
} from '../../whatsapp/application/ports/whatsapp-sender.port';
import type { WebhookHandler } from '../../webhooks/application/ports/webhook-handler.port';
import type { WebhookEventRecord } from '../../webhooks/application/ports/webhook-event.repository.port';

interface FlutterwaveWebhookBody {
  event?: unknown;
  data?: {
    status?: unknown;
    tx_ref?: unknown;
    reference?: unknown;
    [k: string]: unknown;
  };
  txRef?: unknown;
  reference?: unknown;
  status?: unknown;
}

@Injectable()
export class FlutterwaveWebhookHandler implements WebhookHandler {
  readonly provider = 'flutterwave';
  private readonly logger = new Logger(FlutterwaveWebhookHandler.name);

  constructor(
    private readonly executionService: ExecutionService,
    private readonly identityService: IdentityService,
    @Inject(WHATSAPP_SENDER)
    private readonly sender: IWhatsAppSender,
    private readonly assetRegistry: AssetRegistry,
  ) {}

  async handle(event: WebhookEventRecord): Promise<void> {
    const payload = event.payload as FlutterwaveWebhookBody;

    if (payload?.event === 'charge.completed') {
      return this.handleChargeCompleted(payload);
    }
    if (payload?.event === 'transfer.completed') {
      return this.handleTransferCompleted(payload);
    }

    // Legacy flat formats (no top-level `event`).
    if (payload?.event === undefined) {
      if (typeof payload?.txRef === 'string') {
        return this.handleLegacyCollection(payload);
      }
      if (typeof payload?.reference === 'string') {
        return this.handleLegacyTransfer(payload);
      }
    }

    this.logger.log(
      { event: payload?.event },
      'Flutterwave webhook: unhandled event — acking without processing',
    );
  }

  private async handleChargeCompleted(
    payload: FlutterwaveWebhookBody,
  ): Promise<void> {
    const data = payload.data;
    if (data?.status !== 'successful') {
      this.logger.log(
        { status: data?.status },
        'Flutterwave webhook: charge not successful — acking without processing',
      );
      return;
    }
    const txRef = data?.tx_ref;
    if (typeof txRef !== 'string' || txRef.length === 0) {
      this.logger.warn(
        { data },
        'Flutterwave webhook: charge.completed missing tx_ref — acking',
      );
      return;
    }
    await this.settleBuyAndNotify(txRef);
  }

  private async handleTransferCompleted(
    payload: FlutterwaveWebhookBody,
  ): Promise<void> {
    const status = payload.data?.status;
    if (status !== 'SUCCESSFUL' && status !== 'FAILED') {
      this.logger.log(
        { status },
        'Flutterwave webhook: transfer.completed unhandled status — acking',
      );
      return;
    }
    const reference = payload.data?.reference;
    if (typeof reference !== 'string' || reference.length === 0) {
      this.logger.warn(
        { data: payload.data },
        'Flutterwave webhook: transfer.completed missing reference — acking',
      );
      return;
    }
    await this.settleSellAndNotify(reference);
  }

  private async handleLegacyCollection(
    payload: FlutterwaveWebhookBody,
  ): Promise<void> {
    if (payload.status !== 'successful') {
      this.logger.log(
        { status: payload.status },
        'Flutterwave webhook: legacy collection not successful — acking',
      );
      return;
    }
    const txRef = payload.txRef;
    if (typeof txRef !== 'string' || txRef.length === 0) {
      this.logger.warn(
        'Flutterwave webhook: legacy collection missing txRef — acking',
      );
      return;
    }
    await this.settleBuyAndNotify(txRef);
  }

  private async handleLegacyTransfer(
    payload: FlutterwaveWebhookBody,
  ): Promise<void> {
    const status = payload.status;
    if (status !== 'SUCCESSFUL' && status !== 'FAILED') {
      this.logger.log(
        { status },
        'Flutterwave webhook: legacy transfer unhandled status — acking',
      );
      return;
    }
    const reference = payload.reference;
    if (typeof reference !== 'string' || reference.length === 0) {
      this.logger.warn(
        'Flutterwave webhook: legacy transfer missing reference — acking',
      );
      return;
    }
    await this.settleSellAndNotify(reference);
  }

  // ---------------------------------------------------------------------------
  // Settlement (exceptions propagate for retry; pending acks; notify best-effort)
  // ---------------------------------------------------------------------------

  private async settleBuyAndNotify(txRef: string): Promise<void> {
    const result = await this.executionService.settleBuyPayment({
      reference: txRef,
    });
    if (result.status !== 'completed') {
      this.logger.log(
        { txRef, status: result.status },
        'Flutterwave webhook: buy settlement pending — will finalize later',
      );
      return;
    }
    await this.sendReceipt(
      result.transactionId,
      result.userId,
      result.receiptNumber,
      result.assetSymbol,
    );
  }

  private async settleSellAndNotify(reference: string): Promise<void> {
    const result = await this.executionService.settleSellPayout({ reference });
    if (result.status === 'pending') {
      this.logger.log(
        { reference, status: result.status },
        'Flutterwave webhook: sell settlement pending — will finalize later',
      );
      return;
    }
    await this.sendReceipt(
      result.transactionId,
      result.userId,
      result.receiptNumber,
    );
  }

  private async sendReceipt(
    transactionId: string,
    userId: string | undefined,
    receiptNumber: string | undefined,
    assetSymbol?: string,
  ): Promise<void> {
    if (!userId) {
      this.logger.warn(
        { transactionId },
        'Flutterwave webhook: settlement has no userId — skipping receipt',
      );
      return;
    }
    try {
      const waAddress = await this.identityService.findWhatsAppAddress(userId);
      if (!waAddress) {
        this.logger.warn(
          { userId, transactionId },
          'Flutterwave webhook: no WhatsApp address — skipping receipt',
        );
        return;
      }
      await this.sender.sendText(
        waAddress,
        this.buildReceiptText(receiptNumber, transactionId, assetSymbol),
      );
    } catch (err: unknown) {
      this.logger.error(
        { err, userId, transactionId },
        'Flutterwave webhook: failed to send WhatsApp receipt — ignoring',
      );
    }
  }

  private buildReceiptText(
    receiptNumber: string | undefined,
    transactionId: string,
    assetSymbol?: string,
  ): string {
    const ref = receiptNumber ?? transactionId;
    const assetDisplayName = this.assetRegistry.asset(
      assetSymbol ?? this.assetRegistry.defaultCryptoAsset(),
    ).displayName;
    return (
      `✅ Your crypto purchase is complete!\n` +
      `Receipt: ${ref}\n` +
      `Your ${assetDisplayName} has been credited to your Handshake wallet. ` +
      `Reply "balance" to check your balance.`
    );
  }
}
