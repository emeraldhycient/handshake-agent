/**
 * WebhookProcessor — BullMQ consumer for the durable inbound-webhook queue.
 *
 * Lives in the WORKER graph only (WebhookWorkerModule → worker.ts), never in a
 * module reachable from AppModule — a @Processor opens a real ioredis Worker
 * connection, and keeping it out of the API process is what lets the e2e suites
 * run without Redis (see JobsModule notes).
 *
 * `process` delegates to WebhookProcessingService (dedup + lifecycle). BullMQ
 * owns the retry/backoff; `onFailed` fires on the FINAL exhausted attempt and
 * dead-letters the row (markDead) so it surfaces in the admin console.
 */
import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { WebhookProcessingService } from '../application/webhook-processing.service';
import {
  WEBHOOK_PROCESS_JOB,
  WEBHOOK_QUEUE_NAME,
  type ProcessWebhookPayload,
} from './webhook-queue.constants';

@Processor(WEBHOOK_QUEUE_NAME)
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private readonly processing: WebhookProcessingService) {
    super();
  }

  async process(job: Job<ProcessWebhookPayload>): Promise<void> {
    if (job.name !== WEBHOOK_PROCESS_JOB) return;
    await this.processing.process(job.data.webhookEventId);
  }

  /**
   * Fires on every failed attempt. Only the FINAL attempt dead-letters the row
   * — earlier failures are left for BullMQ to retry with backoff.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<ProcessWebhookPayload>, err: Error): Promise<void> {
    if (job.name !== WEBHOOK_PROCESS_JOB) return;
    const attempts = job.opts?.attempts ?? 1;
    if ((job.attemptsMade ?? 0) < attempts - 1) {
      // Not the final attempt — BullMQ will retry.
      return;
    }
    this.logger.warn(
      { jobId: job.id, webhookEventId: job.data?.webhookEventId },
      `webhook job exhausted retries: ${err.message}`,
    );
    await this.processing.handleExhausted(job.data.webhookEventId, err);
  }
}
