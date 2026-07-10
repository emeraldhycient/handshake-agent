import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { PricingConfig } from '../../../core/config/configuration';
import type { LiveRateStore } from '../application/live-rate.store';
import { ConfigRateProvider } from './config-rate.provider';

const PRICING: PricingConfig = {
  processingFeeBps: 100,
  expiresInSec: 30,
  assets: {
    USDT: {
      baseRates: { NGN: 1600 },
      buySpreadBps: 150,
      sellSpreadBps: 200,
      cryptoDecimals: 6,
    },
  },
};

const configWith = (pricing: PricingConfig): EffectiveConfigService =>
  ({ get: () => pricing }) as unknown as EffectiveConfigService;

/** Config mock that answers per key (so `pricing.feed` can carry the kill-switch). */
const configForKeys = (map: Record<string, unknown>): EffectiveConfigService =>
  ({ get: (key: string) => map[key] }) as unknown as EffectiveConfigService;

describe('ConfigRateProvider', () => {
  it('returns a rate quote with per-asset buy/sell spreads assembled from config', async () => {
    const provider = new ConfigRateProvider(configWith(PRICING));

    const rate = await provider.getRate('USDT', 'NGN');

    expect(rate).toEqual({
      baseRate: 1600,
      buySpreadBps: 150,
      sellSpreadBps: 200,
      processingFeeBps: 100,
      expiresInSec: 30,
      cryptoDecimals: 6,
    });
  });

  it('returns independent buy and sell spreads (they can differ)', async () => {
    const provider = new ConfigRateProvider(configWith(PRICING));

    const rate = await provider.getRate('USDT', 'NGN');

    // The buy and sell spreads are independently configured — not the same value.
    expect(rate.buySpreadBps).toBe(150);
    expect(rate.sellSpreadBps).toBe(200);
    expect(rate.buySpreadBps).not.toBe(rate.sellSpreadBps);
  });

  it('throws when the asset has no configured pricing', async () => {
    const provider = new ConfigRateProvider(configWith(PRICING));

    await expect(provider.getRate('BTC', 'NGN')).rejects.toThrow(/BTC/);
  });

  it('resolves the per-fiat base rate', async () => {
    const provider = new ConfigRateProvider(configWith(PRICING));

    const rate = await provider.getRate('USDT', 'NGN');

    expect(rate.baseRate).toBe(1600);
  });

  it('fails closed when the asset has no rate for the requested fiat', async () => {
    const provider = new ConfigRateProvider(configWith(PRICING));

    // 'USD' is a known fiat code but has no configured rate here;
    // the runtime path must still reject fail-closed.
    await expect(provider.getRate('USDT', 'USD')).rejects.toThrow(/USD/);
  });

  it('uses a FRESH live-feed base rate over the config fallback (spreads/fees stay config)', async () => {
    // The live store returns a fresh USDT/NGN rate; the quote must use it while
    // buy/sell spreads + processing fee stay sourced from config.
    const store = {
      getFresh: () => 1712,
    } as unknown as LiveRateStore;
    const provider = new ConfigRateProvider(configWith(PRICING), store);

    const rate = await provider.getRate('USDT', 'NGN');

    expect(rate.baseRate).toBe(1712);
    expect(rate.buySpreadBps).toBe(150);
    expect(rate.sellSpreadBps).toBe(200);
    expect(rate.processingFeeBps).toBe(100);
  });

  it('falls back to the config base rate when the live store has nothing fresh', async () => {
    const store = {
      getFresh: () => null,
    } as unknown as LiveRateStore;
    const provider = new ConfigRateProvider(configWith(PRICING), store);

    const rate = await provider.getRate('USDT', 'NGN');

    expect(rate.baseRate).toBe(1600);
  });

  it('still fails closed for an unpriced pair even when a live store is present', async () => {
    const store = { getFresh: () => null } as unknown as LiveRateStore;
    const provider = new ConfigRateProvider(configWith(PRICING), store);

    await expect(provider.getRate('BTC', 'NGN')).rejects.toThrow(/BTC/);
  });

  it('honours the kill-switch: pricing.feed.enabled=false serves the config base rate even with a fresh live rate', async () => {
    // A fresh, in-band live rate (1712) is cached, but the operator flipped the
    // kill-switch off — the quote must revert to the config floor (1600)
    // IMMEDIATELY (config is hot-reloaded), not stalenessSec later.
    const store = { getFresh: () => 1712 } as unknown as LiveRateStore;
    const config = configForKeys({
      pricing: PRICING,
      'pricing.feed': { enabled: false, stalenessSec: 900 },
    });
    const provider = new ConfigRateProvider(config, store);

    const rate = await provider.getRate('USDT', 'NGN');

    expect(rate.baseRate).toBe(1600);
  });

  it('serves the live rate when the feed is enabled (kill-switch on)', async () => {
    const store = { getFresh: () => 1712 } as unknown as LiveRateStore;
    const config = configForKeys({
      pricing: PRICING,
      'pricing.feed': { enabled: true, stalenessSec: 900 },
    });
    const provider = new ConfigRateProvider(config, store);

    const rate = await provider.getRate('USDT', 'NGN');

    expect(rate.baseRate).toBe(1712);
  });

  it('kill-switch also gates the valuation rate (enabled=false → config baseRate)', async () => {
    const store = { getFresh: () => 1712 } as unknown as LiveRateStore;
    const config = configForKeys({
      pricing: PRICING,
      'pricing.feed': { enabled: false, stalenessSec: 900 },
    });
    const provider = new ConfigRateProvider(config, store);

    const rate = await provider.getValuationRate('USDT', 'NGN');

    expect(rate.baseRate).toBe(1600);
  });

  it('reflects a DB AppSetting override of the base rate (EffectiveConfigService flows through)', async () => {
    // An admin override of pricing.assets.USDT.baseRates.NGN must surface in the
    // assembled rate quote, proving get('pricing') resolves the layered config.
    const overridden: PricingConfig = {
      ...PRICING,
      assets: {
        USDT: { ...PRICING.assets.USDT, baseRates: { NGN: 1750 } },
      },
    };
    const provider = new ConfigRateProvider(configWith(overridden));

    const rate = await provider.getRate('USDT', 'NGN');

    expect(rate.baseRate).toBe(1750);
  });
});
