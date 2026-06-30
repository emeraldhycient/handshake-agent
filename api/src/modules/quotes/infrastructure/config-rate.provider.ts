import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FiatCurrency, SupportedAsset } from '@handshake-agent/contracts';

import type { PricingConfig } from '../../../core/config/configuration';
import type {
  IRateProvider,
  RateQuote,
  ValuationRate,
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

    // Fail-closed: assets with fiatTradeable === false have a baseRate for
    // valuation purposes (wallet balance display) but must NOT be traded in
    // fiat buy/sell flows. Throw here so the buy/sell proposal engine sees an
    // error identical to "no pricing" — no per-asset code needed in callers.
    if (assetPricing.fiatTradeable === false) {
      return Promise.reject(
        new Error(
          `Asset ${asset} is not fiat-tradeable (swap-only); no buy/sell rate available`,
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

  /**
   * Returns a baseRate for display/valuation purposes without enforcing the
   * fiatTradeable gate. Used by wallet balance and portfolio valuation paths.
   * Throws when no baseRate is configured for the asset/fiat pair.
   */
  getValuationRate(
    asset: SupportedAsset,
    fiatCurrency: FiatCurrency,
  ): Promise<ValuationRate> {
    const pricing = this.config.get<PricingConfig>('pricing');
    const assetPricing = pricing?.assets[asset];
    const baseRate = assetPricing?.baseRates?.[fiatCurrency];

    if (!pricing || !assetPricing || baseRate === undefined) {
      return Promise.reject(
        new Error(
          `No valuation rate configured for asset ${asset} in ${fiatCurrency}`,
        ),
      );
    }

    return Promise.resolve({ baseRate });
  }
}
