import type { ConfigService } from '@nestjs/config';
import type { PricingConfig } from '../../../core/config/configuration';
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

const configWith = (pricing: PricingConfig): ConfigService =>
  ({ get: () => pricing }) as unknown as ConfigService;

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

    // Cast to FiatCurrency to simulate a future fiat not yet in the config;
    // the runtime path must still reject fail-closed.
    await expect(
      provider.getRate(
        'USDT',
        'USD' as import('@handshake-agent/contracts').FiatCurrency,
      ),
    ).rejects.toThrow(/USD/);
  });
});
