import { CustomFiatSyncService } from './custom-fiat-sync.service';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type {
  CustomFiatRecord,
  ICustomFiatRepository,
} from './ports/custom-fiat.repository.port';

/**
 * CustomFiatSyncService — publishes the runtime custom-fiat overlay to the
 * AssetRegistry (and thus the whole money path). It runs on boot (OnModuleInit)
 * and via a public `sync()` the admin currency service calls after every add/update.
 * These tests verify it reads all rows from the repo and pushes a CatalogFiat[] to
 * `assetRegistry.syncCustomFiats` — mapping the record fields verbatim, and resilient
 * to a repo failure at boot (must not crash startup).
 */
describe('CustomFiatSyncService', () => {
  const row = (over: Partial<CustomFiatRecord> = {}): CustomFiatRecord => ({
    code: 'EUR',
    displayName: 'Euro',
    symbol: '€',
    decimals: 2,
    enabled: false,
    createdAt: new Date('2026-07-03T00:00:00.000Z'),
    ...over,
  });

  function makeSut(rows: CustomFiatRecord[]) {
    const repo: jest.Mocked<ICustomFiatRepository> = {
      listAll: jest.fn().mockResolvedValue(rows),
      findByCode: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    const syncCustomFiats = jest.fn();
    const registry = { syncCustomFiats } as unknown as AssetRegistry;
    const service = new CustomFiatSyncService(registry, repo);
    return { service, repo, syncCustomFiats };
  }

  it('publishes every custom fiat as a CatalogFiat overlay (code/name/symbol/decimals/enabled)', async () => {
    const { service, syncCustomFiats } = makeSut([
      row({ code: 'EUR', enabled: false }),
      row({
        code: 'GHS',
        displayName: 'Ghana Cedi',
        symbol: '₵',
        enabled: true,
      }),
    ]);

    await service.sync();

    expect(syncCustomFiats).toHaveBeenCalledWith([
      {
        code: 'EUR',
        displayName: 'Euro',
        symbol: '€',
        decimals: 2,
        enabled: false,
      },
      {
        code: 'GHS',
        displayName: 'Ghana Cedi',
        symbol: '₵',
        decimals: 2,
        enabled: true,
      },
    ]);
  });

  it('publishes an empty overlay when there are no custom fiats', async () => {
    const { service, syncCustomFiats } = makeSut([]);
    await service.sync();
    expect(syncCustomFiats).toHaveBeenCalledWith([]);
  });

  it('syncs on module init', async () => {
    const { service, syncCustomFiats } = makeSut([row()]);
    await service.onModuleInit();
    expect(syncCustomFiats).toHaveBeenCalledTimes(1);
  });

  it('never crashes boot when the repo throws (resilient onModuleInit)', async () => {
    const { service, repo, syncCustomFiats } = makeSut([]);
    repo.listAll.mockRejectedValueOnce(new Error('db down'));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(syncCustomFiats).not.toHaveBeenCalled();
  });
});
