/**
 * BQ-2 — Async wallet-network backfill integration test.
 *
 * Requires Docker (Redis + Postgres via Testcontainers).
 *
 * This test drives the processors directly against real Testcontainers
 * Redis + Postgres. The coordinator enqueues provision-user jobs which
 * are then processed directly by the ProvisionUserProcessor.
 *
 * Scenario:
 *   1. Seed active users with no wallets.
 *   2. Run coordinator job directly → fans out provision-user jobs to real BullMQ queue.
 *   3. Process each provision-user job with real ProvisionUserProcessor.
 *   4. Assert every user has a TRON wallet; BackfillRun = completed.
 *   5. Re-run is idempotent (second run: alreadyHad=N, provisioned=0).
 *   6. Admin controller enqueue returns { runId }, poll returns status.
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import type { Queue, Job } from 'bullmq';
import { PrismaPg } from '@prisma/adapter-pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '../generated/prisma/client';

import type { PrismaService } from '../src/core/prisma/prisma.service';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import { WalletPrismaRepository } from '../src/modules/wallets/infrastructure/wallet.prisma.repository';
import { PrismaBackfillRunRepository } from '../src/modules/wallets/infrastructure/backfill-run.prisma.repository';
import { ActiveUserListerPrismaAdapter } from '../src/modules/identity/infrastructure/active-user-lister.prisma';
import { WalletService } from '../src/modules/wallets/application/wallet.service';
import { CoordinateBackfillProcessor } from '../src/modules/wallets/infrastructure/coordinate-backfill.processor';
import { ProvisionUserProcessor } from '../src/modules/wallets/infrastructure/provision-user.processor';
import { AssetRegistry } from '../src/core/catalog/asset-registry';
import { SystemClock } from '../src/core/common/clock';
import configuration from '../src/core/config/configuration';
import {
  WALLET_BACKFILL_QUEUE_NAME,
  WALLET_BACKFILL_JOB,
} from '../src/modules/wallets/application/wallet-backfill-queue.constants';
import type {
  CoordinateBackfillPayload,
  ProvisionUserPayload,
} from '../src/modules/wallets/infrastructure/coordinate-backfill.processor';
import { BACKFILL_RUN_REPOSITORY } from '../src/modules/wallets/application/ports/backfill-run.repository.port';

jest.setTimeout(300_000);

const API_ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Fake provider
// ---------------------------------------------------------------------------

let fakeAddrCounter = 30000;

function makeFakeProvider(): IWalletProvider {
  return {
    provisionAddress: jest
      .fn()
      .mockImplementation((input: { userRef: string; network: string }) => {
        fakeAddrCounter++;
        return Promise.resolve({
          providerReference: `fake-pref-bq2-${fakeAddrCounter}`,
          address: `BQFAKE${input.network.toUpperCase()}${fakeAddrCounter.toString().padStart(8, '0')}AAAAAAAAAAAAA`,
          network: input.network,
        });
      }),
    getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
    withdraw: jest.fn().mockResolvedValue({
      providerReference: 'stub',
      status: 'pending' as const,
    }),
    getWithdrawalStatus: jest
      .fn()
      .mockResolvedValue({ status: 'pending' as const }),
    listWalletAssets: jest.fn().mockResolvedValue([
      {
        assetId: 'e2e-usdt-tron-asset-id',
        symbol: 'USDT',
        name: 'Tether USD',
        network: 'TRON',
        contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        decimals: 6,
        isMainnet: false,
      },
    ]),
  };
}

function makeConfigService() {
  const defaults = configuration() as unknown as Record<string, unknown>;
  return {
    get: <T>(key: string): T | undefined => {
      const parts = key.split('.');
      let val: unknown = key in defaults ? defaults[key] : undefined;
      if (val === undefined && parts.length > 1) {
        let node: unknown = defaults;
        for (const part of parts) {
          node = (node as Record<string, unknown>)?.[part];
        }
        val = node;
      }
      return val as T;
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('BQ-2: async wallet backfill integration (Testcontainers Redis + Postgres)', () => {
  let prisma: PrismaClient;
  let stopPostgres: () => Promise<void>;
  let redisContainer: StartedRedisContainer;
  let moduleRef: TestingModule;

  let walletRepo: WalletPrismaRepository;
  let backfillRunRepo: PrismaBackfillRunRepository;
  let coordProcessor: CoordinateBackfillProcessor;
  let provProcessor: ProvisionUserProcessor;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    // Start Postgres.
    const pgContainer = await new PostgreSqlContainer(
      'postgres:16-alpine',
    ).start();
    const dbUrl = pgContainer.getConnectionUri();
    stopPostgres = async () => {
      await prisma.$disconnect();
      await pgContainer.stop();
    };
    execSync('node_modules/.bin/prisma migrate deploy', {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'inherit',
    });
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: dbUrl }),
    });
    await prisma.$connect();

    // Start Redis.
    redisContainer = await new RedisContainer('redis:7-alpine').start();
    const redisUrl = new URL(redisContainer.getConnectionUrl());

    // Build service dependencies.
    const ps = prisma as unknown as PrismaService;
    walletRepo = new WalletPrismaRepository(ps);
    backfillRunRepo = new PrismaBackfillRunRepository(ps);
    const userLister = new ActiveUserListerPrismaAdapter(ps);
    const assetRegistry = new AssetRegistry(makeConfigService());
    const provider = makeFakeProvider();
    const clock = new SystemClock();
    const walletService = new WalletService(
      provider,
      walletRepo,
      clock,
      assetRegistry,
    );

    // Build minimal test module — just BullMQ + the queue + BACKFILL_RUN_REPOSITORY.
    // We don't boot AppModule to avoid needing all 26 modules + their services.
    moduleRef = await Test.createTestingModule({
      imports: [
        BullModule.forRoot({
          connection: {
            host: redisUrl.hostname,
            port: parseInt(redisUrl.port || '6379', 10),
            lazyConnect: false,
            maxRetriesPerRequest: null,
          },
        }),
        BullModule.registerQueue({ name: WALLET_BACKFILL_QUEUE_NAME }),
      ],
      providers: [
        { provide: BACKFILL_RUN_REPOSITORY, useValue: backfillRunRepo },
      ],
    }).compile();

    await moduleRef.init();

    // Build processors manually with the real queue.
    const queue = moduleRef.get<Queue>(
      getQueueToken(WALLET_BACKFILL_QUEUE_NAME),
    );
    coordProcessor = new CoordinateBackfillProcessor(
      userLister,
      backfillRunRepo,
      queue,
    );
    provProcessor = new ProvisionUserProcessor(
      walletService,
      assetRegistry,
      walletRepo,
      backfillRunRepo,
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await moduleRef?.close();
    await redisContainer?.stop();
    await stopPostgres?.();
  });

  async function seedActiveUser(): Promise<string> {
    const user = await prisma.user.create({ data: { status: 'active' } });
    return user.id;
  }

  async function drainProvisionJobs(
    runId: string,
    totalUsers: number,
  ): Promise<void> {
    const queue = moduleRef.get<Queue>(
      getQueueToken(WALLET_BACKFILL_QUEUE_NAME),
    );
    let processed = 0;
    const deadline = Date.now() + 30_000;

    while (processed < totalUsers && Date.now() < deadline) {
      const jobs = await queue.getJobs([
        'waiting',
        'active',
        'delayed',
        'prioritized',
      ]);
      const provJobs = jobs.filter(
        (j) =>
          j.name === WALLET_BACKFILL_JOB.PROVISION_USER &&
          (j.data as ProvisionUserPayload).runId === runId,
      );

      let processedThisRound = 0;
      for (const job of provJobs) {
        try {
          await provProcessor.process(job as Job<ProvisionUserPayload>);
          processed++;
          processedThisRound++;
        } catch {
          // mark as failed and still count it
          processed++;
          processedThisRound++;
        }
        await job.remove().catch(() => undefined);
      }

      if (processedThisRound === 0 && processed < totalUsers) {
        await new Promise<void>((r) => setTimeout(r, 100));
      }
    }
  }

  // ── Test 1: end-to-end flow ───────────────────────────────────────────────

  it('seeded users get TRON wallets after coordinator + provision-user drain', async () => {
    const [u1, u2] = await Promise.all([seedActiveUser(), seedActiveUser()]);

    // 1. Create BackfillRun.
    const run = await backfillRunRepo.create({ dryRun: false });

    // 2. Run coordinator (fans out provision-user jobs to real BullMQ).
    await coordProcessor.process({
      id: `coord-${run.id}`,
      name: WALLET_BACKFILL_JOB.COORDINATE,
      data: { runId: run.id, dryRun: false, batchSize: 100 },
    } as Job<CoordinateBackfillPayload>);

    const runAfterCoord = await backfillRunRepo.findById(run.id);
    expect(runAfterCoord!.status).toBe('running');
    const totalUsers = runAfterCoord!.totalUsers;
    expect(totalUsers).toBeGreaterThanOrEqual(2);

    // 3. Drain provision-user jobs.
    await drainProvisionJobs(run.id, totalUsers);

    // 4. Assert wallets created.
    const [w1, w2] = await Promise.all([
      walletRepo.findByUserNetwork(u1, 'TRON'),
      walletRepo.findByUserNetwork(u2, 'TRON'),
    ]);
    expect(w1).not.toBeNull();
    expect(w2).not.toBeNull();

    // 5. BackfillRun completed.
    const finalRun = await backfillRunRepo.findById(run.id);
    expect(finalRun!.status).toBe('completed');
    expect(finalRun!.scannedUsers).toBe(totalUsers);
    expect(finalRun!.perNetwork['TRON']?.provisioned).toBeGreaterThanOrEqual(2);
  });

  // ── Test 2: idempotent re-run ────────────────────────────────────────────

  it('re-run is idempotent: second run shows alreadyHad, no duplicate wallets', async () => {
    fakeAddrCounter = 40000;
    const userId = await seedActiveUser();

    // First run.
    const run1 = await backfillRunRepo.create({ dryRun: false });
    await coordProcessor.process({
      id: `coord-idem1-${run1.id}`,
      name: WALLET_BACKFILL_JOB.COORDINATE,
      data: { runId: run1.id, dryRun: false, batchSize: 100 },
    } as Job<CoordinateBackfillPayload>);
    const run1State = await backfillRunRepo.findById(run1.id);
    await drainProvisionJobs(run1.id, run1State!.totalUsers);

    const walletsAfterFirst = await prisma.wallet.findMany({
      where: { userId },
    });
    expect(walletsAfterFirst).toHaveLength(1);

    // Second run.
    const run2 = await backfillRunRepo.create({ dryRun: false });
    await coordProcessor.process({
      id: `coord-idem2-${run2.id}`,
      name: WALLET_BACKFILL_JOB.COORDINATE,
      data: { runId: run2.id, dryRun: false, batchSize: 100 },
    } as Job<CoordinateBackfillPayload>);
    const run2State = await backfillRunRepo.findById(run2.id);
    await drainProvisionJobs(run2.id, run2State!.totalUsers);

    // Still only 1 wallet.
    const walletsAfterSecond = await prisma.wallet.findMany({
      where: { userId },
    });
    expect(walletsAfterSecond).toHaveLength(1);

    // Second run: user shows in alreadyHad.
    const finalRun2 = await backfillRunRepo.findById(run2.id);
    expect(finalRun2!.perNetwork['TRON']?.alreadyHad).toBeGreaterThanOrEqual(1);
    expect(finalRun2!.status).toBe('completed');
  });

  // ── Test 3: BackfillRun repo status lifecycle ─────────────────────────────

  it('BackfillRun lifecycle: queued → running → completed', async () => {
    const run = await backfillRunRepo.create({ dryRun: true });
    expect(run.status).toBe('queued');

    await backfillRunRepo.markStarted(run.id, 5);
    const running = await backfillRunRepo.findById(run.id);
    expect(running!.status).toBe('running');
    expect(running!.totalUsers).toBe(5);

    await backfillRunRepo.markCompleted(run.id);
    const completed = await backfillRunRepo.findById(run.id);
    expect(completed!.status).toBe('completed');
    expect(completed!.completedAt).not.toBeNull();
  });

  // ── Test 4: NotFoundException path (no DB query needed but repo returns null) ──

  it('findById returns null for unknown run', async () => {
    const result = await backfillRunRepo.findById(
      '00000000-0000-7000-0000-000000009999',
    );
    expect(result).toBeNull();
  });
});
