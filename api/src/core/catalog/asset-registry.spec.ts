/**
 * Unit tests for AssetRegistry (task X1 — config-driven asset/currency/network registry).
 *
 * TDD: written before the implementation. No DB, no network calls.
 * The registry reads solely from a stubbed ConfigService.
 *
 * Extended to cover:
 *   - mergeDiscoveredAssets(): dynamic provider-id overlay + synthetic asset creation
 *   - assetProviderId() resolution order (discovered overlay first, then static config)
 *   - USDT catalog entry now has empty providers{} (no hardcoded assetId)
 */

import { ConfigService } from '@nestjs/config';

import { AssetRegistry } from './asset-registry';
import {
  UnsupportedAssetError,
  UnsupportedFiatError,
  UnsupportedNetworkError,
  CapabilityDisabledError,
} from './catalog-errors';
import type { DiscoveredAsset } from '../../modules/wallets/application/ports/wallet-provider.port';

// ---------------------------------------------------------------------------
// Stub config matching the JSON-defaults shape defined in configuration.ts §catalog
// NOTE: providers is intentionally EMPTY for USDT — the hardcoded assetId has
// been removed from configuration.ts; the runtime id comes from CatalogSyncService.
// ---------------------------------------------------------------------------

const STUB_CATALOG = {
  assets: {
    USDT: {
      symbol: 'USDT',
      displayName: 'USDT',
      kind: 'crypto' as const,
      decimals: 6,
      networks: ['TRON'],
      // Intentionally empty — assetId is discovered at boot, not hardcoded.
      providers: {},
      enabled: true,
    },
    // Registered but explicitly disabled — should throw UnsupportedAssetError.
    BTC: {
      symbol: 'BTC',
      displayName: 'Bitcoin',
      kind: 'crypto' as const,
      decimals: 8,
      networks: [],
      providers: {},
      enabled: false,
    },
  },
  fiats: {
    NGN: {
      code: 'NGN',
      displayName: 'Naira',
      symbol: '₦',
      decimals: 2,
      enabled: true,
    },
    // Supported but NOT live — matches the multi-currency foundation pattern.
    RWF: {
      code: 'RWF',
      displayName: 'Rwandan Franc',
      symbol: 'FRw',
      decimals: 0,
      enabled: false,
    },
    GHS: {
      code: 'GHS',
      displayName: 'Ghanaian Cedi',
      symbol: 'GH₵',
      decimals: 2,
      enabled: false,
    },
  },
  networks: {
    TRON: {
      id: 'TRON',
      displayName: 'TRON (TRC-20)',
      addressPattern: '^T[1-9A-HJ-NP-Za-km-z]{33}$',
      enabled: true,
    },
  },
  capabilities: {
    'crypto.buy': true,
    'crypto.sell': true,
    'crypto.send': true,
    'crypto.receive': true,
    'crypto.swap': false,
  },
};

function makeConfig(): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'catalog') return STUB_CATALOG;
      return undefined;
    },
  } as unknown as ConfigService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AssetRegistry', () => {
  let registry: AssetRegistry;

  beforeEach(() => {
    registry = new AssetRegistry(makeConfig());
  });

  // ── asset() ─────────────────────────────────────────────────────────────

  describe('asset()', () => {
    it('returns metadata for a registered, enabled asset', () => {
      const meta = registry.asset('USDT');
      expect(meta.symbol).toBe('USDT');
      expect(meta.decimals).toBe(6);
      expect(meta.networks).toEqual(['TRON']);
      expect(meta.kind).toBe('crypto');
    });

    it('throws UnsupportedAssetError for an unregistered asset', () => {
      expect(() => registry.asset('BTC')).toThrow(UnsupportedAssetError);
    });

    it('throws UnsupportedAssetError with a descriptive message', () => {
      expect(() => registry.asset('BTC')).toThrow(/BTC/);
    });

    it('throws UnsupportedAssetError for a registered but disabled asset', () => {
      // BTC is registered in STUB_CATALOG but enabled: false — must be treated as absent.
      expect(() => registry.asset('BTC')).toThrow(UnsupportedAssetError);
    });
  });

  // ── fiat() ───────────────────────────────────────────────────────────────

  describe('fiat()', () => {
    it('returns metadata for a registered fiat', () => {
      const meta = registry.fiat('NGN');
      expect(meta.code).toBe('NGN');
      expect(meta.symbol).toBe('₦');
      expect(meta.decimals).toBe(2);
    });

    it('throws UnsupportedFiatError for an unregistered fiat', () => {
      expect(() => registry.fiat('USD')).toThrow(UnsupportedFiatError);
    });

    it('throws UnsupportedFiatError with a descriptive message', () => {
      expect(() => registry.fiat('USD')).toThrow(/USD/);
    });
  });

  // ── network() ────────────────────────────────────────────────────────────

  describe('network()', () => {
    it('returns metadata for a registered network', () => {
      const meta = registry.network('TRON');
      expect(meta.id).toBe('TRON');
      expect(meta.displayName).toBe('TRON (TRC-20)');
    });

    it('throws UnsupportedNetworkError for an unregistered network', () => {
      expect(() => registry.network('ETH')).toThrow(UnsupportedNetworkError);
    });

    it('throws UnsupportedNetworkError with a descriptive message', () => {
      expect(() => registry.network('ETH')).toThrow(/ETH/);
    });
  });

  // ── assetProviderId() ────────────────────────────────────────────────────

  describe('assetProviderId()', () => {
    it('returns the discovered Blockradar asset id for USDT after mergeDiscoveredAssets', () => {
      // Since providers is empty in the stub config, the id must come from the
      // dynamic overlay populated by mergeDiscoveredAssets.
      registry.mergeDiscoveredAssets([
        {
          assetId: 'runtime-usdt-asset-id-xyz',
          symbol: 'USDT',
          name: 'Tether USD',
          network: 'TRON',
          contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
          decimals: 6,
          isMainnet: false,
        },
      ]);

      expect(registry.assetProviderId('USDT', 'blockradar')).toBe(
        'runtime-usdt-asset-id-xyz',
      );
    });

    it('throws UnsupportedAssetError when no provider id is available (no static entry, no sync)', () => {
      // USDT stub has empty providers{} and sync has not run — must throw.
      expect(() => registry.assetProviderId('USDT', 'blockradar')).toThrow(
        UnsupportedAssetError,
      );
    });

    it('discovered id overwrites any previously merged id (last sync wins)', () => {
      registry.mergeDiscoveredAssets([
        {
          assetId: 'first-id',
          symbol: 'USDT',
          name: 'Tether USD',
          network: 'TRON',
          contractAddress: null,
          decimals: 6,
          isMainnet: false,
        },
      ]);
      registry.mergeDiscoveredAssets([
        {
          assetId: 'second-id',
          symbol: 'USDT',
          name: 'Tether USD',
          network: 'TRON',
          contractAddress: null,
          decimals: 6,
          isMainnet: false,
        },
      ]);

      expect(registry.assetProviderId('USDT', 'blockradar')).toBe('second-id');
    });

    it('throws UnsupportedAssetError for an unknown asset', () => {
      expect(() => registry.assetProviderId('BTC', 'blockradar')).toThrow(
        UnsupportedAssetError,
      );
    });

    it('throws UnsupportedAssetError when the provider entry is missing', () => {
      // USDT exists but has no 'stripe' provider binding (neither static nor discovered)
      expect(() => registry.assetProviderId('USDT', 'stripe')).toThrow(
        UnsupportedAssetError,
      );
    });

    it('falls back to static config providers when discovered overlay has no entry', () => {
      // Build a stub with a static provider entry to verify fallback path.
      const configWithStaticId = {
        get: (key: string) => {
          if (key === 'catalog') {
            return {
              ...STUB_CATALOG,
              assets: {
                ...STUB_CATALOG.assets,
                USDT: {
                  ...STUB_CATALOG.assets.USDT,
                  providers: { blockradar: { assetId: 'static-fallback-id' } },
                },
              },
            };
          }
          return undefined;
        },
      };
      const registryWithStatic = new AssetRegistry(
        configWithStaticId as unknown as ConfigService,
      );

      // No mergeDiscoveredAssets call — should fall back to static config.
      expect(registryWithStatic.assetProviderId('USDT', 'blockradar')).toBe(
        'static-fallback-id',
      );
    });
  });

  // ── isAssetEnabled() ─────────────────────────────────────────────────────

  describe('isAssetEnabled()', () => {
    it('returns true for USDT', () => {
      expect(registry.isAssetEnabled('USDT')).toBe(true);
    });

    it('returns false for an unregistered asset', () => {
      expect(registry.isAssetEnabled('BTC')).toBe(false);
    });
  });

  // ── isFiatEnabled() ──────────────────────────────────────────────────────

  describe('isFiatEnabled()', () => {
    it('returns true for NGN', () => {
      expect(registry.isFiatEnabled('NGN')).toBe(true);
    });

    it('returns false for an unregistered fiat', () => {
      expect(registry.isFiatEnabled('EUR')).toBe(false);
    });
  });

  // ── isNetworkEnabled() ───────────────────────────────────────────────────

  describe('isNetworkEnabled()', () => {
    it('returns true for TRON', () => {
      expect(registry.isNetworkEnabled('TRON')).toBe(true);
    });

    it('returns false for an unregistered network', () => {
      expect(registry.isNetworkEnabled('ETH')).toBe(false);
    });
  });

  // ── isCapabilityEnabled() ────────────────────────────────────────────────

  describe('isCapabilityEnabled()', () => {
    it('returns true for crypto.buy', () => {
      expect(registry.isCapabilityEnabled('crypto.buy')).toBe(true);
    });

    it('returns true for crypto.sell', () => {
      expect(registry.isCapabilityEnabled('crypto.sell')).toBe(true);
    });

    it('returns false for crypto.swap', () => {
      expect(registry.isCapabilityEnabled('crypto.swap')).toBe(false);
    });

    it('returns false for an unknown capability', () => {
      expect(registry.isCapabilityEnabled('ticketing.eventbrite')).toBe(false);
    });

    it('returns false for any unknown capability key (fail-closed)', () => {
      // Any key not in config must fail-closed, never grant access.
      expect(registry.isCapabilityEnabled('unknown.capability.xyz')).toBe(
        false,
      );
    });

    it('throws CapabilityDisabledError when capability is disabled and flag is strict', () => {
      expect(() => registry.requireCapability('crypto.swap')).toThrow(
        CapabilityDisabledError,
      );
    });

    it('throws CapabilityDisabledError for an entirely unknown capability key', () => {
      // Unknown key is not in catalog.capabilities, so fail-closed → throw.
      expect(() => registry.requireCapability('ticketing.unknown')).toThrow(
        CapabilityDisabledError,
      );
    });

    it('does not throw for an enabled capability in requireCapability()', () => {
      expect(() => registry.requireCapability('crypto.buy')).not.toThrow();
    });
  });

  // ── defaultCryptoAsset() ─────────────────────────────────────────────────

  describe('defaultCryptoAsset()', () => {
    it('returns USDT as the first enabled crypto asset in the stub catalog', () => {
      // STUB_CATALOG has USDT (enabled: true, kind: crypto) and BTC (enabled: false).
      // The method returns the first enabled crypto asset — must be USDT.
      expect(registry.defaultCryptoAsset()).toBe('USDT');
    });

    it('throws UnsupportedAssetError when no enabled crypto asset is registered', () => {
      // Build a registry with no enabled crypto assets.
      const emptyConfig = {
        get: (key: string) => {
          if (key === 'catalog') {
            return {
              assets: {
                BTC: {
                  symbol: 'BTC',
                  displayName: 'Bitcoin',
                  kind: 'crypto' as const,
                  decimals: 8,
                  networks: [],
                  providers: {},
                  enabled: false, // disabled — no enabled crypto asset
                },
              },
              fiats: {},
              networks: {},
              capabilities: {},
            };
          }
          return undefined;
        },
      };
      const emptyRegistry = new AssetRegistry(
        emptyConfig as unknown as import('@nestjs/config').ConfigService,
      );
      expect(() => emptyRegistry.defaultCryptoAsset()).toThrow(
        UnsupportedAssetError,
      );
    });
  });

  // ── defaultFiat() ────────────────────────────────────────────────────────

  describe('defaultFiat()', () => {
    it('returns the first enabled fiat as the base fiat', () => {
      expect(registry.defaultFiat()).toBe('NGN');
    });

    it('throws UnsupportedFiatError when no enabled fiat is registered', () => {
      const emptyConfig = {
        get: (key: string) => {
          if (key === 'catalog') {
            return {
              assets: {},
              fiats: {},
              networks: {},
              capabilities: {},
            };
          }
          return undefined;
        },
      };
      const emptyRegistry = new AssetRegistry(
        emptyConfig as unknown as import('@nestjs/config').ConfigService,
      );
      expect(() => emptyRegistry.defaultFiat()).toThrow(UnsupportedFiatError);
    });
  });

  // ── defaultNetworkFor() ──────────────────────────────────────────────────

  describe('defaultNetworkFor()', () => {
    it('returns TRON as the default network for USDT', () => {
      expect(registry.defaultNetworkFor('USDT')).toBe('TRON');
    });

    it('throws UnsupportedAssetError for an unknown asset', () => {
      expect(() => registry.defaultNetworkFor('BTC')).toThrow(
        UnsupportedAssetError,
      );
    });
  });

  // ── validateAddress() ────────────────────────────────────────────────────

  describe('validateAddress()', () => {
    it('returns true for a valid TRON T-address (34 chars)', () => {
      // Standard valid TRC-20 address format: T followed by 33 Base58 chars
      expect(
        registry.validateAddress('TRON', 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE'),
      ).toBe(true);
    });

    it('returns false for an EVM address on TRON', () => {
      expect(
        registry.validateAddress(
          'TRON',
          '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        ),
      ).toBe(false);
    });

    it('returns false for a too-short address', () => {
      expect(registry.validateAddress('TRON', 'Tabc')).toBe(false);
    });

    it('throws UnsupportedNetworkError for an unknown network', () => {
      expect(() => registry.validateAddress('ETH', '0xabc')).toThrow(
        UnsupportedNetworkError,
      );
    });
  });

  // ── formatCrypto() ───────────────────────────────────────────────────────

  describe('formatCrypto()', () => {
    it('formats USDT amounts as "<amount> USDT"', () => {
      expect(registry.formatCrypto('USDT', '3.5')).toBe('3.5 USDT');
    });

    it('formats whole number USDT amounts', () => {
      expect(registry.formatCrypto('USDT', '100')).toBe('100 USDT');
    });

    it('throws UnsupportedAssetError for unknown asset', () => {
      expect(() => registry.formatCrypto('BTC', '1')).toThrow(
        UnsupportedAssetError,
      );
    });
  });

  // ── inferNetworkForAddress() ─────────────────────────────────────────────

  describe('inferNetworkForAddress()', () => {
    it('returns the network id when the address matches a registered pattern', () => {
      // Valid TRC-20 address: T + 33 Base58 chars (from validateAddress tests)
      expect(
        registry.inferNetworkForAddress('TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE'),
      ).toBe('TRON');
    });

    it('returns null for a gibberish address that matches no pattern', () => {
      expect(registry.inferNetworkForAddress('not-an-address')).toBeNull();
    });
  });

  // ── defaultAssetForNetwork() ──────────────────────────────────────────────

  describe('defaultAssetForNetwork()', () => {
    it('returns the symbol of the first enabled asset on the given network', () => {
      expect(registry.defaultAssetForNetwork('TRON')).toBe('USDT');
    });

    it('returns null for an unknown network id', () => {
      expect(registry.defaultAssetForNetwork('unknown')).toBeNull();
    });
  });

  // ── formatFiat() ─────────────────────────────────────────────────────────
  // These assertions must be deterministic across all Node ICU builds
  // (small-icu in Alpine/Docker CI, full ICU in local dev). The formatter
  // must NOT use Intl/toLocaleString — use the manual grouping algorithm.

  describe('formatFiat()', () => {
    it('formats NGN amounts with the ₦ symbol and two decimal places', () => {
      // Deterministic: manual comma grouping, NOT toLocaleString('en-NG').
      expect(registry.formatFiat('NGN', '5000')).toBe('₦5,000.00');
    });

    it('formats fractional NGN amounts correctly', () => {
      expect(registry.formatFiat('NGN', '1234.5')).toBe('₦1,234.50');
    });

    it('formats large amounts with comma separators', () => {
      expect(registry.formatFiat('NGN', '1000000')).toBe('₦1,000,000.00');
    });

    it('formats amounts under 1000 without comma separator', () => {
      expect(registry.formatFiat('NGN', '999')).toBe('₦999.00');
    });

    it('throws UnsupportedFiatError for an unknown fiat', () => {
      expect(() => registry.formatFiat('EUR', '100')).toThrow(
        UnsupportedFiatError,
      );
    });
  });

  // ── mergeDiscoveredAssets() ──────────────────────────────────────────────

  describe('mergeDiscoveredAssets()', () => {
    const DISCOVERED_USDT: DiscoveredAsset = {
      assetId: 'runtime-usdt-id-abc',
      symbol: 'USDT',
      name: 'Tether USD',
      network: 'TRON',
      contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      decimals: 6,
      isMainnet: false,
    };

    const DISCOVERED_TRX: DiscoveredAsset = {
      assetId: 'runtime-trx-id-def',
      symbol: 'TRX',
      name: 'TRON',
      network: 'TRON',
      contractAddress: null,
      decimals: 6,
      isMainnet: false,
    };

    it('makes assetProviderId(USDT, blockradar) return the discovered id', () => {
      registry.mergeDiscoveredAssets([DISCOVERED_USDT]);

      expect(registry.assetProviderId('USDT', 'blockradar')).toBe(
        'runtime-usdt-id-abc',
      );
    });

    it('makes a discovered-only asset (TRX) accessible via asset()', () => {
      registry.mergeDiscoveredAssets([DISCOVERED_TRX]);

      const meta = registry.asset('TRX');
      expect(meta.symbol).toBe('TRX');
      expect(meta.decimals).toBe(6);
      expect(meta.kind).toBe('crypto');
    });

    it('makes a discovered-only asset accessible via enabledCryptoAssets()', () => {
      registry.mergeDiscoveredAssets([DISCOVERED_TRX]);

      expect(registry.enabledCryptoAssets()).toContain('TRX');
    });

    it('does not duplicate a static asset in enabledCryptoAssets()', () => {
      registry.mergeDiscoveredAssets([DISCOVERED_USDT, DISCOVERED_TRX]);

      const assets = registry.enabledCryptoAssets();
      const usdtCount = assets.filter((s) => s === 'USDT').length;
      expect(usdtCount).toBe(1);
    });

    it('skips assets whose network is not in the static catalog', () => {
      const ethAsset: DiscoveredAsset = {
        assetId: 'eth-asset-id',
        symbol: 'WETH',
        name: 'Wrapped Ether',
        network: 'ETH', // ETH is not in STUB_CATALOG.networks
        contractAddress: '0xC02aaA39b223FE8D0A0e5C4F27ead9083C756Cc2',
        decimals: 18,
        isMainnet: true,
      };

      // Should not throw — just skips the unknown-network asset.
      expect(() => registry.mergeDiscoveredAssets([ethAsset])).not.toThrow();
      // WETH should NOT be in the registry (network not configured).
      expect(registry.isAssetEnabled('WETH')).toBe(false);
    });

    it('is idempotent — merging the same assets twice does not duplicate them', () => {
      registry.mergeDiscoveredAssets([DISCOVERED_TRX]);
      registry.mergeDiscoveredAssets([DISCOVERED_TRX]);

      const assets = registry.enabledCryptoAssets();
      const trxCount = assets.filter((s) => s === 'TRX').length;
      expect(trxCount).toBe(1);
    });

    it('discovered asset is found by isAssetEnabled()', () => {
      registry.mergeDiscoveredAssets([DISCOVERED_TRX]);
      expect(registry.isAssetEnabled('TRX')).toBe(true);
    });

    it('defaultAssetForNetwork returns discovered asset when static catalog has no match', () => {
      // Build a registry with no static assets on TRON (to test discovered fallback).
      const emptyAssetsConfig = {
        get: (key: string) => {
          if (key === 'catalog') {
            return {
              ...STUB_CATALOG,
              assets: {}, // no static assets
            };
          }
          return undefined;
        },
      };
      const emptyRegistry = new AssetRegistry(
        emptyAssetsConfig as unknown as ConfigService,
      );
      emptyRegistry.mergeDiscoveredAssets([DISCOVERED_USDT]);

      expect(emptyRegistry.defaultAssetForNetwork('TRON')).toBe('USDT');
    });
  });

  // ── isCurrencyLive() ─────────────────────────────────────────────────────
  // Tests the new multi-currency foundation helpers.

  describe('isCurrencyLive()', () => {
    it('returns true for NGN (the only live currency)', () => {
      expect(registry.isCurrencyLive('NGN')).toBe(true);
    });

    it('returns false for RWF (registered but not yet live)', () => {
      expect(registry.isCurrencyLive('RWF')).toBe(false);
    });

    it('returns false for GHS (registered but not yet live)', () => {
      expect(registry.isCurrencyLive('GHS')).toBe(false);
    });

    it('returns false for a currency code not in the catalog at all', () => {
      expect(registry.isCurrencyLive('EUR')).toBe(false);
    });
  });

  // ── enabledFiats() ───────────────────────────────────────────────────────

  describe('enabledFiats()', () => {
    it('returns only the live (enabled:true) fiat codes', () => {
      expect(registry.enabledFiats()).toEqual(['NGN']);
    });

    it('does not include disabled fiats', () => {
      const live = registry.enabledFiats();
      expect(live).not.toContain('RWF');
      expect(live).not.toContain('GHS');
    });
  });

  // ── supportedFiats() ─────────────────────────────────────────────────────

  describe('supportedFiats()', () => {
    it('returns all fiat codes registered in the catalog, enabled or not', () => {
      const supported = registry.supportedFiats();
      expect(supported).toContain('NGN');
      expect(supported).toContain('RWF');
      expect(supported).toContain('GHS');
    });

    it('returns all three entries from the stub catalog', () => {
      expect(registry.supportedFiats()).toHaveLength(3);
    });
  });
});
