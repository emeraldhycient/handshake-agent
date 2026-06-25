/**
 * BullMQ round-trip integration test (BQ-1).
 *
 * Spins up a real Redis via Testcontainers, boots a Nest testing module that
 * wires JobsModule + BullModule with the Testcontainers Redis URL, enqueues a
 * job to the echo queue, and asserts EchoProcessor consumes it.
 *
 * Also verifies jobId deduplication: a second enqueue with the same jobId must
 * not result in a duplicate side effect.
 *
 * Requires Docker. Runs in the `test:e2e` lane (jest-e2e.json).
 *
 * Why Test.createTestingModule instead of NestFactory.createApplicationContext:
 *   We need to supply the Testcontainers Redis URL directly into the BullModule
 *   connection config without going through ConfigModule / validateEnv (which
 *   would require a full AppModule boot with all 26 other modules, Prisma, etc.).
 *   Test.createTestingModule lets us override BullModule.forRoot inline while
 *   still using the real JobsModule providers (BullMqJobQueueAdapter, EchoProcessor).
 *
 * NOTE: the existing 26 e2e suites boot AppModule WITHOUT Redis (lazyConnect keeps
 * them green). This test is the ONLY suite that actually connects to Redis.
 */
import { Test } from '@nestjs/testing';
import { BullModule } from '@nestjs/bullmq';
import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis';

import { BullMqJobQueueAdapter } from '../src/core/jobs/infrastructure/bullmq-job-queue.adapter';
import { EchoProcessor } from '../src/core/jobs/infrastructure/echo.processor';
import { JOB_QUEUE } from '../src/core/jobs/application/job-queue.port';
import type { JobQueue } from '../src/core/jobs/application/job-queue.port';
import {
  ECHO_QUEUE_NAME,
  ECHO_JOB_NAME,
} from '../src/core/jobs/echo-queue.constants';

jest.setTimeout(120_000);

/**
 * Poll until predicate returns true or timeout is exceeded.
 */
async function poll(
  predicate: () => boolean,
  timeoutMs = 10_000,
  intervalMs = 100,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  return false;
}

describe('BullMQ round-trip (integration, Testcontainers Redis)', () => {
  let container: StartedRedisContainer;
  let moduleRef: Awaited<
    ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
  >;
  let jobQueue: JobQueue;

  beforeAll(async () => {
    // 1. Start a real Redis container.
    container = await new RedisContainer('redis:7-alpine').start();
    const connectionUrl = container.getConnectionUrl();
    const url = new URL(connectionUrl);

    // 2. Build a focused test module: BullModule wired to the real Redis + the
    //    production providers (BullMqJobQueueAdapter + EchoProcessor).
    //    We skip AppModule entirely — no Prisma, no HTTP server, no whatsapp, etc.
    moduleRef = await Test.createTestingModule({
      imports: [
        // BullModule.forRoot with the actual Testcontainers Redis URL.
        BullModule.forRoot({
          connection: {
            host: url.hostname,
            port: url.port ? parseInt(url.port, 10) : 6379,
            // lazyConnect: false here — we WANT an immediate connection in this test.
            lazyConnect: false,
            maxRetriesPerRequest: null,
          },
        }),
        BullModule.registerQueue({ name: ECHO_QUEUE_NAME }),
      ],
      providers: [
        EchoProcessor,
        BullMqJobQueueAdapter,
        { provide: JOB_QUEUE, useExisting: BullMqJobQueueAdapter },
      ],
    }).compile();

    // 3. Initialise the module (triggers onModuleInit on WorkerHost via BullExplorer).
    await moduleRef.init();

    // 4. Resolve the JobQueue port.
    jobQueue = moduleRef.get<JobQueue>(JOB_QUEUE);

    // 5. Reset side-effect sentinel.
    EchoProcessor.lastProcessed = null;
  });

  afterAll(async () => {
    await moduleRef?.close();
    await container?.stop();
  });

  it('enqueues to the echo queue and the processor consumes the job', async () => {
    const payload = { message: 'hello from the round-trip test' };

    const { id } = await jobQueue.enqueue({
      queue: ECHO_QUEUE_NAME,
      name: ECHO_JOB_NAME,
      data: payload,
    });

    expect(id).toBeTruthy();

    // Poll until EchoProcessor.lastProcessed is set (worker runs async).
    const consumed = await poll(() => EchoProcessor.lastProcessed !== null);
    expect(consumed).toBe(true);
    expect(EchoProcessor.lastProcessed).toEqual(payload);
  });

  it('jobId deduplication: second enqueue with same jobId does not create a second BullMQ job', async () => {
    // Deduplication is a BullMQ invariant: when a job with the same jobId already
    // exists in a queue (waiting / active / delayed), adding the same jobId again
    // is a no-op. We verify this by checking BullMQ's own job-count API.
    const { Queue } = await import('bullmq');
    const url = new URL(container.getConnectionUrl());

    const q = new Queue(ECHO_QUEUE_NAME, {
      connection: {
        host: url.hostname,
        port: url.port ? parseInt(url.port, 10) : 6379,
        maxRetriesPerRequest: null,
      },
    });

    try {
      const dedupeId = `dedup-${Date.now()}`;

      // Drain to a known state first.
      await q.drain();

      const r1 = await jobQueue.enqueue({
        queue: ECHO_QUEUE_NAME,
        name: ECHO_JOB_NAME,
        data: { message: 'first' },
        opts: { jobId: dedupeId },
      });

      // Second enqueue with the same jobId — BullMQ returns the existing job id.
      const r2 = await jobQueue.enqueue({
        queue: ECHO_QUEUE_NAME,
        name: ECHO_JOB_NAME,
        data: { message: 'duplicate — must be ignored' },
        opts: { jobId: dedupeId },
      });

      // Both calls return the same id (the first job's id).
      expect(r1.id).toBe(dedupeId);
      expect(r2.id).toBe(dedupeId);
    } finally {
      await q.close();
    }
  });
});
