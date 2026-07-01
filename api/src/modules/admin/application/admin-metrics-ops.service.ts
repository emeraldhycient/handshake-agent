import { Inject, Injectable } from '@nestjs/common';

import type { MetricsOps } from '@handshake-agent/contracts';

import {
  METRICS_OPS_READ_REPOSITORY,
  type IMetricsOpsReadRepository,
} from './ports/metrics-ops-read.repository.port';

/** How many recent events the live-activity feed surfaces. */
const ACTIVITY_FEED_LIMIT = 12;

/**
 * Phase 6b — READ-ONLY operational-health metrics for the operator dashboard's
 * three still-mock panels: System health (per-provider dispatch status +
 * webhook-queue depth + recon drift), the Live-activity feed, and the Open
 * compliance-cases count.
 *
 * NEVER moves money (§3.1) and holds no Prisma import — it reaches data
 * exclusively through the injected METRICS_OPS_READ_REPOSITORY port (§3.2). The
 * only mapping it performs is serializing the activity `Date` to an ISO string
 * for the contract.
 */
@Injectable()
export class AdminMetricsOpsService {
  constructor(
    @Inject(METRICS_OPS_READ_REPOSITORY)
    private readonly repo: IMetricsOpsReadRepository,
  ) {}

  /** The composite ops payload — system health, activity feed, open-compliance count. */
  async ops(): Promise<MetricsOps> {
    const [systemHealth, activity, openCases] = await Promise.all([
      this.repo.systemHealth(),
      this.repo.activityFeed(ACTIVITY_FEED_LIMIT),
      this.repo.openComplianceCount(),
    ]);

    return {
      systemHealth,
      activityFeed: activity.map((event) => ({
        id: event.id,
        kind: event.kind,
        title: event.title,
        meta: event.meta,
        at: event.at.toISOString(),
      })),
      compliance: { openCases },
    };
  }
}
