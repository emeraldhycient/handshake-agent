/**
 * Unit tests for AssetRegistry (task X1 — config-driven asset/currency/network registry).
 *
 * TDD: written before the implementation. No DB, no network calls.
 * The registry reads solely from a stubbed ConfigService.
 */

import { ConfigService } from '@nestjs/config';

import { AssetRegistry } from './asset-registry';
import {
  UnsupportedAssetError,
  UnsupportedFiatError,
  UnsupportedNetworkError,
  CapabilityDisabledError,
} from './catalog-errors';

// ---------------------------------------------------------------------------
// Stub config matching the JSON-defaults shape defined in configuration.ts §catalog
// ---------------------------------------------------------------------------

const STUB_CATALOG = {
  assets: {
    USDT: {
      symbol: 'USDT',
      displayName: 'USDT',
      kind: 'crypto' as const,
      decimals: 6,
      networks: ['TRON'],
      providers: {
        blockradar: { assetId: 'f56d297c-a3db-4cda-95bd-180b54679070' },
      },
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
    it('returns the Blockradar asset id for USDT', () => {
      expect(registry.assetProviderId('USDT', 'blockradar')).toBe(
        'f56d297c-a3db-4cda-95bd-180b54679070',
      );
    });

    it('throws UnsupportedAssetError for an unknown asset', () => {
      expect(() => registry.assetProviderId('BTC', 'blockradar')).toThrow(
        UnsupportedAssetError,
      );
    });

    it('throws UnsupportedAssetError when the provider entry is missing', () => {
      // USDT exists but has no 'stripe' provider binding
      expect(() => registry.assetProviderId('USDT', 'stripe')).toThrow(
        UnsupportedAssetError,
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
});
