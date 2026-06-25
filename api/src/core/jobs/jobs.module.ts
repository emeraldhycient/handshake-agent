/**
 * JobsModule — PRODUCER side of the BullMQ job-queue capability (BQ-1).
 *
 * This module is imported by AppModule and is the ONLY jobs-related module that
 * the API process (main.ts) ever sees.  It deliberately registers NO @Processor
 * providers — @Processor classes (consumers / workers) live in WorkerModule
 * (api/src/worker.module.ts) which is loaded ONLY by worker.ts.
 *
 * Separation rationale:
 *   @Processor decorators from @nestjs/bullmq register real BullMQ Worker
 *   instances that open their own persistent ioredis connections.  If those
 *   processors live in JobsModule (imported by AppModule), the API process also
 *   starts Workers — causing ECONNREFUSED spam in e2e suites that run without
 *   Redis and doubling the Worker connections in production.
 *
 * What this module registers:
 *   - BullModule.forRootAsync: shared ioredis connection (lazyConnect: true) so
 *     the app boots even with no Redis running — the existing e2e suites must
 *     keep passing with no Redis.
 *   - BullModule.registerQueue: the echo queue (minimal round-trip proof; real
 *     queues land in BQ-2).
 *   - BullMqJobQueueAdapter bound to the JOB_QUEUE port token — allows feature
 *     modules to enqueue jobs via the port without knowing about BullMQ.
 *
 * lazyConnect rationale:
 *   By default ioredis connects immediately on instantiation, which would block
 *   AppModule boot when Redis is absent. Setting `lazyConnect: true` defers the
 *   TCP connect until the first command is issued. The existing e2e suites
 *   never enqueue, so they never trigger a connection — they remain green.
 *
 *   BullMQ's RedisConnection handles the `wait` status from lazyConnect: when
 *   it sees `client.status === 'wait'` it calls `client.connect()` automatically.
 *   This means the actual TCP connection happens on first Queue/Worker use, not
 *   at module init time.
 *
 *   `maxRetriesPerRequest: null` is the BullMQ-recommended value — it tells
 *   ioredis to keep retrying a request until the connection is established rather
 *   than failing immediately. This is safe because BullMQ's own timeout / backoff
 *   logic wraps the operation. Do NOT set `enableOfflineQueue: false` here —
 *   that causes "Stream isn't writeable" errors when the ioredis client is in
 *   the `wait` state and BullMQ tries to issue its first command.
 *
 * Port binding:
 *   `{ provide: JOB_QUEUE, useClass: BullMqJobQueueAdapter }` makes the
 *   adapter injectable anywhere via `@Inject(JOB_QUEUE)`.  Unit tests swap in
 *   InMemoryJobQueueAdapter directly — no Nest wiring needed.
 *
 * Consumer / Swap seam (BQ-2 +):
 *   Add real queues by calling `BullModule.registerQueue({ name: 'my-queue' })`.
 *   Add the corresponding `@Processor('my-queue')` class to WorkerModule only.
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import type { Env } from '../config/env.schema';
import { JOB_QUEUE } from './application/job-queue.port';
import { BullMqJobQueueAdapter } from './infrastructure/bullmq-job-queue.adapter';
import { ECHO_QUEUE_NAME } from './echo-queue.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const redisUrl = config.get('REDIS_URL', { infer: true });
        const url = new URL(redisUrl);
        return {
          connection: {
            host: url.hostname,
            port: url.port ? parseInt(url.port, 10) : 6379,
            password: url.password || undefined,
            // CRITICAL: lazyConnect defers the TCP handshake until first use so
            // AppModule can boot without a live Redis instance. The existing e2e
            // suites never enqueue, so they never trigger a connection attempt.
            lazyConnect: true,
            // null = BullMQ-recommended: "retry until connected" (BullMQ handles
            // the operation-level timeout / backoff). Do NOT set to 0 here — that
            // causes the initial lazy-connect to throw "Stream isn't writeable".
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: ECHO_QUEUE_NAME }),
  ],
  // NO @Processor providers here — processors register BullMQ Workers which open
  // their own Redis connections.  Processors belong in WorkerModule (consumer side).
  providers: [{ provide: JOB_QUEUE, useClass: BullMqJobQueueAdapter }],
  exports: [JOB_QUEUE, BullModule],
})
export class JobsModule {}
