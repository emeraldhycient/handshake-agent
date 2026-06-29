import type { FiatCurrency, SupportedAsset } from '@handshake-agent/contracts';

/** DI token for the rate source. Infrastructure provides the concrete adapter. */
export const RATE_PROVIDER = Symbol('RATE_PROVIDER');

export interface RateQuote {
  /** Base market rate: fiat per 1 unit of the asset. */
  baseRate: number;
  /** Platform spread applied to BUY quotes (marks up the rate; user gets less crypto). */
  buySpreadBps: number;
  /** Platform spread applied to SELL quotes (marks down the rate; user gets less fiat). */
  sellSpreadBps: number;
  processingFeeBps: number;
  expiresInSec: number;
  /** Decimal places the asset is quoted to. */
  cryptoDecimals: number;
}

/**
 * Minimal rate needed for fiat valuation display (e.g. wallet balance page).
 * Intentionally excludes spread fields — this is not a tradeable quote, only
 * a display approximation so the user can see portfolio value.
 */
export interface ValuationRate {
  /** Base mid-market rate: fiat per 1 unit of the asset. */
  baseRate: number;
}

/**
 * The application depends on this abstraction, never on a concrete pricing
 * client or the DB. Infrastructure implements it (config-driven now, a live
 * pricing feed later) — the use-case never changes.
 */
export interface IRateProvider {
  /**
   * Returns a full tradeable RateQuote for the asset/fiat pair.
   * @throws when the asset has no configured pricing or is not fiat-tradeable
   *   (e.g. swap-only assets like TRX). Callers that only need display valuation
   *   should use `getValuationRate` instead.
   */
  getRate(
    asset: SupportedAsset,
    fiatCurrency: FiatCurrency,
  ): Promise<RateQuote>;

  /**
   * Returns a ValuationRate for display purposes (wallet balance page).
   * Unlike `getRate`, this method does NOT enforce the fiatTradeable gate —
   * it returns a baseRate even for swap-only assets (e.g. TRX) so the
   * portfolio value can be displayed without enabling fiat buy/sell.
   *
   * @throws when the asset has no baseRate configured for the fiat (truly unpriced).
   */
  getValuationRate(
    asset: SupportedAsset,
    fiatCurrency: FiatCurrency,
  ): Promise<ValuationRate>;
}
