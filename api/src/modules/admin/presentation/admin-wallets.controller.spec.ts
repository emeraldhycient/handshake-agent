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
 *   6. POST /admin/wallets/reconcile: calls reconcileUser + returns results.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import type { BackfillRunStatusDto } from '@handshake-agent/contracts';
import { AdminWalletsController } from './admin-wallets.controller';
import { AdminTokenGuard } from '../guards/admin-token.guard';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import {
  BACKFILL_RUN_REPOSITORY,
  type IBackfillRunRepository,
  type BackfillRunRecord,
} from '../../wallets/application/ports/backfill-run.repository.port';
import { WALLET_BACKFILL_QUEUE_NAME } from '../../wallets/application/wallet-backfill-queue.constants';
import { WalletReconciliationService } from '../../wallets/application/wallet-reconciliation.service';
import type { AssetReconciliationResult } from '../../wallets/application/wallet-reconciliation.service';
import { EnqueueBackfillDto } from './dto/enqueue-backfill.dto';
import { ReconcileWalletDto } from './dto/reconcile-wallet.dto';
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

function makeReconciliationServiceMock(
  results: AssetReconciliationResult[] = [],
): Partial<WalletReconciliationService> {
  return {
    reconcileUser: jest.fn().mockResolvedValue(results),
  };
}

/**
 * Build a TestingModule with stubs for all BQ-2 + reconcile dependencies.
 */
async function buildModule(
  adminToken: string,
  runRepo: IBackfillRunRepository = makeRunRepo(),
  queue: Partial<Queue> = makeQueueMock(),
  reconciliationService: Partial<WalletReconciliationService> = makeReconciliationServiceMock(),
): Promise<{ controller: AdminWalletsController; module: TestingModule }> {
  const configStub: Partial<ConfigService<Env, true>> = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'ADMIN_API_TOKEN') return adminToken;
      return undefined;
    }) as ConfigService<Env, true>['get'],
  };

  // The controller is now gated by AdminSessionGuard + PermissionGuard (Task 11).
  // These tests exercise the handler methods directly, so the guards are stubbed
  // to allow-through; the guards themselves are unit-tested elsewhere.
  const allow = { canActivate: () => true };
  const module = await Test.createTestingModule({
    controllers: [AdminWalletsController],
    providers: [
      { provide: BACKFILL_RUN_REPOSITORY, useValue: runRepo },
      { provide: getQueueToken(WALLET_BACKFILL_QUEUE_NAME), useValue: queue },
      { provide: ConfigService, useValue: configStub },
      { provide: WalletReconciliationService, useValue: reconciliationService },
    ],
  })
    .overrideGuard(AdminSessionGuard)
    .useValue(allow)
    .overrideGuard(PermissionGuard)
    .useValue(allow)
    .compile();

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

describe('AdminWalletsController — POST /admin/wallets/reconcile', () => {
  const CREDITED_RESULT: AssetReconciliationResult = {
    asset: 'USDT',
    network: 'TRON',
    walletId: 'wallet-001',
    onChain: '2200',
    ledger: '200',
    delta: '2000',
    action: 'credited',
    deposited: true,
    receiptNumber: 'HS-2026-000001',
  };

  it('calls reconcileUser with the userId and returns results', async () => {
    const reconciliationService = makeReconciliationServiceMock([
      CREDITED_RESULT,
    ]);
    const { controller } = await buildModule(
      'any-token',
      undefined,
      undefined,
      reconciliationService,
    );

    const dto: ReconcileWalletDto = {
      userId: '00000000-0000-7000-0000-000000000001',
    };

    const result = await controller.reconcileWallet(dto);

    expect(reconciliationService.reconcileUser).toHaveBeenCalledWith(
      '00000000-0000-7000-0000-000000000001',
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      asset: 'USDT',
      action: 'credited',
      delta: '2000',
      receiptNumber: 'HS-2026-000001',
    });
  });

  it('returns an empty results array when no wallets need reconciliation', async () => {
    const reconciliationService = makeReconciliationServiceMock([]); // in-sync
    const { controller } = await buildModule(
      'any-token',
      undefined,
      undefined,
      reconciliationService,
    );

    const dto: ReconcileWalletDto = {
      userId: '00000000-0000-7000-0000-000000000002',
    };

    const result = await controller.reconcileWallet(dto);

    expect(result.results).toHaveLength(0);
  });
});
