import { Test, TestingModule } from '@nestjs/testing';

import { AdminCatalogViewSchema } from '@handshake-agent/contracts';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { AdminCatalogService } from './admin-catalog.service';
import type { CatalogConfig } from '../../../core/config/configuration';

// A representative merged catalog: enabled + disabled assets/fiats + networks, so
// the projection is exercised over both live and paused rows and the network-id →
// display-name resolution.
const catalog: CatalogConfig = {
  assets: {
    USDT: {
      symbol: 'USDT',
      displayName: 'Tether USD',
      kind: 'crypto',
      decimals: 6,
      networks: ['TRON', 'ETHEREUM'],
      providers: { blockradar: { assetId: 'secret-uuid' } },
      enabled: true,
    },
    BTC: {
      symbol: 'BTC',
      displayName: 'Bitcoin',
      kind: 'crypto',
      decimals: 8,
      networks: ['BITCOIN'],
      providers: {},
      enabled: false,
    },
  },
  fiats: {
    NGN: {
      code: 'NGN',
      displayName: 'Nigerian Naira',
      symbol: '₦',
      decimals: 2,
      enabled: true,
    },
    RWF: {
      code: 'RWF',
      displayName: 'Rwandan Franc',
      symbol: 'FRw',
      decimals: 0,
      enabled: false,
    },
  },
  networks: {
    TRON: {
      id: 'TRON',
      displayName: 'TRON',
      addressPattern: '^T.+$',
      enabled: true,
      networkFeeCrypto: { USDT: '1' },
      masterWalletId: 'secret-wallet',
    },
    ETHEREUM: {
      id: 'ETHEREUM',
      displayName: 'Ethereum',
      addressPattern: '^0x.+$',
      enabled: true,
      networkFeeCrypto: {},
    },
    // BITCOIN intentionally absent from `networks` to exercise the id-fallback.
  },
  capabilities: {},
  sendQuoteExpiresInSec: 30,
};

describe('AdminCatalogService', () => {
  let service: AdminCatalogService;
  let effectiveConfig: jest.Mocked<Pick<EffectiveConfigService, 'get'>>;

  beforeEach(async () => {
    effectiveConfig = {
      get: jest.fn((key: string) =>
        key === 'catalog' ? catalog : undefined,
      ) as jest.Mock,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminCatalogService,
        { provide: EffectiveConfigService, useValue: effectiveConfig },
      ],
    }).compile();

    service = module.get(AdminCatalogService);
  });

  it('reads the catalog from the effective (merged, hot-reloaded) config, not the static base', () => {
    service.getCatalog();
    expect(effectiveConfig.get).toHaveBeenCalledWith('catalog');
  });

  it('projects a shape that satisfies the AdminCatalogView contract', () => {
    const view = service.getCatalog();
    expect(() => AdminCatalogViewSchema.parse(view)).not.toThrow();
  });

  it('includes DISABLED assets and fiats (not just enabled ones)', () => {
    const view = service.getCatalog();
    expect(view.assets.map((a) => a.symbol).sort()).toEqual(['BTC', 'USDT']);
    expect(view.fiats.map((f) => f.code).sort()).toEqual(['NGN', 'RWF']);
  });

  it("maps each entry's `enabled` flag onto the `live` field", () => {
    const view = service.getCatalog();
    const usdt = view.assets.find((a) => a.symbol === 'USDT');
    const btc = view.assets.find((a) => a.symbol === 'BTC');
    const ngn = view.fiats.find((f) => f.code === 'NGN');
    const rwf = view.fiats.find((f) => f.code === 'RWF');
    expect(usdt?.live).toBe(true);
    expect(btc?.live).toBe(false);
    expect(ngn?.live).toBe(true);
    expect(rwf?.live).toBe(false);
  });

  it('resolves network ids to their display names, falling back to the id when the network is unregistered', () => {
    const view = service.getCatalog();
    const usdt = view.assets.find((a) => a.symbol === 'USDT');
    const btc = view.assets.find((a) => a.symbol === 'BTC');
    // TRON/ETHEREUM resolve to display names; BITCOIN is absent → id fallback.
    expect(usdt?.networks).toEqual(['TRON', 'Ethereum']);
    expect(btc?.networks).toEqual(['BITCOIN']);
  });

  it('surfaces asset display metadata (symbol/name/kind/decimals) without any secret field', () => {
    const view = service.getCatalog();
    const usdt = view.assets.find((a) => a.symbol === 'USDT')!;
    expect(usdt).toEqual({
      symbol: 'USDT',
      displayName: 'Tether USD',
      kind: 'crypto',
      decimals: 6,
      networks: ['TRON', 'Ethereum'],
      live: true,
    });
    // No provider ids or master-wallet ids leak into the projection.
    expect(JSON.stringify(view)).not.toContain('secret-uuid');
    expect(JSON.stringify(view)).not.toContain('secret-wallet');
  });

  it('surfaces fiat display metadata (code/symbol/name/decimals-as-rounding)', () => {
    const view = service.getCatalog();
    const ngn = view.fiats.find((f) => f.code === 'NGN')!;
    expect(ngn).toEqual({
      code: 'NGN',
      symbol: '₦',
      displayName: 'Nigerian Naira',
      decimals: 2,
      live: true,
    });
  });

  it('returns empty arrays when the catalog has no assets or fiats', () => {
    effectiveConfig.get.mockImplementation((key: string) =>
      key === 'catalog' ? { ...catalog, assets: {}, fiats: {} } : undefined,
    );
    const view = service.getCatalog();
    expect(view).toEqual({ assets: [], fiats: [] });
  });
});
