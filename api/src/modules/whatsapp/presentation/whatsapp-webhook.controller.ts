import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { Env } from '../../../core/config/env.schema';
import { WebhookIngestionService } from '../../webhooks/application/webhook-ingestion.service';
import { WhatsAppSignatureGuard } from './guards/whatsapp-signature.guard';

/** Ack body returned for every POST. */
type AckResponse = { status: 'received' };

/** Query-string shape for the GET webhook handshake (dotted keys from Meta). */
type VerifyQuery = {
  'hub.mode': string;
  'hub.verify_token': string;
  'hub.challenge': string;
};

/**
 * Exposes the inbound WhatsApp webhook.
 *
 * GET  /whatsapp/webhook — Meta subscription-verification handshake.
 * POST /whatsapp/webhook — Inbound event receiver: the WhatsAppSignatureGuard
 *   authenticates (HMAC-SHA256), then the controller persists the raw payload +
 *   enqueues it (WebhookIngestionService) and ACKs 200 immediately. Processing —
 *   text/audio/image/document via WhatsAppInboundService — runs asynchronously in
 *   WhatsAppWebhookHandler (the worker), with retry + dead-letter. A persistence
 *   failure propagates (5xx) so Meta redelivers.
 */
@Controller('whatsapp')
export class WhatsAppWebhookController {
  constructor(
    private readonly configService: ConfigService<Env, true>,
    private readonly ingestion: WebhookIngestionService,
  ) {}

  /**
   * GET /whatsapp/webhook — Meta subscription verification. Returns the raw
   * `hub.challenge` when mode=subscribe and the verify token matches. An unset
   * token is a loud 403 (§3.6: no silent paths).
   */
  @Get('webhook')
  verify(@Query() query: VerifyQuery): string {
    const configuredToken = this.configService.get('WHATSAPP_VERIFY_TOKEN', {
      infer: true,
    });

    if (!configuredToken) {
      throw new ForbiddenException('Webhook verify token is not configured');
    }

    const {
      'hub.mode': mode,
      'hub.verify_token': token,
      'hub.challenge': challenge,
    } = query;

    if (mode === 'subscribe' && token === configuredToken) {
      return challenge;
    }

    throw new ForbiddenException('Webhook verification failed');
  }

  /**
   * POST /whatsapp/webhook — signature-guarded; persists + enqueues. The raw body
   * (needed for the durable record + dedup fallback) comes from `req.rawBody`
   * (main.ts `rawBody: true`). The `body` is `unknown` (external source); the
   * worker's handler validates it against WhatsAppInboundSchema.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WhatsAppSignatureGuard)
  async receive(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<AckResponse> {
    const rawBody: Buffer | string =
      (req as Request & { rawBody?: Buffer }).rawBody ?? JSON.stringify(body);
    const signature = req.headers['x-hub-signature-256'];

    await this.ingestion.ingest({
      provider: 'whatsapp',
      parsedBody: body,
      rawBody,
      headers: req.headers ?? {},
      signature: typeof signature === 'string' ? signature : null,
    });

    return { status: 'received' };
  }
}
