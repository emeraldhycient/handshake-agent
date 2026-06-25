import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FiatCurrency, SupportedAsset } from '@handshake-agent/contracts';

import type { PricingConfig } from '../../../core/config/configuration';
import type {
  IRateProvider,
  RateQuote,
} from '../application/ports/rate-provider.port';

/**
 * Config-driven rate source: assembles a RateQuote from the layered config.
 * Swap this binding for a live pricing-feed adapter without touching the
 * application layer — that is the point of the IRateProvider port.
 */
@Injectable()
export class ConfigRateProvider implements IRateProvider {
  constructor(private readonly config: ConfigService) {}

  getRate(
    asset: SupportedAsset,
    fiatCurrency: FiatCurrency,
  ): Promise<RateQuote> {
    const pricing = this.config.get<PricingConfig>('pricing');
    const assetPricing = pricing?.assets[asset];
    const baseRate = assetPricing?.baseRates?.[fiatCurrency];

    if (!pricing || !assetPricing || baseRate === undefined) {
      return Promise.reject(
        new Error(
          `No pricing configured for asset ${asset} in ${fiatCurrency}`,
        ),
      );
    }

    return Promise.resolve({
      baseRate,
      buySpreadBps: assetPricing.buySpreadBps,
      sellSpreadBps: assetPricing.sellSpreadBps,
      processingFeeBps: pricing.processingFeeBps,
      expiresInSec: pricing.expiresInSec,
      cryptoDecimals: assetPricing.cryptoDecimals,
    });
  }
}
