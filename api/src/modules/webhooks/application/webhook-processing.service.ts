/**
 * WebhookProcessingService — the lifecycle orchestrator run by the worker.
 *
 * Given a persisted WebhookEvent id it: skips terminal rows (dedup on
 * re-delivery / double-enqueue, §3.1), claims the row (markProcessing), routes
 * to the provider handler, and records the outcome. A handler failure is
 * recorded (markFailed) AND re-thrown so BullMQ counts the attempt + schedules
 * exponential backoff; on final-attempt exhaustion the processor calls
 * `handleExhausted` → markDead (dead-letter).
 *
 * It moves NO money — the handler calls the existing idempotent engine paths.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';

import { TERMINAL_WEBHOOK_STATUSES } from '../domain/webhook-provider';
import {
  WEBHOOK_EVENT_REPOSITORY,
  type IWebhookEventRepository,
} from './ports/webhook-event.repository.port';
import {
  WEBHOOK_HANDLER_REGISTRY,
  type WebhookHandlerRegistry,
} from './ports/webhook-handler.port';

@Injectable()
export class WebhookProcessingService {
  private readonly logger = new Logger(WebhookProcessingService.name);

  constructor(
    @Inject(WEBHOOK_EVENT_REPOSITORY)
    private readonly repo: IWebhookEventRepository,
    @Inject(WEBHOOK_HANDLER_REGISTRY)
    private readonly handlers: WebhookHandlerRegistry,
  ) {}

  async process(webhookEventId: string): Promise<void> {
    const event = await this.repo.findById(webhookEventId);
    if (!event) {
      // The row was deleted, or the id is bogus — surface it so the job fails
      // visibly rather than silently succeeding.
      throw new Error(`webhook event not found: ${webhookEventId}`);
    }

    if (TERMINAL_WEBHOOK_STATUSES.has(event.status)) {
      // Already succeeded (or dead) — a re-delivery or double-enqueue. Do not
      // re-run the handler: that is the double-credit guard (§3.1).
      this.logger.log(
        { id: event.id, status: event.status },
        'webhook processing: terminal row — skipping',
      );
      return;
    }

    const handler = this.handlers.get(event.provider);
    if (!handler) {
      const message = `no handler for provider ${event.provider}`;
      await this.repo.markFailed(event.id, message);
      throw new Error(message);
    }

    await this.repo.markProcessing(event.id);

    try {
      await handler.handle(event);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repo.markFailed(event.id, message);
      // Re-throw so BullMQ registers the failed attempt + schedules backoff.
      throw err;
    }

    await this.repo.markSucceeded(event.id);
    this.logger.log(
      { id: event.id, provider: event.provider },
      'webhook processing: succeeded',
    );
  }

  /**
   * Called by the processor's final-attempt `failed` event — BullMQ has
   * exhausted its retries, so the row is dead-lettered for an admin replay.
   */
  async handleExhausted(webhookEventId: string, error: Error): Promise<void> {
    await this.repo.markDead(webhookEventId, error.message);
    this.logger.warn(
      { id: webhookEventId, error: error.message },
      'webhook processing: retries exhausted — dead-lettered',
    );
  }
}
