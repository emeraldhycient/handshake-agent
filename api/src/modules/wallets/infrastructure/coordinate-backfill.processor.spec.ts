/**
 * Unit tests for CoordinateBackfillProcessor (BQ-2).
 *
 * TDD: tests written first (red → green → refactor).
 *
 * Covers:
 *   1. Fans out one `provision-user` job per active user with dedup jobId.
 *   2. Sets totalUsers on the BackfillRun after paging.
 *   3. Edge case: zero active users → markCompleted immediately.
 *   4. Multi-page scan: all pages are processed.
 *   5. Re-enqueueing same run is idempotent (BullMQ dedup via jobId).
 */

import type { Job } from 'bullmq';
import type {
  IUserLister,
  ActiveUserPage,
} from '../application/ports/user-lister.port';
import type { IBackfillRunRepository } from '../application/ports/backfill-run.repository.port';
import {
  CoordinateBackfillProcessor,
  type CoordinateBackfillPayload,
} from './coordinate-backfill.processor';
import { WALLET_BACKFILL_JOB } from '../application/wallet-backfill-queue.constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserLister(pages: ActiveUserPage[]): IUserLister {
  let pageIndex = 0;
  return {
    listActiveUserIds: jest.fn().mockImplementation(() => {
      const page = pages[pageIndex] ?? { ids: [], nextCursor: null };
      pageIndex++;
      return Promise.resolve(page);
    }),
  };
}

function makeRunRepo(): jest.Mocked<IBackfillRunRepository> {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    markStarted: jest.fn().mockResolvedValue(undefined),
    incrementCounters: jest.fn().mockResolvedValue(undefined),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };
}

function makeQueue() {
  return {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

function makeJob(
  data: CoordinateBackfillPayload,
): Job<CoordinateBackfillPayload> {
  return {
    id: 'test-job',
    name: WALLET_BACKFILL_JOB.COORDINATE,
    data,
  } as unknown as Job<CoordinateBackfillPayload>;
}

function makeProcessor(
  userLister: IUserLister,
  runRepo: IBackfillRunRepository,
  queue: ReturnType<typeof makeQueue>,
) {
  // @InjectQueue uses the BullMQ DI token. In unit tests we instantiate directly.
  const processor = new CoordinateBackfillProcessor(
    userLister,
    runRepo,
    queue as unknown as import('bullmq').Queue,
  );
  return processor;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CoordinateBackfillProcessor', () => {
  const RUN_ID = 'run-123';

  it('fans out one provision-user job per active user with dedup jobId', async () => {
    const users = ['user-1', 'user-2', 'user-3'];
    const userLister = makeUserLister([{ ids: users, nextCursor: null }]);
    const runRepo = makeRunRepo();
    const queue = makeQueue();

    const processor = makeProcessor(userLister, runRepo, queue);
    const job = makeJob({ runId: RUN_ID, dryRun: false, batchSize: 10 });
    await processor.process(job);

    // One provision-user job per user.
    expect(queue.add).toHaveBeenCalledTimes(users.length);

    // Each job has the correct dedup jobId.
    for (const userId of users) {
      expect(queue.add).toHaveBeenCalledWith(
        WALLET_BACKFILL_JOB.PROVISION_USER,
        expect.objectContaining({ runId: RUN_ID, userId, dryRun: false }),
        expect.objectContaining({ jobId: `${RUN_ID}__${userId}` }),
      );
    }
  });

  it('marks run started with totalUsers count', async () => {
    const users = ['user-a', 'user-b'];
    const userLister = makeUserLister([{ ids: users, nextCursor: null }]);
    const runRepo = makeRunRepo();
    const queue = makeQueue();

    const processor = makeProcessor(userLister, runRepo, queue);
    await processor.process(
      makeJob({ runId: RUN_ID, dryRun: false, batchSize: 10 }),
    );

    expect(runRepo.markStarted).toHaveBeenCalledWith(RUN_ID, users.length);
  });

  it('marks run completed immediately when there are zero active users', async () => {
    const userLister = makeUserLister([{ ids: [], nextCursor: null }]);
    const runRepo = makeRunRepo();
    const queue = makeQueue();

    const processor = makeProcessor(userLister, runRepo, queue);
    await processor.process(
      makeJob({ runId: RUN_ID, dryRun: true, batchSize: 10 }),
    );

    expect(runRepo.markStarted).toHaveBeenCalledWith(RUN_ID, 0);
    expect(runRepo.markCompleted).toHaveBeenCalledWith(RUN_ID);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('processes multiple pages and fans out jobs for all users', async () => {
    const page1Users = ['u1', 'u2'];
    const page2Users = ['u3', 'u4'];
    const userLister = makeUserLister([
      { ids: page1Users, nextCursor: 'u2' },
      { ids: page2Users, nextCursor: null },
    ]);
    const runRepo = makeRunRepo();
    const queue = makeQueue();

    const processor = makeProcessor(userLister, runRepo, queue);
    await processor.process(
      makeJob({ runId: RUN_ID, dryRun: false, batchSize: 2 }),
    );

    expect(queue.add).toHaveBeenCalledTimes(
      page1Users.length + page2Users.length,
    );
    expect(runRepo.markStarted).toHaveBeenCalledWith(RUN_ID, 4);
  });

  it('ignores non-coordinate job names', async () => {
    const userLister = makeUserLister([]);
    const runRepo = makeRunRepo();
    const queue = makeQueue();

    const processor = makeProcessor(userLister, runRepo, queue);
    const job = {
      id: 'other',
      name: WALLET_BACKFILL_JOB.PROVISION_USER, // not coordinate
      data: { runId: RUN_ID, dryRun: false, batchSize: 10 },
    } as unknown as Job<CoordinateBackfillPayload>;

    // Should not throw and should not call userLister or runRepo.
    await processor.process(job);
    expect(userLister.listActiveUserIds).not.toHaveBeenCalled();
    expect(runRepo.markStarted).not.toHaveBeenCalled();
  });
});
