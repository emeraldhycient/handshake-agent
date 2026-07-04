/**
 * BullMqWebhookDispatchAdapter — production IWebhookDispatch backed by BullMQ.
 *
 * Thin: translates the port call into a Queue#add with the configured
 * exponential-backoff + attempts. All retry semantics live inside BullMQ; on
 * attempt exhaustion the WebhookProcessor marks the row `dead` (dead-letter).
 *
 * jobId = webhookEventId → a double-enqueue (sweeper + ingest, or an admin
 * retry racing a live job) dedups to a single in-flight job.
 */
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { WebhooksConfig } from '../../../core/config/configuration';
import type { IWebhookDispatch } from '../application/ports/webhook-dispatch.port';
import {
  WEBHOOK_PROCESS_JOB,
  WEBHOOK_QUEUE_NAME,
} from './webhook-queue.constants';

@Injectable()
export class BullMqWebhookDispatchAdapter implements IWebhookDispatch {
  constructor(
    @InjectQueue(WEBHOOK_QUEUE_NAME) private readonly queue: Queue,
    private readonly config: EffectiveConfigService,
  ) {}

  async enqueue(webhookEventId: string): Promise<void> {
    const cfg = this.config.get<WebhooksConfig>('webhooks');
    await this.queue.add(
      WEBHOOK_PROCESS_JOB,
      { webhookEventId },
      {
        jobId: webhookEventId,
        attempts: cfg.maxAttempts,
        backoff: { type: 'exponential', delay: cfg.backoffMs },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
