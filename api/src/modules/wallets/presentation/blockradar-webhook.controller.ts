/**
 * BlockradarWebhookController — receives Blockradar deposit/withdraw/swap
 * webhooks, persists them durably, and hands off to the async worker.
 *
 * Flow (CLAUDE.md §3.1 preserved — no webhook body moves money directly):
 *   1. Verify authenticity: HMAC-SHA512 of the raw body keyed by BLOCKRADAR_API_KEY.
 *      Invalid → 401. No persistence.
 *   2. Persist the raw payload + headers + signature into WebhookEvent (dedup on
 *      the Blockradar event id) and enqueue processing (WebhookIngestionService).
 *   3. ACK 200 fast. Settlement runs asynchronously in BlockradarWebhookHandler
 *      (the worker) — idempotent, with retry + dead-letter. A PERSISTENCE failure
 *      propagates (5xx) so Blockradar redelivers (nothing durable was recorded).
 */

import { timingSafeEqual } from 'node:crypto';

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';

import { hmacHex } from '../../../core/crypto/hmac';
import { WebhookIngestionService } from '../../webhooks/application/webhook-ingestion.service';

type AckResponse = { status: 'ok' };

// Provider machine-to-machine callback: authenticated by HMAC signature, not by
// IP. Exempt from the global IP-keyed throttler so a legitimate deposit/settlement
// burst from Blockradar's egress IP is never 429'd (funds-safety — settlement must
// not be dropped). Forged calls are still rejected fast by verifySignature (401).
// The payload shape lives on the worker (BlockradarWebhookHandler), which now parses
// it — the controller only persists + enqueues, so no body interface is needed here.
@Controller('webhooks')
@SkipThrottle()
export class BlockradarWebhookController {
  private readonly logger = new Logger(BlockradarWebhookController.name);
  private readonly apiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly ingestion: WebhookIngestionService,
  ) {
    this.apiKey = this.config.get<string>('BLOCKRADAR_API_KEY') ?? '';
  }

  /**
   * POST /webhooks/blockradar
   *
   * The signature header `x-blockradar-signature` is a lowercase hex HMAC-SHA512
   * of the raw body keyed by BLOCKRADAR_API_KEY (no prefix). The raw body buffer
   * comes from `req.rawBody` (main.ts `rawBody: true`). Unit tests may pass the
   * raw body directly as the second argument.
   */
  @Post('blockradar')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: unknown,
    @Req() req: Request | Buffer,
    @Headers('x-blockradar-signature') sigHeader?: string,
  ): Promise<AckResponse> {
    const rawBody: Buffer | undefined =
      req instanceof Buffer
        ? req
        : (req as Request & { rawBody?: Buffer }).rawBody;

    // ── Step 1: Authenticate ─────────────────────────────────────────────────
    if (!this.verifySignature(rawBody, sigHeader)) {
      this.logger.warn('Blockradar webhook signature invalid — rejecting');
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    // ── Step 2: Persist + enqueue (async processing) ─────────────────────────
    const headers =
      req instanceof Buffer ? {} : ((req as Request).headers ?? {});
    await this.ingestion.ingest({
      provider: 'blockradar',
      parsedBody: body,
      rawBody: rawBody ?? '',
      headers: headers,
      signature: sigHeader ?? null,
    });

    // ── Step 3: ACK ──────────────────────────────────────────────────────────
    return { status: 'ok' };
  }

  /**
   * Verifies the HMAC-SHA512 signature header (constant-time comparison).
   * Blockradar sends the raw hex digest (no prefix).
   */
  private verifySignature(
    rawBody: Buffer | undefined,
    sigHeader: string | undefined,
  ): boolean {
    if (!rawBody || !sigHeader) return false;
    if (sigHeader.length === 0) return false;

    try {
      const expected = hmacHex('sha512', this.apiKey, rawBody);
      const expectedBuf = Buffer.from(expected, 'utf8');
      const receivedBuf = Buffer.from(sigHeader, 'utf8');
      if (expectedBuf.length !== receivedBuf.length) return false;
      return timingSafeEqual(expectedBuf, receivedBuf);
    } catch {
      return false;
    }
  }
}
