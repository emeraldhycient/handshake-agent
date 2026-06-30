/**
 * WN-5 — Wallet network backfill integration test (Testcontainers Postgres).
 *
 * Scenario:
 *   1. Seed N active users — some with no wallets (simulating users who existed
 *      before any network was enabled / missed eager provisioning).
 *   2. Run WalletBackfillService.backfillMissingNetworkAddresses (live).
 *   3. Assert: every active user now has a TRON wallet.
 *   4. Re-run → idempotent (no duplicates, alreadyHad=N, provisioned=0).
 *   5. dryRun run → tallied correctly, no new rows.
 *   6. Inactive users are skipped.
 *   7. Per-user errors are isolated (batch continues).
 *
 * Note on "new network" scenario:
 *   The Prisma schema's Network enum only has TRON at launch (per WN-1 + ADR-0006).
 *   Adding a new network requires a schema migration (adds the enum value) THEN a
 *   backfill — the backfill is what WN-5 provides. This test validates the backfill
 *   against the live schema using TRON (users who missed eager provisioning is an
 *   equivalent and schema-safe test scenario). The runbook documents the full
 *   new-network flow including the migration step.
 *
 * Architecture: manual wiring (no full AppModule boot) — same pattern as other
 * e2e specs. WalletBackfillService is wired with:
 *   - ActiveUserListerPrismaAdapter (real identity infra, real DB)
 *   - WalletService with a fake IWalletProvider (no Blockradar calls)
 *   - WalletPrismaRepository (real wallet infra, real DB)
 *   - AssetRegistry using the real config defaults (TRON only at launch)
 *
 * Requires Docker.
 */

import { Logger } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { startTestPostgres } from './helpers/pg-testcontainer';

import type { PrismaService } from '../src/core/prisma/prisma.service';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';

import { WalletPrismaRepository } from '../src/modules/wallets/infrastructure/wallet.prisma.repository';
import { ActiveUserListerPrismaAdapter } from '../src/modules/identity/infrastructure/active-user-lister.prisma';
import { WalletService } from '../src/modules/wallets/application/wallet.service';
import { WalletBackfillService } from '../src/modules/wallets/application/wallet-backfill.service';
import { AssetRegistry } from '../src/core/catalog/asset-registry';
import { SystemClock } from '../src/core/common/clock';
import configuration from '../src/core/config/configuration';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Global counter so provider addresses never collide across tests/suites. */
let globalProviderCounter = 0;

function makeFakeWalletProvider(): IWalletProvider {
  return {
    provisionAddress: jest
      .fn()
      .mockImplementation((input: { userRef: string; network: string }) => {
        globalProviderCounter++;
        return Promise.resolve({
          providerReference: `fake-ref-${input.network}-${globalProviderCounter}`,
          address: `FAKE${input.network}${globalProviderCounter.toString().padStart(4, '0')}AAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
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
    listWalletAssets: jest.fn().mockResolvedValue([]),
  };
}

/** Config stub that uses the real JSON defaults (TRON at launch). */
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

describe('WN-5: WalletBackfillService (Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  let walletRepo: WalletPrismaRepository;
  let userLister: ActiveUserListerPrismaAdapter;
  let assetRegistry: AssetRegistry;

  // Suppress logger noise in test output
  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    ({ prisma, stop } = await startTestPostgres());

    const ps = prisma as unknown as PrismaService;
    walletRepo = new WalletPrismaRepository(ps);
    userLister = new ActiveUserListerPrismaAdapter(ps);
    assetRegistry = new AssetRegistry(makeConfigService() as never);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await stop?.();
  });

  /** Seed an active user (the status='active' filter in listActiveUserIds) */
  async function seedActiveUser(): Promise<string> {
    const user = await prisma.user.create({ data: { status: 'active' } });
    return user.id;
  }

  /** Seed an inactive user (should be skipped by the backfill) */
  async function seedInactiveUser(): Promise<string> {
    const user = await prisma.user.create({ data: { status: 'suspended' } });
    return user.id;
  }

  // ── Test 1: backfills users who missed eager provisioning ─────────────────

  it('provisions TRON wallets for users who missed eager provisioning', async () => {
    const provider = makeFakeWalletProvider();
    const walletService = new WalletService(
      provider,
      walletRepo,
      new SystemClock(),
      assetRegistry,
    );
    const backfillSvc = new WalletBackfillService(
      userLister,
      walletService,
      assetRegistry,
      walletRepo,
    );

    // Seed two users with no wallets (simulating missed eager provisioning)
    const userId1 = await seedActiveUser();
    const userId2 = await seedActiveUser();

    // Run backfill
    const report = await backfillSvc.backfillMissingNetworkAddresses({
      dryRun: false,
    });

    expect(report.failures).toHaveLength(0);
    expect(report.usersScanned).toBeGreaterThanOrEqual(2);

    // Both users now have TRON wallets
    const tron1 = await walletRepo.findByUserNetwork(userId1, 'TRON');
    const tron2 = await walletRepo.findByUserNetwork(userId2, 'TRON');
    expect(tron1).not.toBeNull();
    expect(tron2).not.toBeNull();
    expect(tron1?.network).toBe('TRON');
    expect(tron2?.network).toBe('TRON');
    // Per-network report shows provisioned
    expect(report.perNetwork['TRON']?.provisioned).toBeGreaterThanOrEqual(2);
  });

  // ── Test 2: re-run is idempotent ───────────────────────────────────────────

  it('re-running backfill on fully-provisioned users is idempotent (no duplicates)', async () => {
    const provider = makeFakeWalletProvider();
    const walletService = new WalletService(
      provider,
      walletRepo,
      new SystemClock(),
      assetRegistry,
    );
    const backfillSvc = new WalletBackfillService(
      userLister,
      walletService,
      assetRegistry,
      walletRepo,
    );

    // Seed a user already fully provisioned
    const userId = await seedActiveUser();
    globalProviderCounter++;
    await walletRepo.create({
      userId,
      network: 'TRON',
      address: `FAKETRON${globalProviderCounter.toString().padStart(4, '0')}AAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
      providerReference: `ref-idem-tron-${globalProviderCounter}`,
      status: 'active',
      provisionedAt: new Date(),
    });

    // Run once — this user should appear in alreadyHad
    const report1 = await backfillSvc.backfillMissingNetworkAddresses({
      dryRun: false,
    });
    expect(report1.failures).toHaveLength(0);

    // DB row count for this user must still be 1 (no duplicate)
    const wallets = await prisma.wallet.findMany({ where: { userId } });
    expect(wallets).toHaveLength(1);

    // Run again — still no duplicates
    const report2 = await backfillSvc.backfillMissingNetworkAddresses({
      dryRun: false,
    });
    expect(report2.failures).toHaveLength(0);
    const walletsAfterSecondRun = await prisma.wallet.findMany({
      where: { userId },
    });
    expect(walletsAfterSecondRun).toHaveLength(1);
    // Second run: this user's TRON counts in alreadyHad
    expect(report2.perNetwork['TRON']?.alreadyHad).toBeGreaterThanOrEqual(1);
  });

  // ── Test 3: dryRun does not create any rows ────────────────────────────────

  it('dryRun=true tallies missing wallets without creating any rows', async () => {
    const provider = makeFakeWalletProvider();
    const walletService = new WalletService(
      provider,
      walletRepo,
      new SystemClock(),
      assetRegistry,
    );
    const backfillSvc = new WalletBackfillService(
      userLister,
      walletService,
      assetRegistry,
      walletRepo,
    );

    // Seed a fresh user with no wallets
    const userId = await seedActiveUser();

    const walletsBefore = await prisma.wallet.findMany({ where: { userId } });
    expect(walletsBefore).toHaveLength(0);

    const report = await backfillSvc.backfillMissingNetworkAddresses({
      dryRun: true,
    });

    expect(report.failures).toHaveLength(0);
    // No rows created in dryRun mode
    const walletsAfter = await prisma.wallet.findMany({ where: { userId } });
    expect(walletsAfter).toHaveLength(0);
    // TRON should appear as "provisioned" (would-be) for this user
    expect(report.perNetwork['TRON']?.provisioned).toBeGreaterThanOrEqual(1);
  });

  // ── Test 4: inactive users are skipped ────────────────────────────────────

  it('skips inactive users (status != active)', async () => {
    const provider = makeFakeWalletProvider();
    const walletService = new WalletService(
      provider,
      walletRepo,
      new SystemClock(),
      assetRegistry,
    );
    const backfillSvc = new WalletBackfillService(
      userLister,
      walletService,
      assetRegistry,
      walletRepo,
    );

    const inactiveUserId = await seedInactiveUser();

    // The inactive user has no wallets before
    const walletsBefore = await prisma.wallet.findMany({
      where: { userId: inactiveUserId },
    });
    expect(walletsBefore).toHaveLength(0);

    await backfillSvc.backfillMissingNetworkAddresses({ dryRun: false });

    // Inactive user still has no wallets after backfill
    const walletsAfter = await prisma.wallet.findMany({
      where: { userId: inactiveUserId },
    });
    expect(walletsAfter).toHaveLength(0);
  });

  // ── Test 5: per-user error isolation ──────────────────────────────────────

  it('per-user errors are isolated — batch continues and failures tallied', async () => {
    // Use a failing provider that throws on every call
    const failingProvider: IWalletProvider = {
      provisionAddress: jest.fn().mockRejectedValue(new Error('Provider down')),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'stub',
        status: 'pending' as const,
      }),
      getWithdrawalStatus: jest
        .fn()
        .mockResolvedValue({ status: 'pending' as const }),
      listWalletAssets: jest.fn().mockResolvedValue([]),
    };
    const walletService = new WalletService(
      failingProvider,
      walletRepo,
      new SystemClock(),
      assetRegistry,
    );
    const backfillSvc = new WalletBackfillService(
      userLister,
      walletService,
      assetRegistry,
      walletRepo,
    );

    // Seed a fresh user with no wallets — this will cause a per-user failure
    const failUserId = await seedActiveUser();

    // The failing provider means the pre-existing walletRepo lookup for this
    // user will work (no TRON wallet), but provisionAllEnabledNetworks will fail.
    const report = await backfillSvc.backfillMissingNetworkAddresses({
      dryRun: false,
    });

    // Batch should complete without throwing
    // This user should be in failures
    const failure = report.failures.find((f) => f.userId === failUserId);
    expect(failure).toBeDefined();
    expect(failure?.error).toContain('Provider down');
  });
});
