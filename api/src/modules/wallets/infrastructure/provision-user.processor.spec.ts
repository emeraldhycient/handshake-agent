/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/**
 * Unit tests for ProvisionUserProcessor (BQ-2).
 *
 * TDD: tests written first (red → green → refactor).
 *
 * Covers:
 *   1. dryRun=false: provisions wallets and increments counters.
 *   2. dryRun=true: tallies missing wallets without calling the provider.
 *   3. Error → throws so BullMQ retries.
 *   4. onFailed (final exhaustion): records in BackfillRun.failures + increments scannedUsers.
 *   5. markCompleted when scannedUsers === totalUsers after processing.
 *   6. Ignores jobs with a different name (coordinator jobs skip through).
 */

import type { Job } from 'bullmq';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import type {
  IWalletRepository,
  WalletRecord,
} from '../application/ports/wallet.repository.port';
import type {
  IBackfillRunRepository,
  BackfillRunRecord,
} from '../application/ports/backfill-run.repository.port';
import { WalletService } from '../application/wallet.service';
import { ProvisionUserProcessor } from './provision-user.processor';
import { WALLET_BACKFILL_JOB } from '../application/wallet-backfill-queue.constants';
import type { ProvisionUserPayload } from './coordinate-backfill.processor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAssetRegistry(): AssetRegistry {
  return {
    enabledNetworks: jest.fn().mockReturnValue(['TRON']),
  } as unknown as AssetRegistry;
}

function makeWalletRepo(
  existingWallet: WalletRecord | null = null,
): jest.Mocked<IWalletRepository> {
  return {
    findByUserNetwork: jest.fn().mockResolvedValue(existingWallet),
    findByAddress: jest.fn(),
    create: jest.fn(),
  };
}

function makeWalletService(failProvision = false): jest.Mocked<WalletService> {
  return {
    provisionAllEnabledNetworks: failProvision
      ? jest.fn().mockRejectedValue(new Error('Blockradar down'))
      : jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<WalletService>;
}

function makeRunRepo(
  runRecord: Partial<BackfillRunRecord> = {},
): jest.Mocked<IBackfillRunRepository> {
  const defaultRecord: BackfillRunRecord = {
    id: 'run-1',
    status: 'running',
    dryRun: false,
    totalUsers: 2,
    scannedUsers: 1,
    perNetwork: {},
    failures: [],
    createdAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
    ...runRecord,
  };
  return {
    create: jest.fn(),
    findById: jest.fn().mockResolvedValue(defaultRecord),
    markStarted: jest.fn().mockResolvedValue(undefined),
    incrementCounters: jest.fn().mockResolvedValue(undefined),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };
}

function makeJob(
  data: ProvisionUserPayload,
  overrides: Partial<Job> = {},
): Job<ProvisionUserPayload> {
  return {
    id: 'prov-job-1',
    name: WALLET_BACKFILL_JOB.PROVISION_USER,
    data,
    attemptsMade: 4,
    opts: { attempts: 5 },
    ...overrides,
  } as unknown as Job<ProvisionUserPayload>;
}

function makeProcessor(
  walletService: WalletService,
  assetRegistry: AssetRegistry,
  walletRepo: IWalletRepository,
  runRepo: IBackfillRunRepository,
): ProvisionUserProcessor {
  return new ProvisionUserProcessor(
    walletService,
    assetRegistry,
    walletRepo,
    runRepo,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const RUN_ID = 'run-1';
const USER_ID = 'user-42';

describe('ProvisionUserProcessor — process()', () => {
  it('live run: calls provisionAllEnabledNetworks and increments counters', async () => {
    const walletRepo = makeWalletRepo(null); // no existing wallet
    const walletService = makeWalletService(false);
    const assetRegistry = makeAssetRegistry();
    const runRepo = makeRunRepo({ scannedUsers: 1, totalUsers: 2 });

    const processor = makeProcessor(
      walletService,
      assetRegistry,
      walletRepo,
      runRepo,
    );
    const job = makeJob({ runId: RUN_ID, userId: USER_ID, dryRun: false });
    await processor.process(job);

    expect(walletService.provisionAllEnabledNetworks).toHaveBeenCalledWith(
      USER_ID,
    );
    expect(runRepo.incrementCounters).toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({
        scannedUsers: 1,
        perNetworkDelta: expect.objectContaining({
          TRON: expect.objectContaining({ provisioned: 1, alreadyHad: 0 }),
        }),
      }),
    );
  });

  it('live run: counts alreadyHad when wallet already exists', async () => {
    const existingWallet: WalletRecord = {
      id: 'w-1',
      userId: USER_ID,
      network: 'TRON',
      address: 'TRONADDR',
      providerReference: 'ref-1',
      status: 'active',
    };
    const walletRepo = makeWalletRepo(existingWallet);
    const walletService = makeWalletService(false);
    const assetRegistry = makeAssetRegistry();
    const runRepo = makeRunRepo({ scannedUsers: 1, totalUsers: 2 });

    const processor = makeProcessor(
      walletService,
      assetRegistry,
      walletRepo,
      runRepo,
    );
    const job = makeJob({ runId: RUN_ID, userId: USER_ID, dryRun: false });
    await processor.process(job);

    expect(runRepo.incrementCounters).toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({
        perNetworkDelta: expect.objectContaining({
          TRON: expect.objectContaining({ alreadyHad: 1, provisioned: 0 }),
        }),
      }),
    );
  });

  it('dryRun=true: tallies networks without calling the provider', async () => {
    const walletRepo = makeWalletRepo(null);
    const walletService = makeWalletService(false);
    const assetRegistry = makeAssetRegistry();
    const runRepo = makeRunRepo({ scannedUsers: 1, totalUsers: 2 });

    const processor = makeProcessor(
      walletService,
      assetRegistry,
      walletRepo,
      runRepo,
    );
    const job = makeJob({ runId: RUN_ID, userId: USER_ID, dryRun: true });
    await processor.process(job);

    expect(walletService.provisionAllEnabledNetworks).not.toHaveBeenCalled();
    expect(runRepo.incrementCounters).toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({
        scannedUsers: 1,
        perNetworkDelta: expect.objectContaining({
          TRON: expect.objectContaining({ provisioned: 1, alreadyHad: 0 }),
        }),
      }),
    );
  });

  it('error from provider: throws so BullMQ retries', async () => {
    const walletService = makeWalletService(true); // throws
    const walletRepo = makeWalletRepo(null);
    const assetRegistry = makeAssetRegistry();
    const runRepo = makeRunRepo();

    const processor = makeProcessor(
      walletService,
      assetRegistry,
      walletRepo,
      runRepo,
    );
    const job = makeJob({ runId: RUN_ID, userId: USER_ID, dryRun: false });

    await expect(processor.process(job)).rejects.toThrow('Blockradar down');
    // incrementCounters must NOT be called — job is retried.
    expect(runRepo.incrementCounters).not.toHaveBeenCalled();
  });

  it('marks run completed when scannedUsers === totalUsers after process', async () => {
    const walletRepo = makeWalletRepo(null);
    const walletService = makeWalletService(false);
    const assetRegistry = makeAssetRegistry();
    // After this job, scannedUsers becomes 2 === totalUsers 2.
    const runRepo = makeRunRepo({ scannedUsers: 2, totalUsers: 2 });

    const processor = makeProcessor(
      walletService,
      assetRegistry,
      walletRepo,
      runRepo,
    );
    const job = makeJob({ runId: RUN_ID, userId: USER_ID, dryRun: false });
    await processor.process(job);

    expect(runRepo.markCompleted).toHaveBeenCalledWith(RUN_ID);
  });

  it('does not call markCompleted when run is not yet done', async () => {
    const walletRepo = makeWalletRepo(null);
    const walletService = makeWalletService(false);
    const assetRegistry = makeAssetRegistry();
    // Only 1 of 5 users done.
    const runRepo = makeRunRepo({ scannedUsers: 1, totalUsers: 5 });

    const processor = makeProcessor(
      walletService,
      assetRegistry,
      walletRepo,
      runRepo,
    );
    const job = makeJob({ runId: RUN_ID, userId: USER_ID, dryRun: false });
    await processor.process(job);

    expect(runRepo.markCompleted).not.toHaveBeenCalled();
  });

  it('ignores jobs with a different name', async () => {
    const walletRepo = makeWalletRepo(null);
    const walletService = makeWalletService(false);
    const assetRegistry = makeAssetRegistry();
    const runRepo = makeRunRepo();

    const processor = makeProcessor(
      walletService,
      assetRegistry,
      walletRepo,
      runRepo,
    );
    const job = {
      id: 'coord-job',
      name: WALLET_BACKFILL_JOB.COORDINATE,
      data: { runId: RUN_ID, userId: USER_ID, dryRun: false },
    } as unknown as Job<ProvisionUserPayload>;

    await processor.process(job);
    expect(walletService.provisionAllEnabledNetworks).not.toHaveBeenCalled();
    expect(runRepo.incrementCounters).not.toHaveBeenCalled();
  });
});

describe('ProvisionUserProcessor — onFailed() (final exhaustion)', () => {
  it('records failure and increments scannedUsers after final attempt', async () => {
    const walletRepo = makeWalletRepo(null);
    const walletService = makeWalletService(true);
    const assetRegistry = makeAssetRegistry();
    const runRepo = makeRunRepo({ scannedUsers: 1, totalUsers: 2 });

    const processor = makeProcessor(
      walletService,
      assetRegistry,
      walletRepo,
      runRepo,
    );
    const err = new Error('Blockradar down');
    // attemptsMade = 4, attempts = 5 → this is attempt 5 (final, 0-indexed from 4).
    const job = makeJob(
      { runId: RUN_ID, userId: USER_ID, dryRun: false },
      { attemptsMade: 4, opts: { attempts: 5 } },
    );

    await processor.onFailed(job, err);

    expect(runRepo.incrementCounters).toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({
        scannedUsers: 1,
        failure: { userId: USER_ID, error: 'Blockradar down' },
      }),
    );
  });

  it('does NOT record failure on non-final attempts (BullMQ will retry)', async () => {
    const walletRepo = makeWalletRepo(null);
    const walletService = makeWalletService(true);
    const assetRegistry = makeAssetRegistry();
    const runRepo = makeRunRepo();

    const processor = makeProcessor(
      walletService,
      assetRegistry,
      walletRepo,
      runRepo,
    );
    const err = new Error('Transient error');
    // attemptsMade = 1, attempts = 5 → NOT the final attempt.
    const job = makeJob(
      { runId: RUN_ID, userId: USER_ID, dryRun: false },
      { attemptsMade: 1, opts: { attempts: 5 } },
    );

    await processor.onFailed(job, err);
    expect(runRepo.incrementCounters).not.toHaveBeenCalled();
  });

  it('ignores onFailed for non-provision-user job names', async () => {
    const walletRepo = makeWalletRepo(null);
    const walletService = makeWalletService(true);
    const assetRegistry = makeAssetRegistry();
    const runRepo = makeRunRepo();

    const processor = makeProcessor(
      walletService,
      assetRegistry,
      walletRepo,
      runRepo,
    );
    const err = new Error('err');
    const job = {
      name: WALLET_BACKFILL_JOB.COORDINATE,
      data: { runId: RUN_ID, userId: USER_ID, dryRun: false },
      attemptsMade: 4,
      opts: { attempts: 5 },
    } as unknown as Job<ProvisionUserPayload>;

    await processor.onFailed(job, err);
    expect(runRepo.incrementCounters).not.toHaveBeenCalled();
  });
});
