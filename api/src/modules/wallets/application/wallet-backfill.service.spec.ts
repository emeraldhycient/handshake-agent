/**
 * Unit tests for WalletBackfillService (WN-5).
 *
 * TDD: tests written first (red → green → refactor).
 *
 * All external dependencies are mocked:
 *   - USER_LISTER (IUserLister) — controls pagination
 *   - WalletService — controls per-user provisioning
 *   - AssetRegistry — controls enabledNetworks()
 *   - Logger — silenced to avoid noise
 *
 * Covers:
 *   1. Provisions missing wallets per user across pages.
 *   2. Idempotent: already-provisioned users tally as alreadyHad.
 *   3. dryRun: reports without provisioning.
 *   4. Per-user error isolation: failure logged + tallied; batch continues.
 *   5. Paging: all pages are consumed.
 */

import { Logger } from '@nestjs/common';
import type { IUserLister } from './ports/user-lister.port';
import type { WalletService } from './wallet.service';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { IWalletRepository } from './ports/wallet.repository.port';
import { WalletBackfillService } from './wallet-backfill.service';

// ---------------------------------------------------------------------------
// Stubs / factories
// ---------------------------------------------------------------------------

function makeUserLister(pages: string[][]): jest.Mocked<IUserLister> {
  let pageIndex = 0;
  return {
    listActiveUserIds: jest.fn().mockImplementation(() => {
      const ids = pages[pageIndex] ?? [];
      const isLast = pageIndex >= pages.length - 1;
      const nextCursor = isLast ? null : (ids[ids.length - 1] ?? null);
      pageIndex++;
      return Promise.resolve({ ids, nextCursor });
    }),
  };
}

function makeWalletService(): jest.Mocked<
  Pick<WalletService, 'provisionAllEnabledNetworks'>
> {
  return {
    provisionAllEnabledNetworks: jest.fn().mockImplementation(() => {
      // stub — returns an empty array; tallying done by the service internally
      return Promise.resolve([]);
    }),
  };
}

function makeAssetRegistry(
  networks: string[] = ['TRON'],
): jest.Mocked<Pick<AssetRegistry, 'enabledNetworks'>> {
  return {
    enabledNetworks: jest.fn().mockReturnValue(networks),
  };
}

function makeMinimalWalletRepo(
  findImpl?: jest.Mock,
): jest.Mocked<IWalletRepository> {
  return {
    findByUserNetwork: findImpl ?? jest.fn().mockResolvedValue(null),
    findByUser: jest.fn().mockResolvedValue([]),
    findByAddress: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(null),
  };
}

function makeService(
  userLister: jest.Mocked<IUserLister>,
  walletService: jest.Mocked<
    Pick<WalletService, 'provisionAllEnabledNetworks'>
  >,
  assetRegistry: jest.Mocked<Pick<AssetRegistry, 'enabledNetworks'>>,
  walletRepo?: jest.Mocked<IWalletRepository>,
): WalletBackfillService {
  // Silence logger in tests
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

  return new WalletBackfillService(
    userLister,
    walletService as unknown as WalletService,
    assetRegistry as unknown as AssetRegistry,
    walletRepo ?? makeMinimalWalletRepo(),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WalletBackfillService', () => {
  beforeEach(() => jest.restoreAllMocks());

  // ── 1. Live run: provisions missing wallets ────────────────────────────────

  it('calls provisionAllEnabledNetworks for each active user', async () => {
    const userIds = ['u-1', 'u-2', 'u-3'];
    const lister = makeUserLister([userIds, []]);
    const walletSvc = makeWalletService();
    const registry = makeAssetRegistry(['TRON']);
    const walletRepo = makeMinimalWalletRepo();

    const svc = makeService(lister, walletSvc, registry, walletRepo);
    const report = await svc.backfillMissingNetworkAddresses({ dryRun: false });

    expect(walletSvc.provisionAllEnabledNetworks).toHaveBeenCalledTimes(3);
    expect(walletSvc.provisionAllEnabledNetworks).toHaveBeenCalledWith('u-1');
    expect(walletSvc.provisionAllEnabledNetworks).toHaveBeenCalledWith('u-2');
    expect(walletSvc.provisionAllEnabledNetworks).toHaveBeenCalledWith('u-3');
    expect(report.usersScanned).toBe(3);
    expect(report.failures).toHaveLength(0);
  });

  // ── 2. Idempotent: already-provisioned users are tallied, not re-created ───

  it('dryRun=true reports missing networks without calling provisionAllEnabledNetworks', async () => {
    const userIds = ['u-10', 'u-11'];
    const lister = makeUserLister([userIds, []]);
    const walletSvc = makeWalletService();
    const registry = makeAssetRegistry(['TRON', 'ETH']);
    // u-10 already has TRON; u-11 has neither
    const walletRepo = makeMinimalWalletRepo(
      jest.fn().mockImplementation((userId: string, network: string) => {
        if (userId === 'u-10' && network === 'TRON')
          return Promise.resolve({ id: 'w-1', userId, network });
        return Promise.resolve(null);
      }),
    );

    const svc = makeService(lister, walletSvc, registry, walletRepo);
    const report = await svc.backfillMissingNetworkAddresses({ dryRun: true });

    // No provisioning calls in dry-run mode
    expect(walletSvc.provisionAllEnabledNetworks).not.toHaveBeenCalled();
    expect(report.usersScanned).toBe(2);
    // TRON: u-10 already had it → alreadyHad=1; u-11 missing → provisioned=1
    expect(report.perNetwork['TRON']?.alreadyHad).toBe(1);
    expect(report.perNetwork['TRON']?.provisioned).toBe(1);
    // ETH: both missing → provisioned=2
    expect(report.perNetwork['ETH']?.alreadyHad).toBe(0);
    expect(report.perNetwork['ETH']?.provisioned).toBe(2);
    expect(report.failures).toHaveLength(0);
  });

  // ── 3. Per-user error isolation ────────────────────────────────────────────

  it('isolates per-user errors: failed users are tallied in failures; batch continues', async () => {
    const lister = makeUserLister([['u-good', 'u-bad', 'u-good2'], []]);
    const walletSvc = makeWalletService();
    walletSvc.provisionAllEnabledNetworks.mockImplementation(
      (userId: string) => {
        if (userId === 'u-bad')
          return Promise.reject(new Error('Provider exploded'));
        return Promise.resolve([]);
      },
    );
    const registry = makeAssetRegistry(['TRON']);
    const walletRepo = makeMinimalWalletRepo();

    const svc = makeService(lister, walletSvc, registry, walletRepo);
    const report = await svc.backfillMissingNetworkAddresses({ dryRun: false });

    expect(report.usersScanned).toBe(3);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.userId).toBe('u-bad');
    expect(report.failures[0]?.error).toContain('Provider exploded');
    // Other users still processed
    expect(walletSvc.provisionAllEnabledNetworks).toHaveBeenCalledWith(
      'u-good',
    );
    expect(walletSvc.provisionAllEnabledNetworks).toHaveBeenCalledWith(
      'u-good2',
    );
  });

  // ── 4. Paging: consumes multiple pages ────────────────────────────────────

  it('pages through all users across multiple pages', async () => {
    const lister = makeUserLister([['u-p1a', 'u-p1b'], ['u-p2a'], []]);
    const walletSvc = makeWalletService();
    const registry = makeAssetRegistry(['TRON']);
    const walletRepo = makeMinimalWalletRepo();

    const svc = makeService(lister, walletSvc, registry, walletRepo);
    const report = await svc.backfillMissingNetworkAddresses({ dryRun: false });

    expect(report.usersScanned).toBe(3);
    expect(walletSvc.provisionAllEnabledNetworks).toHaveBeenCalledTimes(3);
    expect(lister.listActiveUserIds).toHaveBeenCalledTimes(3); // page1, page2, page3(empty)
  });

  // ── 5. Empty user base ────────────────────────────────────────────────────

  it('returns a zero report when there are no active users', async () => {
    const lister = makeUserLister([[]]);
    const walletSvc = makeWalletService();
    const registry = makeAssetRegistry(['TRON']);
    const walletRepo = makeMinimalWalletRepo();

    const svc = makeService(lister, walletSvc, registry, walletRepo);
    const report = await svc.backfillMissingNetworkAddresses({});

    expect(report.usersScanned).toBe(0);
    expect(report.failures).toHaveLength(0);
    expect(walletSvc.provisionAllEnabledNetworks).not.toHaveBeenCalled();
  });

  // ── 6. batchSize is passed to the lister ──────────────────────────────────

  it('passes batchSize to the user lister', async () => {
    const lister = makeUserLister([[]]);
    const walletSvc = makeWalletService();
    const registry = makeAssetRegistry(['TRON']);
    const walletRepo = makeMinimalWalletRepo();

    const svc = makeService(lister, walletSvc, registry, walletRepo);
    await svc.backfillMissingNetworkAddresses({ batchSize: 25 });

    expect(lister.listActiveUserIds).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25 }),
    );
  });

  // ── 7. Live run: perNetwork tallied from provisioning ─────────────────────

  it('tallies perNetwork correctly in live run (all missing → provisioned)', async () => {
    const lister = makeUserLister([['u-a', 'u-b'], []]);
    const walletSvc = makeWalletService();
    const registry = makeAssetRegistry(['TRON', 'ETH']);
    // No existing wallets → all will be provisioned
    const walletRepo = makeMinimalWalletRepo();

    const svc = makeService(lister, walletSvc, registry, walletRepo);
    const report = await svc.backfillMissingNetworkAddresses({ dryRun: false });

    // In live mode, provisioning is delegated to provisionAllEnabledNetworks;
    // the service inspects the repo to tally per-network.
    // Both users: no TRON/ETH before → provisioned=2 each
    expect(report.perNetwork['TRON']?.provisioned).toBe(2);
    expect(report.perNetwork['TRON']?.alreadyHad).toBe(0);
    expect(report.perNetwork['ETH']?.provisioned).toBe(2);
    expect(report.perNetwork['ETH']?.alreadyHad).toBe(0);
  });
});
