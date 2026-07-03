import { Test, TestingModule } from '@nestjs/testing';

import { AdminCatalogViewSchema } from '@handshake-agent/contracts';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { AdminCatalogService } from './admin-catalog.service';
import type { CatalogConfig } from '../../../core/config/configuration';
import {
  CUSTOM_FIAT_REPOSITORY,
  type CustomFiatRecord,
  type ICustomFiatRepository,
} from './ports/custom-fiat.repository.port';

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

const customRow = (over: Partial<CustomFiatRecord> = {}): CustomFiatRecord => ({
  code: 'EUR',
  displayName: 'Euro',
  symbol: '€',
  decimals: 2,
  enabled: false,
  createdAt: new Date('2026-07-03T00:00:00.000Z'),
  ...over,
});

describe('AdminCatalogService', () => {
  let service: AdminCatalogService;
  let effectiveConfig: jest.Mocked<Pick<EffectiveConfigService, 'get'>>;
  let customFiatRepo: jest.Mocked<ICustomFiatRepository>;

  beforeEach(async () => {
    effectiveConfig = {
      get: jest.fn((key: string) =>
        key === 'catalog' ? catalog : undefined,
      ) as jest.Mock,
    };
    customFiatRepo = {
      listAll: jest.fn().mockResolvedValue([]),
      findByCode: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminCatalogService,
        { provide: EffectiveConfigService, useValue: effectiveConfig },
        { provide: CUSTOM_FIAT_REPOSITORY, useValue: customFiatRepo },
      ],
    }).compile();

    service = module.get(AdminCatalogService);
  });

  it('reads the catalog from the effective (merged, hot-reloaded) config, not the static base', async () => {
    await service.getCatalog();
    expect(effectiveConfig.get).toHaveBeenCalledWith('catalog');
  });

  it('projects a shape that satisfies the AdminCatalogView contract', async () => {
    const view = await service.getCatalog();
    expect(() => AdminCatalogViewSchema.parse(view)).not.toThrow();
  });

  it('includes DISABLED assets and fiats (not just enabled ones)', async () => {
    const view = await service.getCatalog();
    expect(view.assets.map((a) => a.symbol).sort()).toEqual(['BTC', 'USDT']);
    expect(view.fiats.map((f) => f.code).sort()).toEqual(['NGN', 'RWF']);
  });

  it("maps each entry's `enabled` flag onto the `live` field", async () => {
    const view = await service.getCatalog();
    const usdt = view.assets.find((a) => a.symbol === 'USDT');
    const btc = view.assets.find((a) => a.symbol === 'BTC');
    const ngn = view.fiats.find((f) => f.code === 'NGN');
    const rwf = view.fiats.find((f) => f.code === 'RWF');
    expect(usdt?.live).toBe(true);
    expect(btc?.live).toBe(false);
    expect(ngn?.live).toBe(true);
    expect(rwf?.live).toBe(false);
  });

  it('resolves network ids to their display names, falling back to the id when the network is unregistered', async () => {
    const view = await service.getCatalog();
    const usdt = view.assets.find((a) => a.symbol === 'USDT');
    const btc = view.assets.find((a) => a.symbol === 'BTC');
    // TRON/ETHEREUM resolve to display names; BITCOIN is absent → id fallback.
    expect(usdt?.networks).toEqual(['TRON', 'Ethereum']);
    expect(btc?.networks).toEqual(['BITCOIN']);
  });

  it('surfaces asset display metadata (symbol/name/kind/decimals) without any secret field', async () => {
    const view = await service.getCatalog();
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

  it('surfaces built-in fiat display metadata with custom:false', async () => {
    const view = await service.getCatalog();
    const ngn = view.fiats.find((f) => f.code === 'NGN')!;
    expect(ngn).toEqual({
      code: 'NGN',
      symbol: '₦',
      displayName: 'Nigerian Naira',
      decimals: 2,
      live: true,
      custom: false,
    });
  });

  it('returns empty arrays when the catalog and custom store are empty', async () => {
    effectiveConfig.get.mockImplementation((key: string) =>
      key === 'catalog' ? { ...catalog, assets: {}, fiats: {} } : undefined,
    );
    const view = await service.getCatalog();
    expect(view).toEqual({ assets: [], fiats: [] });
  });

  describe('custom-fiat merge', () => {
    it('merges runtime custom fiats (custom:true, live=enabled) alongside built-ins', async () => {
      customFiatRepo.listAll.mockResolvedValue([
        customRow({ code: 'EUR', enabled: true }),
        customRow({
          code: 'GHS',
          displayName: 'Ghana Cedi',
          symbol: '₵',
          enabled: false,
        }),
      ]);

      const view = await service.getCatalog();

      // Built-ins remain, marked custom:false.
      expect(view.fiats.find((f) => f.code === 'NGN')?.custom).toBe(false);
      // Custom rows appended, marked custom:true with live mapped from enabled.
      const eur = view.fiats.find((f) => f.code === 'EUR')!;
      expect(eur).toEqual({
        code: 'EUR',
        symbol: '€',
        displayName: 'Euro',
        decimals: 2,
        live: true,
        custom: true,
      });
      const ghs = view.fiats.find((f) => f.code === 'GHS')!;
      expect(ghs.custom).toBe(true);
      expect(ghs.live).toBe(false);
    });

    it('includes PAUSED (disabled) custom fiats too', async () => {
      customFiatRepo.listAll.mockResolvedValue([
        customRow({ code: 'EUR', enabled: false }),
      ]);
      const view = await service.getCatalog();
      expect(view.fiats.map((f) => f.code).sort()).toEqual([
        'EUR',
        'NGN',
        'RWF',
      ]);
    });
  });
});
