/**
 * SumsubWebhookController — receives Sumsub `applicantReviewed` (and related)
 * webhooks, persists them durably, and hands off to the async worker
 * (SumsubWebhookHandler) that grants the reviewed KYC tier (task 3.6).
 *
 * Flow (CLAUDE.md §3.1 preserved — the model never grants a tier; only the
 * deterministic handler, running on a verified+persisted event, writes KYC
 * state):
 *   1. Verify authenticity: hex HMAC of the RAW request body, keyed by
 *      SUMSUB_WEBHOOK_SECRET, compared (constant-time) against the
 *      `x-payload-digest` header. The HMAC algorithm is the one Sumsub names in
 *      the `x-payload-digest-alg` header (HMAC_SHA1_HEX / HMAC_SHA256_HEX /
 *      HMAC_SHA512_HEX — operator-selectable in the Sumsub dashboard), defaulting
 *      to SHA-256 when the header is absent. Invalid/missing signature, an
 *      unrecognized algorithm, or an unconfigured secret → 401. No persistence,
 *      no state change.
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

import { hmacHex, type HmacAlgo } from '../../../core/crypto/hmac';
import type { Env } from '../../../core/config/env.schema';
import { WebhookIngestionService } from '../../webhooks/application/webhook-ingestion.service';

type AckResponse = { status: 'ok' };

/**
 * Sumsub's `x-payload-digest-alg` header values → Node HMAC algorithm names.
 * The digest algorithm is chosen by the operator when generating the webhook
 * secret in the Sumsub dashboard (default HMAC_SHA256_HEX), so the endpoint must
 * verify against whichever one Sumsub actually signed with — hardcoding SHA-256
 * would silently 401 every webhook (and never grant a tier) under a SHA-1/SHA-512
 * configuration. An absent header defaults to SHA-256; an unrecognized value
 * fails closed (verification returns false → 401).
 */
const SUMSUB_DIGEST_ALG_BY_HEADER: Record<string, HmacAlgo> = {
  HMAC_SHA1_HEX: 'sha1',
  HMAC_SHA256_HEX: 'sha256',
  HMAC_SHA512_HEX: 'sha512',
};
const DEFAULT_SUMSUB_DIGEST_ALG: HmacAlgo = 'sha256';

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
    @Headers('x-payload-digest-alg') algHeader?: string,
  ): Promise<AckResponse> {
    const rawBody: Buffer | undefined =
      req instanceof Buffer
        ? req
        : (req as Request & { rawBody?: Buffer }).rawBody;

    // ── Step 1: Authenticate ─────────────────────────────────────────────────
    if (!this.verifySignature(rawBody, sigHeader, algHeader)) {
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
   * Verifies the hex `x-payload-digest` header (constant-time comparison),
   * keyed by SUMSUB_WEBHOOK_SECRET, using the HMAC algorithm named by
   * `x-payload-digest-alg` (defaulting to SHA-256 when absent). Fails closed
   * when: the secret is unconfigured (an empty key must never make the
   * comparison trivially forgeable by anyone who can compute HMAC('', body)),
   * or the alg header is present but unrecognized.
   */
  private verifySignature(
    rawBody: Buffer | undefined,
    sigHeader: string | undefined,
    algHeader: string | undefined,
  ): boolean {
    if (!rawBody || !sigHeader) return false;
    if (sigHeader.length === 0) return false;
    if (!this.webhookSecret) return false;

    const algo =
      algHeader === undefined
        ? DEFAULT_SUMSUB_DIGEST_ALG
        : SUMSUB_DIGEST_ALG_BY_HEADER[algHeader];
    // Unrecognized algorithm → fail closed (never fall back to a default that
    // could differ from what Sumsub signed with).
    if (!algo) return false;

    try {
      const expected = hmacHex(algo, this.webhookSecret, rawBody);
      const expectedBuf = Buffer.from(expected, 'utf8');
      const receivedBuf = Buffer.from(sigHeader, 'utf8');
      if (expectedBuf.length !== receivedBuf.length) return false;
      return timingSafeEqual(expectedBuf, receivedBuf);
    } catch {
      return false;
    }
  }
}
