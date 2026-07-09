import type { Clock } from '../../../core/common/clock';
import {
  AssetRegistry,
  type CatalogConfigSource,
} from '../../../core/catalog/asset-registry';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { computeBuyQuote, computeSellQuote } from '../domain/quote-pricing';
import { LiveRateStore } from './live-rate.store';
import type { IRateProvider, RateQuote } from './ports/rate-provider.port';
import { RatesService } from './rates.service';
import {
  EffectiveRateSchema,
  RateListResponseSchema,
} from '@handshake-agent/contracts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RATE: RateQuote = {
  baseRate: 1600,
  buySpreadBps: 150,
  sellSpreadBps: 200,
  processingFeeBps: 100,
  expiresInSec: 30,
  cryptoDecimals: 6,
};

const fixedClock: Clock = {
  now: () => new Date('2026-07-09T00:00:00.000Z'),
};

/**
 * Stub catalog: USDT + BTC crypto (both enabled), NGN + USD fiat (USD disabled),
 * TRON network. `listEffectiveRates` iterates enabled crypto × enabled fiat.
 */
const STUB_CATALOG = {
  assets: {
    USDT: {
      symbol: 'USDT',
      displayName: 'USDT',
      kind: 'crypto' as const,
      decimals: 6,
      networks: ['TRON'],
      providers: {},
      enabled: true,
    },
    BTC: {
      symbol: 'BTC',
      displayName: 'Bitcoin',
      kind: 'crypto' as const,
      decimals: 8,
      networks: ['TRON'],
      providers: {},
      enabled: true,
    },
  },
  fiats: {
    NGN: {
      code: 'NGN',
      displayName: 'Naira',
      symbol: '₦',
      decimals: 2,
      country: 'NG',
      enabled: true,
    },
    USD: {
      code: 'USD',
      displayName: 'US Dollar',
      symbol: '$',
      decimals: 2,
      country: 'US',
      enabled: false, // disabled → excluded from listEffectiveRates
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
  capabilities: {},
};

/** Builds an AssetRegistry over the stub catalog. */
function makeRegistry(catalog: unknown = STUB_CATALOG): AssetRegistry {
  const config: CatalogConfigSource = {
    get: <T>(key: string): T | undefined =>
      key === 'catalog' ? (catalog as T) : undefined,
  };
  return new AssetRegistry(config);
}

/** A config fake exposing only `pricing.feed` (source detection reads it). */
function makeConfig(
  feed: Record<string, unknown> | undefined = {
    enabled: true,
    stalenessSec: 900,
  },
): EffectiveConfigService {
  return {
    get: (key: string) => (key === 'pricing.feed' ? feed : undefined),
  } as unknown as EffectiveConfigService;
}

/**
 * A rate provider that prices USDT/NGN with RATE, treats BTC/NGN as unpriced,
 * and rejects everything else (mirrors ConfigRateProvider's throw contract).
 */
function makeRateProvider(): IRateProvider {
  return {
    getRate: jest.fn((asset: string, fiat: string) => {
      if (asset === 'USDT' && fiat === 'NGN') return Promise.resolve(RATE);
      return Promise.reject(new Error(`No pricing for ${asset} in ${fiat}`));
    }),
    getValuationRate: jest.fn().mockResolvedValue({ baseRate: RATE.baseRate }),
  };
}

// ---------------------------------------------------------------------------
// getEffectiveRate
// ---------------------------------------------------------------------------

describe('RatesService.getEffectiveRate', () => {
  it('folds the buy spread and sell spread into single rates that match the quote math', async () => {
    const service = new RatesService(
      makeRateProvider(),
      makeRegistry(),
      fixedClock,
      makeConfig(),
    );

    const result = await service.getEffectiveRate('USDT', 'NGN');

    // Consistency with the engine's quote math (not a hand-computed magic
    // number): the folded rate equals the effectiveRate the quote itself uses.
    const buyEffective = computeBuyQuote({
      fiatAmount: 100000,
      baseRate: RATE.baseRate,
      buySpreadBps: RATE.buySpreadBps,
      processingFeeBps: RATE.processingFeeBps,
      cryptoDecimals: RATE.cryptoDecimals,
    }).effectiveRate;
    const sellEffective = computeSellQuote({
      cryptoAmount: 100,
      baseRate: RATE.baseRate,
      sellSpreadBps: RATE.sellSpreadBps,
      processingFeeBps: RATE.processingFeeBps,
    }).effectiveRate;

    expect(result.buyRate).toBe(String(buyEffective)); // '1624'
    expect(result.sellRate).toBe(String(sellEffective)); // '1568'
    expect(result.asset).toBe('USDT');
    expect(result.fiatCurrency).toBe('NGN');
    expect(result.asOf).toBe('2026-07-09T00:00:00.000Z');
  });

  it('does not itemize the raw spread on the returned shape', async () => {
    const service = new RatesService(
      makeRateProvider(),
      makeRegistry(),
      fixedClock,
      makeConfig(),
    );

    const result = await service.getEffectiveRate('USDT', 'NGN');

    expect(result).not.toHaveProperty('buySpreadBps');
    expect(result).not.toHaveProperty('sellSpreadBps');
    expect(result).not.toHaveProperty('spreadBps');
    // buyRate > sellRate: the platform margin is folded, never shown.
    expect(Number(result.buyRate)).toBeGreaterThan(Number(result.sellRate));
  });

  it('output parses against EffectiveRateSchema', async () => {
    const service = new RatesService(
      makeRateProvider(),
      makeRegistry(),
      fixedClock,
      makeConfig(),
    );

    const result = await service.getEffectiveRate('USDT', 'NGN');
    expect(() => EffectiveRateSchema.parse(result)).not.toThrow();
  });

  it('propagates the provider error for a non-tradeable / unpriced pair', async () => {
    const service = new RatesService(
      makeRateProvider(),
      makeRegistry(),
      fixedClock,
      makeConfig(),
    );

    await expect(service.getEffectiveRate('BTC', 'NGN')).rejects.toThrow();
  });

  // ── source: live vs config ────────────────────────────────────────────

  it("reports source 'config' when the live store has no fresh value", async () => {
    const service = new RatesService(
      makeRateProvider(),
      makeRegistry(),
      fixedClock,
      makeConfig(),
      new LiveRateStore(), // cold store
    );

    const result = await service.getEffectiveRate('USDT', 'NGN');
    expect(result.source).toBe('config');
  });

  it("reports source 'live' when the live store has a fresh, positive value", async () => {
    const store = new LiveRateStore();
    store.setRates([
      {
        asset: 'USDT',
        fiat: 'NGN',
        rate: 1605,
        fetchedAt: new Date('2026-07-09T00:00:00.000Z'),
        source: 'quidax',
        degraded: false,
      },
    ]);
    const service = new RatesService(
      makeRateProvider(),
      makeRegistry(),
      fixedClock,
      makeConfig({ enabled: true, stalenessSec: 900 }),
      store,
    );

    const result = await service.getEffectiveRate('USDT', 'NGN');
    expect(result.source).toBe('live');
  });

  it("reports source 'config' when the feed kill-switch is off, even with a fresh live value", async () => {
    const store = new LiveRateStore();
    store.setRates([
      {
        asset: 'USDT',
        fiat: 'NGN',
        rate: 1605,
        fetchedAt: new Date('2026-07-09T00:00:00.000Z'),
        source: 'quidax',
        degraded: false,
      },
    ]);
    const service = new RatesService(
      makeRateProvider(),
      makeRegistry(),
      fixedClock,
      makeConfig({ enabled: false, stalenessSec: 900 }), // kill-switch off
      store,
    );

    const result = await service.getEffectiveRate('USDT', 'NGN');
    expect(result.source).toBe('config');
  });

  it("reports source 'config' when the live value is stale", async () => {
    const store = new LiveRateStore();
    store.setRates([
      {
        asset: 'USDT',
        fiat: 'NGN',
        rate: 1605,
        // fetched 2 hours before the clock's now → older than 900s staleness.
        fetchedAt: new Date('2026-07-08T22:00:00.000Z'),
        source: 'quidax',
        degraded: false,
      },
    ]);
    const service = new RatesService(
      makeRateProvider(),
      makeRegistry(),
      fixedClock,
      makeConfig({ enabled: true, stalenessSec: 900 }),
      store,
    );

    const result = await service.getEffectiveRate('USDT', 'NGN');
    expect(result.source).toBe('config');
  });
});

// ---------------------------------------------------------------------------
// listEffectiveRates
// ---------------------------------------------------------------------------

describe('RatesService.listEffectiveRates', () => {
  it('returns one entry per enabled tradeable pair and skips unpriced/disabled pairs', async () => {
    const service = new RatesService(
      makeRateProvider(),
      makeRegistry(),
      fixedClock,
      makeConfig(),
    );

    const { rates } = await service.listEffectiveRates();

    // Enabled crypto: USDT, BTC. Enabled fiat: NGN only (USD disabled).
    // USDT/NGN prices; BTC/NGN throws (unpriced) → skipped. USD excluded.
    expect(rates).toHaveLength(1);
    expect(rates[0].asset).toBe('USDT');
    expect(rates[0].fiatCurrency).toBe('NGN');
    // No pair was priced against the DISABLED USD fiat.
    expect(rates.some((r) => r.fiatCurrency === 'USD')).toBe(false);
    // No unpriced BTC pair leaked in.
    expect(rates.some((r) => r.asset === 'BTC')).toBe(false);
  });

  it('returns an empty list (never throws) when no pair can be priced', async () => {
    const provider: IRateProvider = {
      getRate: jest.fn().mockRejectedValue(new Error('nothing priced')),
      getValuationRate: jest.fn().mockResolvedValue({ baseRate: 1 }),
    };
    const service = new RatesService(
      provider,
      makeRegistry(),
      fixedClock,
      makeConfig(),
    );

    const { rates } = await service.listEffectiveRates();
    expect(rates).toEqual([]);
  });

  it('output parses against RateListResponseSchema', async () => {
    const service = new RatesService(
      makeRateProvider(),
      makeRegistry(),
      fixedClock,
      makeConfig(),
    );

    const result = await service.listEffectiveRates();
    expect(() => RateListResponseSchema.parse(result)).not.toThrow();
  });
});
