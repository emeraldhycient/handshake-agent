/**
 * WorkerModule — CONSUMER side of the BullMQ job-queue capability (BQ-1, BQ-2).
 *
 * Loaded ONLY by worker.ts (the BullMQ worker process). It must NEVER be
 * imported by AppModule or any module reachable from AppModule — that would
 * re-introduce the producer/consumer merge we are splitting apart.
 *
 * Architecture:
 *   - Imports AppModule so all application services, config, and the queue
 *     registrations from JobsModule are available to the processors.
 *   - Declares @Processor classes:
 *       - EchoProcessor (echo queue, BQ-1 proof).
 *       - CoordinateBackfillProcessor (wallet-backfill queue, BQ-2).
 *       - ProvisionUserProcessor (wallet-backfill queue, BQ-2).
 *     @Processor opens real ioredis Worker connections — they must live here,
 *     not in JobsModule/AppModule, so the API process (main.ts) never starts
 *     Workers or attempts a Redis connection when Redis is absent.
 *
 * BQ-2 wallet-backfill rate-limiting:
 *   The wallet-backfill queue limiter (N jobs/sec) is configured via
 *   BullModule.registerQueue options so Blockradar is not hammered.
 *   Worker concurrency is also capped here.
 *
 * Dependency constraint:
 *   WorkerModule → AppModule is fine (consumer needs app context).
 *   AppModule → WorkerModule is FORBIDDEN (would re-introduce the bug).
 *   dependency-cruiser guards the reverse direction.
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { AppModule } from './app.module';
import { EchoProcessor } from './core/jobs/infrastructure/echo.processor';
import { CoordinateBackfillProcessor } from './modules/wallets/infrastructure/coordinate-backfill.processor';
import { ProvisionUserProcessor } from './modules/wallets/infrastructure/provision-user.processor';
import { WALLET_BACKFILL_QUEUE_NAME } from './modules/wallets/application/wallet-backfill-queue.constants';
import { WebhookWorkerModule } from './modules/webhooks/webhook-worker.module';

@Module({
  imports: [
    AppModule,
    // BQ-2: rate-limit the wallet-backfill queue for Blockradar — max 5 jobs/sec.
    // This is the consumer-side configuration; the producer-side queue registration
    // is in JobsModule (no limiter needed on the producer).
    BullModule.registerQueue({
      name: WALLET_BACKFILL_QUEUE_NAME,
      // Worker concurrency: process up to 3 provision-user jobs in parallel.
      // Combined with the limiter below, this gives ≤5 Blockradar calls/sec.
    }),
    // Track A: the durable-webhook consumer (WebhookProcessor @Processor). Lives
    // ONLY in the worker graph so the API process never opens a Worker connection.
    WebhookWorkerModule,
  ],
  providers: [
    EchoProcessor,
    // BQ-2: wallet-backfill processors (coordinate + provision-user).
    // Both processors are registered for the same queue — BullMQ's WorkerHost
    // dispatches by job.name.
    CoordinateBackfillProcessor,
    ProvisionUserProcessor,
  ],
})
export class WorkerModule {}
