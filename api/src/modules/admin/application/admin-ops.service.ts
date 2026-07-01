import { Inject, Injectable } from '@nestjs/common';

import type { OpsBoard } from '@handshake-agent/contracts';

import {
  OPS_READ_REPOSITORY,
  type IOpsReadRepository,
} from './ports/ops-read.repository.port';

/**
 * Phase 6b — READ-ONLY operational board for the "System / ops" operator screen:
 * the per-provider status board, the webhook-ingest queue depths + retries, and the
 * background-jobs / cron registry (schedule + last observed run + status).
 *
 * NEVER moves money (§3.1) and holds no Prisma import — it reaches data exclusively
 * through the injected OPS_READ_REPOSITORY port (§3.2). The only mapping it performs
 * is serializing each job's `lastRunAt` Date to an ISO string for the contract.
 */
@Injectable()
export class AdminOpsService {
  constructor(
    @Inject(OPS_READ_REPOSITORY)
    private readonly repo: IOpsReadRepository,
  ) {}

  /** The composite ops board — provider status, webhook queues, cron registry. */
  async board(): Promise<OpsBoard> {
    const result = await this.repo.board();

    return {
      providers: result.providers,
      webhookQueues: result.webhookQueues,
      jobs: result.jobs.map((job) => ({
        id: job.id,
        name: job.name,
        schedule: job.schedule,
        lastRunAt: job.lastRunAt === null ? null : job.lastRunAt.toISOString(),
        status: job.status,
        health: job.health,
      })),
    };
  }
}
