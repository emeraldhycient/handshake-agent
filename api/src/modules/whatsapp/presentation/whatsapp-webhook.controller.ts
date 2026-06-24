import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WhatsAppInboundSchema,
  extractTextMessages,
} from '@handshake-agent/contracts';

import type { Env } from '../../../core/config/env.schema';
import { toInboundMessage } from '../application/whatsapp-inbound.mapper';
import {
  INBOUND_HANDLER,
  type IInboundHandler,
} from '../application/ports/inbound-handler.port';
import { WhatsAppSignatureGuard } from './guards/whatsapp-signature.guard';

/** Ack body returned for every POST (including failures). */
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
 * POST /whatsapp/webhook — Inbound event receiver; ALWAYS responds 200 (Meta
 *   retries on any non-2xx, so we ack immediately and catch handler errors).
 *
 * The controller depends on `IInboundHandler` via DI; Phase 2 binds the real
 * ConversationService; Phase 1.6 wires the module.
 */
@Controller('whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly configService: ConfigService<Env, true>,
    @Inject(INBOUND_HANDLER) private readonly handler: IInboundHandler,
  ) {}

  /**
   * GET /whatsapp/webhook
   *
   * Meta calls this once when the operator subscribes to the webhook. It
   * expects the raw `hub.challenge` value as plain-text in the body if both
   * conditions are met:
   *   - `hub.mode === 'subscribe'`
   *   - `hub.verify_token` equals the configured `WHATSAPP_VERIFY_TOKEN`
   *
   * If `WHATSAPP_VERIFY_TOKEN` is empty the operator hasn't finished setup —
   * we log a loud warning and respond 403 (§3.6: no silent paths).
   * Express 5 parses dotted query keys verbatim, so `req.query['hub.mode']`
   * works directly via `@Query('hub.mode')`.
   */
  @Get('webhook')
  verify(@Query() query: VerifyQuery): string {
    const configuredToken = this.configService.get('WHATSAPP_VERIFY_TOKEN', {
      infer: true,
    });

    if (!configuredToken) {
      this.logger.warn(
        'WHATSAPP_VERIFY_TOKEN is not set — webhook verification will always ' +
          'fail. Set the token in the environment before subscribing.',
      );
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
   * POST /whatsapp/webhook
   *
   * Receives inbound events from the WhatsApp Cloud API. The HMAC-SHA256
   * signature guard (`WhatsAppSignatureGuard`) authenticates the request.
   *
   * Ack-then-process: we always respond 200 quickly. Handler errors are caught
   * and logged rather than propagated — the conversation layer manages its own
   * failure handling. Non-parseable or non-message events (status-only) also
   * return 200 without invoking the handler.
   *
   * The `body` param is typed as `unknown` because it arrives from an external
   * source (Meta) before schema validation — `safeParse` enforces the shape.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WhatsAppSignatureGuard)
  async receive(@Body() body: any): Promise<AckResponse> {
    const parsed = WhatsAppInboundSchema.safeParse(body);

    if (!parsed.success) {
      this.logger.warn(
        { issues: parsed.error.issues },
        'Received a WhatsApp webhook payload that failed schema validation — ignoring',
      );
      return { status: 'received' };
    }

    const textMessages = extractTextMessages(parsed.data);

    for (const msg of textMessages) {
      const dto = toInboundMessage(msg);
      await this.handler.handleInbound(dto).catch((err: unknown) => {
        this.logger.error(
          { err, externalMessageId: dto.externalMessageId },
          'IInboundHandler.handleInbound threw — acking 200 anyway',
        );
      });
    }

    return { status: 'received' };
  }
}
