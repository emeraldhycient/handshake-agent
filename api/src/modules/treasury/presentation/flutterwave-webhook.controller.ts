/**
 * FlutterwaveWebhookController — receives Flutterwave v3 collection webhooks
 * and closes the buy loop (Task 6.4).
 *
 * Flow (CLAUDE.md §3.1 preserved — model proposes, engine disposes):
 *   1. Verify authenticity: PAYMENT_PROVIDER.verifyWebhookSignature (constant-time).
 *      Invalid → 401. No downstream processing.
 *   2. Parse body defensively. Route on event type:
 *      - charge.completed + data.status=successful + non-empty tx_ref
 *        → ExecutionService.settleBuyPayment({ reference: tx_ref })
 *      - transfer.completed + data.status=SUCCESSFUL|FAILED + non-empty data.reference
 *        → ExecutionService.settleSellPayout({ reference })
 *        (sell engine handles refund on FAILED internally via verifyPayout)
 *      - transfer.completed + unknown status → log + ack, no processing
 *      - LEGACY flat formats (no `event` key — e.g. real captured sandbox VA
 *        pay-ins): top-level camelCase `txRef` + `status='successful'`
 *        → settleBuyPayment({ reference: txRef }); top-level `reference` +
 *        `status=SUCCESSFUL|FAILED` → settleSellPayout({ reference }).
 *      - Anything else → 200 (ack; Flutterwave retries on non-2xx).
 *   3. Settlement methods RE-VERIFY via the provider server-side (§3.6;
 *      never trust the webhook body alone). Idempotent: duplicate delivery safe.
 *   4. If completed: resolve user's WhatsApp address (IdentityService) and
 *      send the receipt text via IWhatsAppSender.
 *   5. ALWAYS respond 200 quickly after kicking off processing.
 *      Downstream errors are caught + logged, never propagated (ack-then-process).
 *      Exception: 401 on signature failure.
 *
 * Acyclic module graph (brief §Wiring):
 *   FlutterwaveWebhookModule → TransactionsModule, WhatsAppSenderModule, IdentityModule
 *   None of those import this module → no cycle.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import {
  PAYMENT_PROVIDER,
  type IPaymentProvider,
} from '../application/ports/payment-provider.port';
import { ExecutionService } from '../../transactions/application/execution.service';
import { IdentityService } from '../../identity/application/identity.service';
import {
  WHATSAPP_SENDER,
  type IWhatsAppSender,
} from '../../whatsapp/application/ports/whatsapp-sender.port';

// ---------------------------------------------------------------------------
// Ack response (returned for every 200)
// ---------------------------------------------------------------------------

type AckResponse = { status: 'ok' };

// ---------------------------------------------------------------------------
// Flutterwave v3 webhook payload shape (defensive — parsed at runtime)
// ---------------------------------------------------------------------------

interface FlutterwaveWebhookBody {
  event?: unknown;
  data?: {
    status?: unknown;
    tx_ref?: unknown;
    /** Present on transfer.completed events — our idempotencyKey passed to createPayout. */
    reference?: unknown;
    [key: string]: unknown;
  };
  /**
   * Legacy flat collection format (real captured sandbox VA pay-in): the payload
   * has NO top-level `event`, the tx reference is camelCase `txRef` at the TOP
   * level, and `status` is top-level (e.g. "successful").
   */
  txRef?: unknown;
  /**
   * Legacy flat transfer/payout format: NO top-level `event`, the payout
   * idempotency key is top-level `reference`, `status` is top-level
   * (e.g. "SUCCESSFUL"/"FAILED").
   */
  reference?: unknown;
  /** Top-level status on a legacy flat payload (collection or transfer). */
  status?: unknown;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('webhooks')
export class FlutterwaveWebhookController {
  private readonly logger = new Logger(FlutterwaveWebhookController.name);

  constructor(
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: IPaymentProvider,
    private readonly executionService: ExecutionService,
    private readonly identityService: IdentityService,
    @Inject(WHATSAPP_SENDER)
    private readonly sender: IWhatsAppSender,
  ) {}

  /**
   * POST /webhooks/flutterwave
   *
   * Flutterwave calls this when a virtual-account collection completes.
   * We verify the secret hash, then delegate settlement to the execution engine.
   * The body is typed as `unknown` (external source) and we inspect it at runtime.
   */
  @Post('flutterwave')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<AckResponse> {
    // ── Step 1: Authenticate ─────────────────────────────────────────────────
    const verifHash = req.headers['verif-hash'];
    const isValid = this.paymentProvider.verifyWebhookSignature(verifHash);

    if (!isValid) {
      this.logger.warn('Flutterwave webhook signature invalid — rejecting');
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    // ── Step 2: Defensive parse ──────────────────────────────────────────────
    const payload = body as FlutterwaveWebhookBody;

    if (payload?.event === 'charge.completed') {
      return this.handleChargeCompleted(payload);
    }

    if (payload?.event === 'transfer.completed') {
      return this.handleTransferCompleted(payload);
    }

    // ── Step 3: Legacy flat formats (no top-level `event`) ───────────────────
    // Some Flutterwave deliveries (notably real captured sandbox virtual-account
    // pay-ins) arrive WITHOUT an `event` key, with the reference + status hoisted
    // to the top level. Recognize those only after the v3 routing above.
    if (payload?.event === undefined) {
      // Legacy collection: top-level camelCase `txRef` → buy settlement.
      if (typeof payload?.txRef === 'string') {
        return this.handleLegacyCollection(payload);
      }
      // Legacy transfer/payout: top-level `reference` → sell settlement.
      if (typeof payload?.reference === 'string') {
        return this.handleLegacyTransfer(payload);
      }
    }

    this.logger.log(
      { event: payload?.event },
      'Flutterwave webhook: unhandled event — acking without processing',
    );
    return { status: 'ok' };
  }

  // ---------------------------------------------------------------------------
  // Private event-routing handlers
  // ---------------------------------------------------------------------------

  /**
   * Handles event=charge.completed: verifies status=successful + non-empty tx_ref,
   * then delegates to settleBuyPayment.
   */
  private async handleChargeCompleted(
    payload: FlutterwaveWebhookBody,
  ): Promise<AckResponse> {
    const data = payload.data;

    if (data?.status !== 'successful') {
      this.logger.log(
        { status: data?.status },
        'Flutterwave webhook: charge not successful — acking without processing',
      );
      return { status: 'ok' };
    }

    const txRef = data?.tx_ref;
    if (typeof txRef !== 'string' || txRef.length === 0) {
      this.logger.warn(
        { data },
        'Flutterwave webhook: charge.completed missing tx_ref — acking without processing',
      );
      return { status: 'ok' };
    }

    // Ack-then-process: errors here must NOT change the 200.
    // Signature failure (step 1) is the ONLY path that returns non-200.
    await this.settleAndNotify(txRef);

    return { status: 'ok' };
  }

  /**
   * Handles event=transfer.completed: routes SUCCESSFUL/FAILED statuses to
   * settleSellPayout (which handles refund on failure internally via verifyPayout).
   * Unknown statuses are logged and acked without processing.
   */
  private async handleTransferCompleted(
    payload: FlutterwaveWebhookBody,
  ): Promise<AckResponse> {
    const data = payload.data;
    const status = data?.status;

    if (status !== 'SUCCESSFUL' && status !== 'FAILED') {
      this.logger.log(
        { status },
        'Flutterwave webhook: transfer.completed with unhandled status — acking without processing',
      );
      return { status: 'ok' };
    }

    const reference = data?.reference;
    if (typeof reference !== 'string' || reference.length === 0) {
      this.logger.warn(
        { data },
        'Flutterwave webhook: transfer.completed missing reference — acking without processing',
      );
      return { status: 'ok' };
    }

    // Ack-then-process: errors must NOT change the 200.
    await this.settleSellAndNotify(reference);

    return { status: 'ok' };
  }

  /**
   * Handles the LEGACY flat collection format (no `event`): top-level camelCase
   * `txRef` + top-level `status`. Treats status='successful' as a completed
   * collection and delegates to settleBuyPayment — mirroring handleChargeCompleted.
   */
  private async handleLegacyCollection(
    payload: FlutterwaveWebhookBody,
  ): Promise<AckResponse> {
    if (payload.status !== 'successful') {
      this.logger.log(
        { status: payload.status },
        'Flutterwave webhook: legacy collection not successful — acking without processing',
      );
      return { status: 'ok' };
    }

    const txRef = payload.txRef;
    if (typeof txRef !== 'string' || txRef.length === 0) {
      this.logger.warn(
        'Flutterwave webhook: legacy collection missing txRef — acking without processing',
      );
      return { status: 'ok' };
    }

    // Ack-then-process: errors here must NOT change the 200.
    await this.settleAndNotify(txRef);

    return { status: 'ok' };
  }

  /**
   * Handles the LEGACY flat transfer/payout format (no `event`): top-level
   * `reference` + top-level `status` (SUCCESSFUL/FAILED). Mirrors
   * handleTransferCompleted — the sell engine handles refund on FAILED internally.
   */
  private async handleLegacyTransfer(
    payload: FlutterwaveWebhookBody,
  ): Promise<AckResponse> {
    const status = payload.status;

    if (status !== 'SUCCESSFUL' && status !== 'FAILED') {
      this.logger.log(
        { status },
        'Flutterwave webhook: legacy transfer with unhandled status — acking without processing',
      );
      return { status: 'ok' };
    }

    const reference = payload.reference;
    if (typeof reference !== 'string' || reference.length === 0) {
      this.logger.warn(
        'Flutterwave webhook: legacy transfer missing reference — acking without processing',
      );
      return { status: 'ok' };
    }

    // Ack-then-process: errors must NOT change the 200.
    await this.settleSellAndNotify(reference);

    return { status: 'ok' };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Calls settleBuyPayment and — if completed — sends the WhatsApp receipt.
   * All errors are caught and logged so the ack-then-process invariant holds.
   */
  private async settleAndNotify(txRef: string): Promise<void> {
    try {
      const result = await this.executionService.settleBuyPayment({
        reference: txRef,
      });

      if (result.status !== 'completed') {
        this.logger.log(
          { txRef, status: result.status },
          'Flutterwave webhook: settlement pending — will process on retry',
        );
        return;
      }

      // Settlement confirmed — send receipt on WhatsApp.
      await this.sendReceipt(
        result.transactionId,
        result.userId,
        result.receiptNumber,
      );
    } catch (err: unknown) {
      this.logger.error(
        { err, txRef },
        'Flutterwave webhook: settlement threw — acking 200 anyway',
      );
    }
  }

  /**
   * Calls settleSellPayout and — if completed or failed — sends the WhatsApp
   * receipt/notice. The sell engine handles refund on FAILED status internally
   * (via verifyPayout), so we pass the reference regardless of webhook status.
   * All errors are caught and logged so the ack-then-process invariant holds.
   */
  private async settleSellAndNotify(reference: string): Promise<void> {
    try {
      const result = await this.executionService.settleSellPayout({
        reference,
      });

      if (result.status === 'pending') {
        this.logger.log(
          { reference, status: result.status },
          'Flutterwave webhook: sell settlement pending — will process on retry',
        );
        return;
      }

      // Settlement confirmed (completed or failed with refund) — send receipt.
      await this.sendReceipt(
        result.transactionId,
        result.userId,
        result.receiptNumber,
      );
    } catch (err: unknown) {
      this.logger.error(
        { err, reference },
        'Flutterwave webhook: sell settlement threw — acking 200 anyway',
      );
    }
  }

  /**
   * Resolves the user's WhatsApp address and sends the receipt text.
   * If the address is not found, logs a warning and skips the send.
   * Errors from sendText are caught and logged.
   */
  private async sendReceipt(
    transactionId: string,
    userId: string | undefined,
    receiptNumber: string | undefined,
  ): Promise<void> {
    if (!userId) {
      this.logger.warn(
        { transactionId },
        'Flutterwave webhook: completed settlement has no userId — skipping receipt',
      );
      return;
    }

    try {
      const waAddress = await this.identityService.findWhatsAppAddress(userId);

      if (!waAddress) {
        this.logger.warn(
          { userId, transactionId },
          'Flutterwave webhook: no WhatsApp address for user — skipping receipt',
        );
        return;
      }

      const receiptText = this.buildReceiptText(receiptNumber, transactionId);

      await this.sender.sendText(waAddress, receiptText);

      this.logger.log(
        { userId, transactionId, receiptNumber },
        'Flutterwave webhook: receipt sent on WhatsApp',
      );
    } catch (err: unknown) {
      this.logger.error(
        { err, userId, transactionId },
        'Flutterwave webhook: failed to send WhatsApp receipt — ignoring',
      );
    }
  }

  /**
   * Builds the plaintext receipt message sent to the user's WhatsApp.
   * Kept minimal — a richer template message can replace this in a follow-up.
   */
  private buildReceiptText(
    receiptNumber: string | undefined,
    transactionId: string,
  ): string {
    const ref = receiptNumber ?? transactionId;
    return (
      `✅ Your crypto purchase is complete!\n` +
      `Receipt: ${ref}\n` +
      `Your USDT has been credited to your Handshake wallet. ` +
      `Reply "balance" to check your balance.`
    );
  }
}
