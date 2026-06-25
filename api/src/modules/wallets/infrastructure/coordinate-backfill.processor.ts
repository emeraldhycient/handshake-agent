/**
 * CoordinateBackfillProcessor — BullMQ processor for the `coordinate` job (BQ-2).
 *
 * Responsibility:
 *   1. Load the BackfillRun record.
 *   2. Page ALL active users (IUserLister port).
 *   3. Fan out one `provision-user` job per user (jobId = `${runId}:${userId}`
 *      for idempotent BullMQ deduplication).
 *   4. After paging complete → markStarted(totalUsers) → mark run `running`.
 *
 * Resilient: re-running the coordinator with the same run is safe because the
 * per-user jobId is deterministic — BullMQ ignores duplicates.
 *
 * Lives in WorkerModule (consumer side) — never imported by AppModule.
 */
import { Inject, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue, type Job } from 'bullmq';

import {
  USER_LISTER,
  type IUserLister,
} from '../application/ports/user-lister.port';
import {
  BACKFILL_RUN_REPOSITORY,
  type IBackfillRunRepository,
} from '../application/ports/backfill-run.repository.port';
import {
  WALLET_BACKFILL_QUEUE_NAME,
  WALLET_BACKFILL_JOB,
} from '../application/wallet-backfill-queue.constants';

export interface CoordinateBackfillPayload {
  runId: string;
  dryRun: boolean;
  batchSize: number;
}

export interface ProvisionUserPayload {
  runId: string;
  userId: string;
  dryRun: boolean;
}

@Processor(WALLET_BACKFILL_QUEUE_NAME)
export class CoordinateBackfillProcessor extends WorkerHost {
  private readonly logger = new Logger(CoordinateBackfillProcessor.name);

  constructor(
    @Inject(USER_LISTER) private readonly userLister: IUserLister,
    @Inject(BACKFILL_RUN_REPOSITORY)
    private readonly runRepo: IBackfillRunRepository,
    @InjectQueue(WALLET_BACKFILL_QUEUE_NAME)
    private readonly backfillQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === WALLET_BACKFILL_JOB.COORDINATE) {
      await this.processCoordinate(job as Job<CoordinateBackfillPayload>);
    }
    // provision-user jobs are handled by ProvisionUserProcessor (separate class,
    // same queue) — WorkerHost routes by job name.
  }

  private async processCoordinate(
    job: Job<CoordinateBackfillPayload>,
  ): Promise<void> {
    const { runId, dryRun, batchSize } = job.data;

    this.logger.log(
      `[coordinate] runId=${runId} dryRun=${dryRun} batchSize=${batchSize} — starting user page scan`,
    );

    let cursor: string | null = null;
    let totalUsers = 0;

    for (;;) {
      const page = await this.userLister.listActiveUserIds({
        cursor,
        limit: batchSize,
      });

      if (page.ids.length === 0) break;

      // Fan out one provision-user job per user with a deterministic jobId.
      const jobOpts = {
        attempts: 5,
        backoff: { type: 'exponential' as const, delay: 2_000 },
      };

      await Promise.all(
        page.ids.map((userId) =>
          this.backfillQueue.add(
            WALLET_BACKFILL_JOB.PROVISION_USER,
            { runId, userId, dryRun } satisfies ProvisionUserPayload,
            {
              ...jobOpts,
              // BullMQ v5+ rejects jobIds containing ':'. Use '__' as separator.
              jobId: `${runId}__${userId}`,
            },
          ),
        ),
      );

      totalUsers += page.ids.length;

      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    // Mark run as started with final totalUsers count.
    await this.runRepo.markStarted(runId, totalUsers);

    this.logger.log(
      `[coordinate] runId=${runId} — fanned out ${totalUsers} provision-user jobs`,
    );

    // Edge case: no active users → mark completed immediately.
    if (totalUsers === 0) {
      await this.runRepo.markCompleted(runId);
      this.logger.log(
        `[coordinate] runId=${runId} — no active users, marked completed`,
      );
    }
  }
}
