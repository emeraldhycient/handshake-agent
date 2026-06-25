/**
 * Unit tests for AdminWalletsController + AdminTokenGuard (WN-5, BQ-2).
 *
 * TDD: tests written first (red → green → refactor).
 *
 * Covers:
 *   1. Guard: ADMIN_API_TOKEN unset → 403 for every request.
 *   2. Guard: wrong token → 403.
 *   3. Guard: correct token → the guard permits.
 *   4. POST /admin/wallets/backfill-networks: enqueues run + returns { runId } (202).
 *   5. GET /admin/wallets/backfill-runs/:id: returns run status; 404 when not found.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import type { BackfillRunStatusDto } from '@handshake-agent/contracts';
import { AdminWalletsController } from './admin-wallets.controller';
import { AdminTokenGuard } from '../guards/admin-token.guard';
import {
  BACKFILL_RUN_REPOSITORY,
  type IBackfillRunRepository,
  type BackfillRunRecord,
} from '../../wallets/application/ports/backfill-run.repository.port';
import { WALLET_BACKFILL_QUEUE_NAME } from '../../wallets/application/wallet-backfill-queue.constants';
import { EnqueueBackfillDto } from './dto/enqueue-backfill.dto';
import type { Env } from '../../../core/config/env.schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_RUN_ID = '00000000-0000-7000-0000-000000000001';

const FAKE_RUN_RECORD: BackfillRunRecord = {
  id: FAKE_RUN_ID,
  status: 'queued',
  dryRun: false,
  totalUsers: 0,
  scannedUsers: 0,
  perNetwork: {},
  failures: [],
  createdAt: new Date('2026-06-25T10:00:00Z'),
  startedAt: null,
  completedAt: null,
};

function makeRunRepo(
  overrides: Partial<IBackfillRunRepository> = {},
): IBackfillRunRepository {
  return {
    create: jest.fn().mockResolvedValue(FAKE_RUN_RECORD),
    findById: jest.fn().mockResolvedValue(FAKE_RUN_RECORD),
    markStarted: jest.fn().mockResolvedValue(undefined),
    incrementCounters: jest.fn().mockResolvedValue(undefined),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeQueueMock(): Partial<Queue> {
  return {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };
}

/**
 * Build a TestingModule with stubs for all BQ-2 dependencies.
 */
async function buildModule(
  adminToken: string,
  runRepo: IBackfillRunRepository = makeRunRepo(),
  queue: Partial<Queue> = makeQueueMock(),
): Promise<{ controller: AdminWalletsController; module: TestingModule }> {
  const configStub: Partial<ConfigService<Env, true>> = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'ADMIN_API_TOKEN') return adminToken;
      return undefined;
    }) as ConfigService<Env, true>['get'],
  };

  const module = await Test.createTestingModule({
    controllers: [AdminWalletsController],
    providers: [
      { provide: BACKFILL_RUN_REPOSITORY, useValue: runRepo },
      { provide: getQueueToken(WALLET_BACKFILL_QUEUE_NAME), useValue: queue },
      { provide: ConfigService, useValue: configStub },
    ],
  }).compile();

  const controller = module.get(AdminWalletsController);
  return { controller, module };
}

// ---------------------------------------------------------------------------
// Helper: invoke the guard directly
// ---------------------------------------------------------------------------

function makeGuard(configuredToken: string): AdminTokenGuard {
  const configStub: Partial<ConfigService<Env, true>> = {
    get: jest.fn().mockReturnValue(configuredToken) as ConfigService<
      Env,
      true
    >['get'],
  };
  return new AdminTokenGuard(configStub as ConfigService<Env, true>);
}

function makeExecutionContext(authHeader?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authHeader ? { authorization: authHeader } : {},
      }),
    }),
  } as Parameters<AdminTokenGuard['canActivate']>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminTokenGuard', () => {
  it('denies all requests when ADMIN_API_TOKEN is not set (empty string)', () => {
    const guard = makeGuard('');
    expect(() => guard.canActivate(makeExecutionContext('Bearer any'))).toThrow(
      ForbiddenException,
    );
  });

  it('denies all requests when ADMIN_API_TOKEN is undefined', () => {
    const configStub: Partial<ConfigService<Env, true>> = {
      get: jest.fn().mockReturnValue(undefined) as ConfigService<
        Env,
        true
      >['get'],
    };
    const guard = new AdminTokenGuard(configStub as ConfigService<Env, true>);
    expect(() => guard.canActivate(makeExecutionContext('Bearer any'))).toThrow(
      ForbiddenException,
    );
  });

  it('denies when the supplied token is wrong', () => {
    const guard = makeGuard('correct-token-secret');
    expect(() =>
      guard.canActivate(makeExecutionContext('Bearer wrong-token')),
    ).toThrow(ForbiddenException);
  });

  it('denies when the Authorization header is missing entirely', () => {
    const guard = makeGuard('correct-token');
    expect(() => guard.canActivate(makeExecutionContext())).toThrow(
      ForbiddenException,
    );
  });

  it('denies when the Authorization header lacks Bearer prefix', () => {
    const guard = makeGuard('correct-token');
    expect(() =>
      guard.canActivate(makeExecutionContext('correct-token')),
    ).toThrow(ForbiddenException);
  });

  it('permits when the supplied token matches (constant-time)', () => {
    const guard = makeGuard('super-secret-admin-token');
    const ctx = makeExecutionContext('Bearer super-secret-admin-token');
    expect(guard.canActivate(ctx)).toBe(true);
  });
});

describe('AdminWalletsController — POST /admin/wallets/backfill-networks (BQ-2 async)', () => {
  it('creates a BackfillRun and enqueues the coordinate job, returning runId', async () => {
    const runRepo = makeRunRepo();
    const queue = makeQueueMock();
    const { controller } = await buildModule('any-token', runRepo, queue);

    const dto: EnqueueBackfillDto = { dryRun: false, batchSize: 50 };
    const result = await controller.backfillNetworks(dto);

    expect(runRepo.create).toHaveBeenCalledWith({ dryRun: false });
    expect(queue.add).toHaveBeenCalledWith(
      'coordinate',
      expect.objectContaining({
        runId: FAKE_RUN_ID,
        dryRun: false,
        batchSize: 50,
      }),
      expect.objectContaining({ jobId: `coordinate:${FAKE_RUN_ID}` }),
    );
    expect(result).toEqual({ runId: FAKE_RUN_ID });
  });

  it('defaults dryRun=false and batchSize=100 when DTO fields are absent', async () => {
    const runRepo = makeRunRepo();
    const queue = makeQueueMock();
    const { controller } = await buildModule('any-token', runRepo, queue);

    const dto: EnqueueBackfillDto = {};
    await controller.backfillNetworks(dto);

    expect(runRepo.create).toHaveBeenCalledWith({ dryRun: false });
    expect(queue.add).toHaveBeenCalledWith(
      'coordinate',
      expect.objectContaining({ batchSize: 100 }),
      expect.any(Object),
    );
  });
});

describe('AdminWalletsController — GET /admin/wallets/backfill-runs/:id (BQ-2)', () => {
  it('returns the BackfillRun status DTO', async () => {
    const runRepo = makeRunRepo({
      findById: jest.fn().mockResolvedValue({
        ...FAKE_RUN_RECORD,
        status: 'running',
        totalUsers: 10,
        scannedUsers: 3,
      }),
    });
    const { controller } = await buildModule('any-token', runRepo);

    const result: BackfillRunStatusDto =
      await controller.getBackfillRun(FAKE_RUN_ID);

    expect(runRepo.findById).toHaveBeenCalledWith(FAKE_RUN_ID);
    expect(result.id).toBe(FAKE_RUN_ID);
    expect(result.status).toBe('running');
    expect(result.totalUsers).toBe(10);
    expect(result.scannedUsers).toBe(3);
  });

  it('throws NotFoundException when the run does not exist', async () => {
    const runRepo = makeRunRepo({
      findById: jest.fn().mockResolvedValue(null),
    });
    const { controller } = await buildModule('any-token', runRepo);

    await expect(controller.getBackfillRun('nonexistent-id')).rejects.toThrow(
      NotFoundException,
    );
  });
});
