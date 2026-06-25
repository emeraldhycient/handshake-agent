/**
 * CLI entrypoint: async wallet-network backfill via BullMQ (BQ-2).
 *
 * Usage (after `pnpm --filter @handshake-agent/api build`):
 *   pnpm --filter @handshake-agent/api backfill:wallet-networks
 *
 * Requires: Redis (REDIS_URL env var, default redis://localhost:6379) and a
 * running worker process (pnpm --filter @handshake-agent/api start:worker).
 *
 * Environment variables:
 *   DRY_RUN    — 'true' for a report-only run (no wallets created).
 *                Highly recommended before the first live run on a new network.
 *   BATCH_SIZE — number of user IDs fetched per coordinator page (default 100).
 *   POLL_INTERVAL_MS — polling interval in ms while waiting for run completion
 *                      (default 2000).
 *
 * What the CLI does:
 *   1. Creates a BackfillRun record (status=queued) via the BackfillRun repo.
 *   2. Enqueues the `coordinate` job on the wallet-backfill BullMQ queue.
 *   3. Polls GET BackfillRun status until completed/failed.
 *   4. Prints the final report.
 *
 * Exit codes:
 *   0 — completed with zero failures
 *   1 — completed with one or more per-user failures
 *   2 — fatal error during startup or run failed
 *
 * Runbook: docs/runbooks/adding-assets-and-networks.md
 */

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import { AppModule } from '../app.module';
import {
  BACKFILL_RUN_REPOSITORY,
  type IBackfillRunRepository,
} from '../modules/wallets/application/ports/backfill-run.repository.port';
import {
  WALLET_BACKFILL_QUEUE_NAME,
  WALLET_BACKFILL_JOB,
} from '../modules/wallets/application/wallet-backfill-queue.constants';
import type { CoordinateBackfillPayload } from '../modules/wallets/infrastructure/coordinate-backfill.processor';
import type { BackfillRunRecord } from '../modules/wallets/application/ports/backfill-run.repository.port';

const logger = new Logger('BackfillCLI');

const POLL_INTERVAL_MS_DEFAULT = 2_000;

async function main(): Promise<void> {
  const dryRun = process.env['DRY_RUN'] === 'true';
  const batchSizeRaw = process.env['BATCH_SIZE'];
  const batchSize = batchSizeRaw ? parseInt(batchSizeRaw, 10) : 100;
  const pollIntervalMs = process.env['POLL_INTERVAL_MS']
    ? parseInt(process.env['POLL_INTERVAL_MS'], 10)
    : POLL_INTERVAL_MS_DEFAULT;

  if (isNaN(batchSize) || batchSize <= 0) {
    logger.error(
      `Invalid BATCH_SIZE="${batchSizeRaw}" — must be a positive integer.`,
    );
    process.exit(2);
  }

  logger.log(
    `Starting async wallet network backfill CLI (dryRun=${dryRun}, batchSize=${batchSize})`,
  );
  logger.log(
    `NOTE: Requires a running worker process (pnpm --filter @handshake-agent/api start:worker) and Redis.`,
  );

  // Boot NestJS application context — wires DI without starting the HTTP server.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const runRepo = app.get<IBackfillRunRepository>(BACKFILL_RUN_REPOSITORY);
  const backfillQueue = app.get<Queue>(
    getQueueToken(WALLET_BACKFILL_QUEUE_NAME),
  );

  let exitCode = 0;
  try {
    // 1. Create the BackfillRun record.
    const run = await runRepo.create({ dryRun });
    logger.log(`BackfillRun created: runId=${run.id}`);

    // 2. Enqueue the coordinator job.
    const payload: CoordinateBackfillPayload = {
      runId: run.id,
      dryRun,
      batchSize,
    };
    await backfillQueue.add(WALLET_BACKFILL_JOB.COORDINATE, payload, {
      jobId: `coordinate:${run.id}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
    });
    logger.log(
      `Coordinate job enqueued. Polling for completion (runId=${run.id}, interval=${pollIntervalMs}ms)...`,
    );

    // 3. Poll until completed or failed.
    const finalRun = await pollUntilDone(run.id, runRepo, pollIntervalMs);

    // 4. Print final report.
    printReport(finalRun, dryRun);

    if (finalRun.status === 'failed') {
      exitCode = 2;
    } else if (finalRun.failures.length > 0) {
      exitCode = 1;
    }
  } catch (err) {
    logger.error(
      `Fatal error during backfill: ${err instanceof Error ? err.message : String(err)}`,
    );
    exitCode = 2;
  } finally {
    await app.close();
  }

  process.exit(exitCode);
}

async function pollUntilDone(
  runId: string,
  repo: IBackfillRunRepository,
  intervalMs: number,
): Promise<BackfillRunRecord> {
  for (;;) {
    await new Promise<void>((r) => setTimeout(r, intervalMs));
    const run = await repo.findById(runId);
    if (!run) {
      throw new Error(`BackfillRun ${runId} not found during poll`);
    }
    if (run.status === 'completed' || run.status === 'failed') {
      return run;
    }
    logger.log(
      `  [poll] status=${run.status} scanned=${run.scannedUsers}/${run.totalUsers}`,
    );
  }
}

function printReport(run: BackfillRunRecord, dryRun: boolean): void {
  console.log('\n=== Wallet Network Backfill Report ===');
  console.log(`RunId       : ${run.id}`);
  console.log(`Status      : ${run.status}`);
  console.log(
    `Mode        : ${dryRun ? 'DRY RUN (no wallets created)' : 'LIVE'}`,
  );
  console.log(`Users scanned: ${run.scannedUsers} / ${run.totalUsers}`);
  console.log('\nPer-network breakdown:');
  for (const [network, tally] of Object.entries(run.perNetwork)) {
    console.log(
      `  ${network}: alreadyHad=${tally.alreadyHad}, provisioned=${tally.provisioned}`,
    );
  }
  if (run.failures.length > 0) {
    console.log(`\nFailures (${run.failures.length}):`);
    for (const failure of run.failures) {
      console.log(`  userId=${failure.userId}: ${failure.error}`);
    }
  } else {
    console.log('\nNo failures.');
  }
  console.log('======================================\n');
}

void main();
