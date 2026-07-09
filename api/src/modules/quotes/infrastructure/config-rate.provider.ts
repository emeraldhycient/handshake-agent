import { Injectable, Optional } from '@nestjs/common';
import type { FiatCurrency, SupportedAsset } from '@handshake-agent/contracts';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type {
  PricingConfig,
  PricingFeedConfig,
} from '../../../core/config/configuration';
import {
  liveStoreWhenEnabled,
  resolveEffectiveBaseRate,
} from '../../transactions/application/resolve-base-rate';
import { LiveRateStore } from '../application/live-rate.store';
import type {
  IRateProvider,
  RateQuote,
  ValuationRate,
} from '../application/ports/rate-provider.port';

/** Fallback staleness window when `pricing.feed` is absent (e.g. thin test config). */
const DEFAULT_FEED_STALENESS_SEC = 900;

/**
 * Config-driven rate source: assembles a RateQuote from the layered config,
 * with the base rate sourced through the shared live-feed seam
 * (resolveEffectiveBaseRate) — a fresh live rate when available, else the admin
 * config `baseRates` fallback. Spreads / fees / the fiatTradeable gate stay on
 * config exactly as before; ONLY the base-rate source changed, so the quote and
 * the execution re-quote (which routes through the SAME seam) always agree
 * (CLAUDE.md §3.1). An absent live store is byte-identical to reading config.
 */
@Injectable()
export class ConfigRateProvider implements IRateProvider {
  constructor(
    private readonly config: EffectiveConfigService,
    // @Optional so this adapter (and its existing unit suite) resolves the
    // config fallback when no store is wired — parity with pre-feed behaviour.
    @Optional() private readonly liveRateStore?: LiveRateStore,
  ) {}

  getRate(
    asset: SupportedAsset,
    fiatCurrency: FiatCurrency,
  ): Promise<RateQuote> {
    const pricing = this.config.get<PricingConfig>('pricing');
    const assetPricing = pricing?.assets[asset];
    const configBaseRate = assetPricing?.baseRates?.[fiatCurrency];

    // Guard order preserved: "no configured pricing" rejects first, identically.
    if (!pricing || !assetPricing || configBaseRate === undefined) {
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

    // Only the base-rate SOURCE changes: live feed when fresh, else the config
    // fallback we just confirmed exists. Spreads / fees stay on config.
    const baseRate = resolveEffectiveBaseRate(
      pricing,
      this.effectiveLiveStore(),
      asset,
      fiatCurrency,
      new Date(),
      this.feedStalenessSec(),
    );

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
    const configBaseRate = assetPricing?.baseRates?.[fiatCurrency];

    if (!pricing || !assetPricing || configBaseRate === undefined) {
      return Promise.reject(
        new Error(
          `No valuation rate configured for asset ${asset} in ${fiatCurrency}`,
        ),
      );
    }

    const baseRate = resolveEffectiveBaseRate(
      pricing,
      this.effectiveLiveStore(),
      asset,
      fiatCurrency,
      new Date(),
      this.feedStalenessSec(),
    );

    return Promise.resolve({ baseRate });
  }

  /** Staleness window (seconds) from config, defaulting when `pricing.feed` is absent. */
  private feedStalenessSec(): number {
    const feed = this.config.get<PricingFeedConfig | undefined>('pricing.feed');
    return typeof feed?.stalenessSec === 'number'
      ? feed.stalenessSec
      : DEFAULT_FEED_STALENESS_SEC;
  }

  /** The live store honouring the admin kill-switch (null the moment enabled=false). */
  private effectiveLiveStore(): LiveRateStore | null {
    const feed = this.config.get<PricingFeedConfig | undefined>('pricing.feed');
    return liveStoreWhenEnabled(this.liveRateStore, feed);
  }
}
