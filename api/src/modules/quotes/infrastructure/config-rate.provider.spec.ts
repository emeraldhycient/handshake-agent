import type { ConfigService } from '@nestjs/config';
import type { PricingConfig } from '../../../core/config/configuration';
import { ConfigRateProvider } from './config-rate.provider';

const PRICING: PricingConfig = {
  spreadBps: 150,
  processingFeeBps: 100,
  expiresInSec: 30,
  assets: { USDT: { baseRate: 1600, cryptoDecimals: 6 } },
};

const configWith = (pricing: PricingConfig): ConfigService =>
  ({ get: () => pricing }) as unknown as ConfigService;

describe('ConfigRateProvider', () => {
  it('returns a rate quote assembled from config for a supported asset', async () => {
    const provider = new ConfigRateProvider(configWith(PRICING));

    const rate = await provider.getRate('USDT', 'NGN');

    expect(rate).toEqual({
      baseRate: 1600,
      spreadBps: 150,
      processingFeeBps: 100,
      expiresInSec: 30,
      cryptoDecimals: 6,
    });
  });

  it('throws when the asset has no configured pricing', async () => {
    const provider = new ConfigRateProvider(configWith(PRICING));

    await expect(provider.getRate('BTC', 'NGN')).rejects.toThrow(/BTC/);
  });
});
