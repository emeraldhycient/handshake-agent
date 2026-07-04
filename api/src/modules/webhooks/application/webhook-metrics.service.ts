/**
 * WebhookMetricsService — queue-depth + failed/dead reads (requirement 5).
 *
 * Sourced from the durable WebhookEvent table (not live BullMQ counts) so the
 * reads work without Redis and are the audit-consistent source of truth. Feeds
 * the admin `GET /admin/webhooks/metrics` endpoint and, later, the metrics
 * dashboard.
 */
import { Inject, Injectable } from '@nestjs/common';

import { WEBHOOK_EVENT_STATUSES } from '../domain/webhook-provider';
import {
  WEBHOOK_EVENT_REPOSITORY,
  type IWebhookEventRepository,
} from './ports/webhook-event.repository.port';

export interface WebhookMetricsSnapshot {
  byStatus: Record<string, number>;
  /** received + processing — in-flight backlog. */
  depth: number;
  failed: number;
  dead: number;
}

@Injectable()
export class WebhookMetricsService {
  constructor(
    @Inject(WEBHOOK_EVENT_REPOSITORY)
    private readonly repo: IWebhookEventRepository,
  ) {}

  async snapshot(): Promise<WebhookMetricsSnapshot> {
    const raw = await this.repo.countByStatus();

    // Normalise: every known status present, defaulting to 0.
    const byStatus: Record<string, number> = {};
    for (const status of WEBHOOK_EVENT_STATUSES) {
      byStatus[status] = raw[status] ?? 0;
    }

    return {
      byStatus,
      depth: byStatus.received + byStatus.processing,
      failed: byStatus.failed,
      dead: byStatus.dead,
    };
  }
}
