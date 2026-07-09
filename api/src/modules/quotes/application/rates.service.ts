import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  EffectiveRate,
  FiatCurrency,
  RateListResponse,
  SupportedAsset,
} from '@handshake-agent/contracts';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { CLOCK, type Clock } from '../../../core/common/clock';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { PricingFeedConfig } from '../../../core/config/configuration';
import { liveStoreWhenEnabled } from '../../transactions/application/resolve-base-rate';
import { buyEffectiveRate, sellEffectiveRate } from '../domain/quote-pricing';
import { LiveRateStore } from './live-rate.store';
import { RATE_PROVIDER, type IRateProvider } from './ports/rate-provider.port';

/** Fallback staleness window when `pricing.feed` is absent (thin test config). */
const DEFAULT_FEED_STALENESS_SEC = 900;

/**
 * Read-only rate-discovery use-case (Wave K). For a pair it returns BOTH a buy
 * and a sell effective rate — each the base market rate folded with the SAME
 * spread the matching buy/sell quote applies, so the displayed number equals
 * what the deterministic engine transacts at (CLAUDE.md §3.1). It moves no
 * money: pure orchestration over the rate provider + catalog + live-feed seam.
 *
 * The spread is folded into ONE number per direction and is NEVER itemized on
 * the returned shape — the admin console keeps its per-bps view separately.
 *
 * Base-rate source: the RATE_PROVIDER (ConfigRateProvider) already routes the
 * base rate through the shared Wave F seam (live store when fresh, config floor
 * otherwise), so this service's rates are automatically live-or-config identical
 * to the quote/execution paths. `source` reports which one priced the pair by
 * replaying the same kill-switch + freshness decision the seam makes.
 */
@Injectable()
export class RatesService {
  constructor(
    @Inject(RATE_PROVIDER) private readonly rateProvider: IRateProvider,
    private readonly assetRegistry: AssetRegistry,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly config: EffectiveConfigService,
    // @Optional so `source` degrades to 'config' when no live store is wired
    // (parity with the pre-feed behaviour; the seam falls back to config too).
    @Optional() private readonly liveRateStore?: LiveRateStore,
  ) {}

  /**
   * The effective buy + sell rate for one (asset, fiat) pair.
   *
   * @throws when the pair is not fiat-tradeable or has no resolvable base rate
   *   (propagated from the rate provider) — the caller surfaces "rate
   *   unavailable" for that pair.
   */
  async getEffectiveRate(
    asset: SupportedAsset,
    fiatCurrency: FiatCurrency,
  ): Promise<EffectiveRate> {
    const rate = await this.rateProvider.getRate(asset, fiatCurrency);

    // Fold the spread through the EXACT quote helpers (DRY) so the number the
    // user sees is the number the engine trades at.
    const buyRate = buyEffectiveRate(rate.baseRate, rate.buySpreadBps);
    const sellRate = sellEffectiveRate(rate.baseRate, rate.sellSpreadBps);

    return {
      asset,
      fiatCurrency,
      // Money-string convention: carry rates as strings, never floats over the wire.
      buyRate: String(buyRate),
      sellRate: String(sellRate),
      source: this.resolveSource(asset, fiatCurrency),
      asOf: this.clock.now().toISOString(),
    };
  }

  /**
   * Every enabled crypto asset × enabled fiat pair that has a resolvable rate.
   * Pairs the rate provider throws on (not fiat-tradeable / no base rate) are
   * SKIPPED, never propagated — a single unpriced pair must not error the whole
   * discovery list.
   */
  async listEffectiveRates(): Promise<RateListResponse> {
    // Read the HOT-RELOADED registry each call so an admin catalog toggle takes
    // effect immediately (F3) — no boot-time snapshot.
    const assets = this.assetRegistry.enabledCryptoAssets();
    const fiats = this.assetRegistry.enabledFiats();

    const rates: EffectiveRate[] = [];
    for (const asset of assets) {
      for (const fiat of fiats) {
        try {
          // `asset` narrows to the SupportedAsset literal union; `fiat` is
          // already `string` (FiatCurrency infers to string) so no cast needed.
          rates.push(
            await this.getEffectiveRate(asset as SupportedAsset, fiat),
          );
        } catch {
          // Not tradeable / unpriced / misconfigured spread → omit this pair.
          continue;
        }
      }
    }
    return { rates };
  }

  /**
   * Whether the base rate for this pair was priced by the LIVE feed or the
   * config floor. Replays the seam's decision (kill-switch + freshness) so the
   * flag agrees with what `getRate` actually resolved (CLAUDE.md §3.1).
   */
  private resolveSource(
    asset: SupportedAsset,
    fiatCurrency: FiatCurrency,
  ): 'live' | 'config' {
    const feed = this.config.get<PricingFeedConfig | undefined>('pricing.feed');
    const stalenessSec =
      typeof feed?.stalenessSec === 'number'
        ? feed.stalenessSec
        : DEFAULT_FEED_STALENESS_SEC;
    // Honour the admin kill-switch exactly as the base-rate seam does.
    const store = liveStoreWhenEnabled(this.liveRateStore, feed);
    const live =
      store?.getFresh(asset, fiatCurrency, this.clock.now(), stalenessSec) ??
      null;
    return live !== null && live > 0 ? 'live' : 'config';
  }
}
