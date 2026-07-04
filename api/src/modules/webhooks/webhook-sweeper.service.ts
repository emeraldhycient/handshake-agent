/**
 * WebhookSweeperService — the durability fallback for the webhook queue.
 *
 * On a cron tick it re-enqueues rows stuck in `received` past a grace window.
 * This recovers a Redis-down enqueue miss at ACK time (ingestion persists first,
 * then best-effort enqueues; if that throws, the row sits in `received` until a
 * sweep re-enqueues it). BullMQ's jobId=webhookEventId dedup means re-enqueuing a
 * row that already has an in-flight job is a no-op.
 *
 * It moves NO money (§3.1) — it only re-arms the worker.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { EffectiveConfigService } from '../../core/config/application/effective-config.service';
import type { WebhooksConfig } from '../../core/config/configuration';
import {
  WEBHOOK_EVENT_REPOSITORY,
  type IWebhookEventRepository,
} from './application/ports/webhook-event.repository.port';
import {
  WEBHOOK_DISPATCH,
  type IWebhookDispatch,
} from './application/ports/webhook-dispatch.port';

@Injectable()
export class WebhookSweeperService {
  private readonly logger = new Logger(WebhookSweeperService.name);
  private isRunning = false;

  constructor(
    @Inject(WEBHOOK_EVENT_REPOSITORY)
    private readonly repo: IWebhookEventRepository,
    @Inject(WEBHOOK_DISPATCH)
    private readonly dispatch: IWebhookDispatch,
    private readonly config: EffectiveConfigService,
  ) {}

  /**
   * Runs every 2 minutes. The interval is a fixed infra parameter — @Cron
   * decorators are evaluated at compile time and cannot read runtime config
   * (see SettlementReconciliationService for the same trade-off). The grace +
   * batch bounds ARE config-driven. Tests call tick() directly.
   */
  @Cron('*/2 * * * *', { name: 'webhook-sweeper' })
  async tick(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'webhook-sweeper: previous tick still running — skipping',
      );
      return;
    }
    this.isRunning = true;

    try {
      const cfg = this.config.get<WebhooksConfig>('webhooks');
      const stuck = await this.repo.findStuckReceived(
        cfg.sweepGracePeriodSec,
        cfg.sweepBatchSize,
      );

      if (stuck.length === 0) {
        this.logger.debug('webhook-sweeper: no stuck received rows');
        return;
      }

      this.logger.log(
        `webhook-sweeper: re-enqueuing ${stuck.length} stuck webhook(s)`,
      );

      for (const row of stuck) {
        try {
          await this.dispatch.enqueue(row.id);
        } catch (err: unknown) {
          this.logger.error(
            { err, id: row.id },
            'webhook-sweeper: re-enqueue failed — will retry next tick',
          );
          // Do NOT rethrow — one failing row must not abort the batch.
        }
      }
    } finally {
      this.isRunning = false;
    }
  }
}
