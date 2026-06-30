/**
 * Unit tests for CatalogSyncService.
 *
 * TDD: tests written before the implementation to drive the design.
 *
 * Verifies:
 *   - onModuleInit calls refresh()
 *   - refresh() calls listWalletAssets for each enabled network's master wallet
 *   - discovered assets are merged into AssetRegistry
 *   - provider errors are caught and swallowed (resilient — never crashes boot)
 *   - missing master wallet id skips the network gracefully
 *
 * No Nest DI container — all dependencies are hand-stubbed.
 */

import { CatalogSyncService } from './catalog-sync.service';
import type { AssetRegistry } from './asset-registry';
import type {
  IWalletProvider,
  DiscoveredAsset,
} from '../../modules/wallets/application/ports/wallet-provider.port';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TRON_MASTER_WALLET = 'tron-master-wallet-uuid';

const DISCOVERED_USDT: DiscoveredAsset = {
  assetId: 'runtime-usdt-asset-id-abc',
  symbol: 'USDT',
  name: 'Tether USD',
  network: 'TRON',
  contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  decimals: 6,
  isMainnet: false,
};

const DISCOVERED_TRX: DiscoveredAsset = {
  assetId: 'runtime-trx-asset-id-def',
  symbol: 'TRX',
  name: 'TRON',
  network: 'TRON',
  contractAddress: null,
  decimals: 6,
  isMainnet: false,
};

function makeRegistry(
  opts: {
    networks?: string[];
    masterWalletIdFn?: (id: string) => string;
  } = {},
): jest.Mocked<AssetRegistry> {
  const networks = opts.networks ?? ['TRON'];
  const masterWalletIdFn =
    opts.masterWalletIdFn ??
    ((id: string) => {
      if (id === 'TRON') return TRON_MASTER_WALLET;
      throw new Error(`No master wallet id for network "${id}"`);
    });

  return {
    enabledNetworks: jest.fn().mockReturnValue(networks),
    networkMasterWalletId: jest.fn().mockImplementation(masterWalletIdFn),
    mergeDiscoveredAssets: jest.fn(),
  } as unknown as jest.Mocked<AssetRegistry>;
}

function makeProvider(
  assets: DiscoveredAsset[] = [DISCOVERED_USDT, DISCOVERED_TRX],
): jest.Mocked<IWalletProvider> {
  return {
    listWalletAssets: jest.fn().mockResolvedValue(assets),
  } as unknown as jest.Mocked<IWalletProvider>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CatalogSyncService', () => {
  let registry: jest.Mocked<AssetRegistry>;
  let provider: jest.Mocked<IWalletProvider>;
  let service: CatalogSyncService;

  beforeEach(() => {
    registry = makeRegistry();
    provider = makeProvider();
    service = new CatalogSyncService(registry, provider);
  });

  // ── onModuleInit ──────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('calls refresh() which calls listWalletAssets for the enabled network', async () => {
      await service.onModuleInit();

      expect(provider.listWalletAssets).toHaveBeenCalledTimes(1);
      expect(provider.listWalletAssets).toHaveBeenCalledWith(
        TRON_MASTER_WALLET,
      );
    });

    it('calls mergeDiscoveredAssets with the provider result', async () => {
      await service.onModuleInit();

      expect(registry.mergeDiscoveredAssets).toHaveBeenCalledTimes(1);
      expect(registry.mergeDiscoveredAssets).toHaveBeenCalledWith([
        DISCOVERED_USDT,
        DISCOVERED_TRX,
      ]);
    });
  });

  // ── refresh ───────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    it('calls listWalletAssets for each enabled network', async () => {
      // Two networks, each with a separate master wallet.
      registry = makeRegistry({
        networks: ['TRON', 'ETH'],
        masterWalletIdFn: (id) => `${id.toLowerCase()}-master`,
      });
      service = new CatalogSyncService(registry, provider);

      await service.refresh();

      expect(provider.listWalletAssets).toHaveBeenCalledTimes(2);
      expect(provider.listWalletAssets).toHaveBeenCalledWith('tron-master');
      expect(provider.listWalletAssets).toHaveBeenCalledWith('eth-master');
    });

    it('merges discovered assets from each network into the registry', async () => {
      await service.refresh();

      expect(registry.mergeDiscoveredAssets).toHaveBeenCalledWith([
        DISCOVERED_USDT,
        DISCOVERED_TRX,
      ]);
    });

    it('skips a network when networkMasterWalletId throws — continues with others', async () => {
      // TRON throws, but if there were a second network it would proceed.
      // Verify the method does not propagate the error.
      registry = makeRegistry({
        networks: ['TRON'],
        masterWalletIdFn: () => {
          throw new Error('No master wallet id configured');
        },
      });
      service = new CatalogSyncService(registry, provider);

      // Must not throw.
      await expect(service.refresh()).resolves.toBeUndefined();
      // Provider never called because the wallet id lookup failed.
      expect(provider.listWalletAssets).not.toHaveBeenCalled();
    });

    it('skips a network when master wallet id is empty string', async () => {
      registry = makeRegistry({
        networks: ['TRON'],
        masterWalletIdFn: () => '',
      });
      service = new CatalogSyncService(registry, provider);

      await expect(service.refresh()).resolves.toBeUndefined();
      expect(provider.listWalletAssets).not.toHaveBeenCalled();
    });

    it('swallows provider errors — never crashes (resilient boot)', async () => {
      provider.listWalletAssets.mockRejectedValue(
        new Error(
          'Blockradar listWalletAssets error (HTTP 500): Internal error',
        ),
      );

      // Must not throw — boot resilience is critical.
      await expect(service.refresh()).resolves.toBeUndefined();
      // mergeDiscoveredAssets is never called when the provider fails.
      expect(registry.mergeDiscoveredAssets).not.toHaveBeenCalled();
    });

    it('continues to the next network when one network provider call fails', async () => {
      registry = makeRegistry({
        networks: ['TRON', 'ETH'],
        masterWalletIdFn: (id) => `${id.toLowerCase()}-master`,
      });
      // TRON fails, ETH succeeds.
      provider.listWalletAssets
        .mockRejectedValueOnce(new Error('TRON provider error'))
        .mockResolvedValueOnce([DISCOVERED_USDT]);
      service = new CatalogSyncService(registry, provider);

      await expect(service.refresh()).resolves.toBeUndefined();

      // ETH call still happened.
      expect(provider.listWalletAssets).toHaveBeenCalledTimes(2);
      // mergeDiscoveredAssets called once (for ETH success).
      expect(registry.mergeDiscoveredAssets).toHaveBeenCalledTimes(1);
    });

    it('does not call mergeDiscoveredAssets when there are no enabled networks', async () => {
      registry = makeRegistry({ networks: [] });
      service = new CatalogSyncService(registry, provider);

      await service.refresh();

      expect(provider.listWalletAssets).not.toHaveBeenCalled();
      expect(registry.mergeDiscoveredAssets).not.toHaveBeenCalled();
    });
  });
});
