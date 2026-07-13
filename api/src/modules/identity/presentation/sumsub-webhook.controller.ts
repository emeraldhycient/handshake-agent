/**
 * SumsubWebhookController — receives Sumsub `applicantReviewed` (and related)
 * webhooks, persists them durably, and hands off to the async worker
 * (SumsubWebhookHandler) that grants the reviewed KYC tier (task 3.6).
 *
 * Flow (CLAUDE.md §3.1 preserved — the model never grants a tier; only the
 * deterministic handler, running on a verified+persisted event, writes KYC
 * state):
 *   1. Verify authenticity: hex HMAC-SHA256 of the RAW request body, keyed by
 *      SUMSUB_WEBHOOK_SECRET, compared (constant-time) against the
 *      `x-payload-digest` header. Sumsub's algorithm header
 *      (`x-payload-digest-alg`) is assumed HMAC_SHA256_HEX — the only algorithm
 *      this endpoint verifies. Invalid/missing signature, or an unconfigured
 *      secret, → 401. No persistence, no state change.
 *   2. Persist the raw payload + headers + signature into WebhookEvent (dedup
 *      on sha256(rawBody) — the Sumsub payload we model carries no natural
 *      cross-event id) and enqueue processing (WebhookIngestionService).
 *   3. ACK 200 fast. The tier grant / status transition runs asynchronously in
 *      SumsubWebhookHandler — idempotent and no-downgrade, with retry +
 *      dead-letter. A PERSISTENCE failure propagates (5xx) so Sumsub
 *      redelivers (nothing durable was recorded).
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
import type { Env } from '../../../core/config/env.schema';
import { WebhookIngestionService } from '../../webhooks/application/webhook-ingestion.service';

type AckResponse = { status: 'ok' };

// Provider machine-to-machine callback: authenticated by HMAC signature, not by
// IP. Exempt from the global IP-keyed throttler (mirrors Blockradar/Flutterwave)
// so a legitimate burst of review webhooks is never 429'd. Forged calls are
// still rejected fast by verifySignature (401).
@Controller('webhooks')
@SkipThrottle()
export class SumsubWebhookController {
  private readonly logger = new Logger(SumsubWebhookController.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly ingestion: WebhookIngestionService,
  ) {
    this.webhookSecret = this.config.get('SUMSUB_WEBHOOK_SECRET', {
      infer: true,
    });
  }

  /**
   * POST /webhooks/sumsub
   *
   * The signature header `x-payload-digest` is a lowercase hex HMAC-SHA256 of
   * the raw body keyed by SUMSUB_WEBHOOK_SECRET (no prefix). The raw body
   * buffer comes from `req.rawBody` (main.ts `rawBody: true`). Unit tests may
   * pass the raw body directly as the second argument.
   */
  @Post('sumsub')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: unknown,
    @Req() req: Request | Buffer,
    @Headers('x-payload-digest') sigHeader?: string,
  ): Promise<AckResponse> {
    const rawBody: Buffer | undefined =
      req instanceof Buffer
        ? req
        : (req as Request & { rawBody?: Buffer }).rawBody;

    // ── Step 1: Authenticate ─────────────────────────────────────────────────
    if (!this.verifySignature(rawBody, sigHeader)) {
      this.logger.warn('Sumsub webhook signature invalid — rejecting');
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    // ── Step 2: Persist + enqueue (async processing) ─────────────────────────
    const headers =
      req instanceof Buffer ? {} : ((req as Request).headers ?? {});
    await this.ingestion.ingest({
      provider: 'sumsub',
      parsedBody: body,
      rawBody: rawBody ?? '',
      headers,
      signature: sigHeader ?? null,
    });

    // ── Step 3: ACK ──────────────────────────────────────────────────────────
    return { status: 'ok' };
  }

  /**
   * Verifies the hex HMAC-SHA256 `x-payload-digest` header (constant-time
   * comparison). Fails closed when the secret is unconfigured — an empty key
   * must never make the comparison trivially forgeable by anyone who can
   * compute HMAC('', body) themselves.
   */
  private verifySignature(
    rawBody: Buffer | undefined,
    sigHeader: string | undefined,
  ): boolean {
    if (!rawBody || !sigHeader) return false;
    if (sigHeader.length === 0) return false;
    if (!this.webhookSecret) return false;

    try {
      const expected = hmacHex('sha256', this.webhookSecret, rawBody);
      const expectedBuf = Buffer.from(expected, 'utf8');
      const receivedBuf = Buffer.from(sigHeader, 'utf8');
      if (expectedBuf.length !== receivedBuf.length) return false;
      return timingSafeEqual(expectedBuf, receivedBuf);
    } catch {
      return false;
    }
  }
}
