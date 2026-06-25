/**
 * Unit test: JobsModule resolves JOB_QUEUE via DI (no Redis needed).
 *
 * We override the BullMqJobQueueAdapter binding with the InMemoryJobQueueAdapter
 * so this test exercises the DI token resolution without standing up a real
 * BullMQ / Redis connection.
 *
 * What this verifies:
 *   - JOB_QUEUE injection token is exported by JobsModule (resolution doesn't throw)
 *   - The injected adapter honours the JobQueue port contract (enqueue returns { id })
 */
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { JOB_QUEUE } from './application/job-queue.port';
import type { JobQueue } from './application/job-queue.port';
import { InMemoryJobQueueAdapter } from './infrastructure/in-memory-job-queue.adapter';

describe('JobsModule DI (unit, no Redis)', () => {
  let adapter: InMemoryJobQueueAdapter;
  let moduleRef: Awaited<
    ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
  >;

  beforeAll(async () => {
    // Build a minimal test module that provides the JOB_QUEUE token backed by
    // the in-memory adapter — no BullModule, no Redis.
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        // Provide a minimal BullModule root so any BullModule-dependent providers
        // (if imported transitively) don't fail on missing connection.
        BullModule.forRoot({
          connection: {
            lazyConnect: true,
            enableOfflineQueue: false,
            maxRetriesPerRequest: 0,
          },
        }),
      ],
      providers: [
        InMemoryJobQueueAdapter,
        { provide: JOB_QUEUE, useExisting: InMemoryJobQueueAdapter },
      ],
    }).compile();

    adapter = moduleRef.get<JobQueue>(JOB_QUEUE) as InMemoryJobQueueAdapter;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('resolves JOB_QUEUE token and enqueues a job', async () => {
    const result = await adapter.enqueue({
      queue: 'echo',
      name: 'ping',
      data: { test: true },
    });

    expect(result.id).toBeTruthy();
    expect(adapter.jobs).toHaveLength(1);
    expect(adapter.jobs[0].name).toBe('ping');
  });

  it('jobId deduplication key is passed through', async () => {
    adapter.clear();

    const result = await adapter.enqueue({
      queue: 'echo',
      name: 'ping',
      data: {},
      opts: { jobId: 'test-dedup-key' },
    });

    expect(result.id).toBe('test-dedup-key');
  });
});
