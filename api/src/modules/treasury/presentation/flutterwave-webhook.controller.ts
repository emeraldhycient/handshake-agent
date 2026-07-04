/**
 * FlutterwaveWebhookController — receives Flutterwave v3 collection/payout
 * webhooks, persists them durably, and hands off to the async worker.
 *
 * Flow (CLAUDE.md §3.1 preserved — model proposes, engine disposes):
 *   1. Verify authenticity: PAYMENT_PROVIDER.verifyWebhookSignature(verif-hash),
 *      constant-time. Invalid → 401. No persistence.
 *   2. Persist raw payload + headers + signature (WebhookEvent, dedup on the
 *      Flutterwave event id) and enqueue processing (WebhookIngestionService).
 *   3. ACK 200 fast. Settlement runs asynchronously in FlutterwaveWebhookHandler
 *      (the worker) — idempotent, retry + dead-letter. A PERSISTENCE failure
 *      propagates (5xx) so Flutterwave redelivers.
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
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';

import {
  PAYMENT_PROVIDER,
  type IPaymentProvider,
} from '../application/ports/payment-provider.port';
import { WebhookIngestionService } from '../../webhooks/application/webhook-ingestion.service';

type AckResponse = { status: 'ok' };

// Provider machine-to-machine callback: authenticated by the verif-hash secret,
// not by IP. Exempt from the global IP-keyed throttler so a legitimate
// collection/payout settlement burst from Flutterwave is never 429'd (funds-safety
// — settlement must not be dropped). Forged calls are rejected fast (401). The
// payload shape lives on the worker (FlutterwaveWebhookHandler), which now parses
// it — the controller only persists + enqueues, so no body interface is needed here.
@Controller('webhooks')
@SkipThrottle()
export class FlutterwaveWebhookController {
  private readonly logger = new Logger(FlutterwaveWebhookController.name);

  constructor(
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: IPaymentProvider,
    private readonly ingestion: WebhookIngestionService,
  ) {}

  /**
   * POST /webhooks/flutterwave — verifies the `verif-hash` secret, then persists
   * + enqueues. The body is `unknown` (external source); the worker parses it.
   */
  @Post('flutterwave')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<AckResponse> {
    // ── Step 1: Authenticate ─────────────────────────────────────────────────
    const verifHash = req.headers['verif-hash'];
    if (!this.paymentProvider.verifyWebhookSignature(verifHash)) {
      this.logger.warn('Flutterwave webhook signature invalid — rejecting');
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    // ── Step 2: Persist + enqueue ────────────────────────────────────────────
    const rawBody: Buffer | string =
      (req as Request & { rawBody?: Buffer }).rawBody ?? JSON.stringify(body);
    const signature = typeof verifHash === 'string' ? verifHash : null;
    await this.ingestion.ingest({
      provider: 'flutterwave',
      parsedBody: body,
      rawBody,
      headers: req.headers ?? {},
      signature,
    });

    // ── Step 3: ACK ──────────────────────────────────────────────────────────
    return { status: 'ok' };
  }
}
