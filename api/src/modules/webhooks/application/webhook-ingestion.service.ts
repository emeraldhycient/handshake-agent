/**
 * WebhookIngestionService — the persist-first entry point for every inbound
 * provider webhook.
 *
 * Called by the (thin) provider controllers AFTER signature verification:
 *   1. derive the dedup key (provider event id, sha256 fallback),
 *   2. persist the raw payload/headers/signature durably (source of truth) —
 *      headers pass through sanitizeWebhookHeaders first so authentication
 *      material (verif-hash/authorization/…) is never persisted; replay never
 *      re-verifies (verification is done, pre-persist), so redaction is safe,
 *   3. best-effort enqueue a processing job (a Redis-down enqueue miss is
 *      recovered by the WebhookSweeper — persistence + the 2xx ACK never depend
 *      on Redis being up).
 *
 * It moves NO money and calls NO settlement (§3.1) — it only records intent and
 * hands off to the async worker.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  deriveWebhookEventId,
  type WebhookProvider,
} from '../domain/webhook-provider';
import {
  WEBHOOK_EVENT_REPOSITORY,
  type IWebhookEventRepository,
} from './ports/webhook-event.repository.port';
import {
  WEBHOOK_DISPATCH,
  type IWebhookDispatch,
} from './ports/webhook-dispatch.port';
import { sanitizeWebhookHeaders } from './sanitize-webhook-headers';

export interface IngestWebhookInput {
  provider: WebhookProvider;
  /** Parsed body (for the provider event id) — may be undefined for non-JSON. */
  parsedBody: unknown;
  /** Verbatim body bytes/string — stored + sha256 dedup fallback. */
  rawBody: Buffer | string;
  headers: Record<string, unknown>;
  signature?: string | null;
}

export interface IngestResult {
  id: string;
  duplicate: boolean;
}

@Injectable()
export class WebhookIngestionService {
  private readonly logger = new Logger(WebhookIngestionService.name);

  constructor(
    @Inject(WEBHOOK_EVENT_REPOSITORY)
    private readonly repo: IWebhookEventRepository,
    @Inject(WEBHOOK_DISPATCH)
    private readonly dispatch: IWebhookDispatch,
  ) {}

  async ingest(input: IngestWebhookInput): Promise<IngestResult> {
    const providerEventId = deriveWebhookEventId(
      input.provider,
      input.parsedBody,
      input.rawBody,
    );

    // Persist first. A throw here means nothing durable was recorded — let it
    // propagate so the controller returns 5xx and the provider redelivers.
    const { record, duplicate } = await this.repo.createIfNew({
      provider: input.provider,
      providerEventId,
      payload: this.toPayload(input),
      headers: sanitizeWebhookHeaders(input.headers),
      signature: input.signature ?? null,
    });

    if (duplicate) {
      // A re-delivery of an already-recorded event. The original row (and its
      // in-flight/terminal state) is authoritative — do not enqueue again.
      this.logger.log(
        { provider: input.provider, providerEventId, id: record.id },
        'webhook ingestion: duplicate delivery — skipping enqueue',
      );
      return { id: record.id, duplicate: true };
    }

    // Best-effort enqueue. The row is already durable; the sweeper re-enqueues
    // if this fails (Redis down), so a failure must never break the 2xx ACK.
    try {
      await this.dispatch.enqueue(record.id);
    } catch (err: unknown) {
      this.logger.error(
        { err, id: record.id, provider: input.provider },
        'webhook ingestion: enqueue failed — row persisted, sweeper will retry',
      );
    }

    return { id: record.id, duplicate: false };
  }

  /** Parsed JSON object as-is; a non-object/undefined body → `{ raw: string }`. */
  private toPayload(input: IngestWebhookInput): Record<string, unknown> {
    if (
      input.parsedBody !== null &&
      typeof input.parsedBody === 'object' &&
      !Array.isArray(input.parsedBody)
    ) {
      return input.parsedBody as Record<string, unknown>;
    }
    const raw =
      typeof input.rawBody === 'string'
        ? input.rawBody
        : input.rawBody.toString('utf8');
    return { raw };
  }
}
