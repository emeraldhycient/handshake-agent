import type {
  AssetRegistry,
  DiscoveredAssetView,
} from '../../../core/catalog/asset-registry';
import type { CatalogSyncService } from '../../../core/catalog/catalog-sync.service';
import type { AuditService } from '../../../core/audit/application/audit.service';
import { AdminAssetsService } from './admin-assets.service';

function view(over: Partial<DiscoveredAssetView>): DiscoveredAssetView {
  return {
    symbol: 'USDC',
    displayName: 'USD Coin',
    decimals: 6,
    networks: ['TRON'],
    contractAddress: 'TXusdc',
    blockradarAssetId: 'usdc-id',
    logoUrl: null,
    enabled: true,
    inStaticCatalog: false,
    ...over,
  };
}

describe('AdminAssetsService', () => {
  const ADMIN_ID = 'admin-1';

  function make(discovered: DiscoveredAssetView[]) {
    const registry = {
      listDiscoveredAssets: jest.fn().mockReturnValue(discovered),
    } as unknown as AssetRegistry;
    const catalogSync = {
      refresh: jest.fn().mockResolvedValue(undefined),
    } as unknown as CatalogSyncService;
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    return {
      svc: new AdminAssetsService(registry, catalogSync, audit),
      registry,
      catalogSync,
      audit,
    };
  }

  describe('listDiscovered', () => {
    it('returns ONLY the assets not already in the static catalog, mapped to wire', () => {
      const { svc } = make([
        view({ symbol: 'USDC', inStaticCatalog: false }),
        view({ symbol: 'USDT', inStaticCatalog: true }), // static → excluded
      ]);
      const { items } = svc.listDiscovered();
      expect(items).toHaveLength(1);
      expect(items[0].symbol).toBe('USDC');
      expect(items[0].contractAddress).toBe('TXusdc');
      expect(items[0].inStaticCatalog).toBe(false);
    });

    it('returns an empty list when nothing new was discovered', () => {
      const { svc } = make([view({ symbol: 'USDT', inStaticCatalog: true })]);
      expect(svc.listDiscovered().items).toEqual([]);
    });
  });

  describe('sync', () => {
    it('re-runs discovery, reports discovered + new counts, and audits the action', async () => {
      const { svc, catalogSync, audit } = make([
        view({ symbol: 'USDC', inStaticCatalog: false }),
        view({ symbol: 'DAI', inStaticCatalog: false }),
        view({ symbol: 'USDT', inStaticCatalog: true }),
      ]);

      const result = await svc.sync(ADMIN_ID);

      expect(catalogSync.refresh).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ discoveredCount: 3, newCount: 2 });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAdminId: ADMIN_ID,
          action: 'admin_update',
          subject: 'AssetCatalog:blockradar-sync',
          after: { discoveredCount: 3, newCount: 2 },
        }),
      );
    });
  });
});
