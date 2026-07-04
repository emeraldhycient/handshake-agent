/**
 * WhatsAppWebhookHandler — the async processing body for WhatsApp Cloud API
 * webhooks. Runs in the worker on a persisted WebhookEvent AFTER the controller's
 * WhatsAppSignatureGuard authenticated the request. Delegates to the existing
 * WhatsAppInboundService.ingest (text / audio / image / document).
 *
 * Dedup: a Meta RE-DELIVERY is caught at ingestion by the (provider,
 * providerEventId=wamid) unique constraint, so it never reaches this handler
 * twice. A schema-invalid payload is a genuine no-op ack. A processing EXCEPTION
 * (e.g. a transient LLM/agent failure) propagates so the worker retries with
 * backoff + dead-letters on exhaustion — a transient failure benefits from a
 * retry rather than silently dropping the user's message.
 */
import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppInboundSchema } from '@handshake-agent/contracts';

import { WhatsAppInboundService } from './whatsapp-inbound.service';
import type { WebhookHandler } from '../../webhooks/application/ports/webhook-handler.port';
import type { WebhookEventRecord } from '../../webhooks/application/ports/webhook-event.repository.port';

@Injectable()
export class WhatsAppWebhookHandler implements WebhookHandler {
  readonly provider = 'whatsapp';
  private readonly logger = new Logger(WhatsAppWebhookHandler.name);

  constructor(private readonly inboundService: WhatsAppInboundService) {}

  async handle(event: WebhookEventRecord): Promise<void> {
    const parsed = WhatsAppInboundSchema.safeParse(event.payload);

    if (!parsed.success) {
      // Non-message / status-only / malformed payloads are a genuine no-op ack —
      // do NOT throw (that would pointlessly retry a payload that can never parse).
      this.logger.warn(
        { issues: parsed.error.issues, id: event.id },
        'WhatsApp webhook: payload failed schema validation — acking without processing',
      );
      return;
    }

    // Let a processing failure propagate so the worker retries + dead-letters.
    await this.inboundService.ingest(parsed.data);
  }
}
