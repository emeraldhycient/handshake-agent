import type { FiatCurrency, SupportedAsset } from '@handshake-agent/contracts';

/** DI token for the rate source. Infrastructure provides the concrete adapter. */
export const RATE_PROVIDER = Symbol('RATE_PROVIDER');

export interface RateQuote {
  /** Base market rate: fiat per 1 unit of the asset. */
  baseRate: number;
  spreadBps: number;
  processingFeeBps: number;
  expiresInSec: number;
  /** Decimal places the asset is quoted to. */
  cryptoDecimals: number;
}

/**
 * The application depends on this abstraction, never on a concrete pricing
 * client or the DB. Infrastructure implements it (config-driven now, a live
 * pricing feed later) — the use-case never changes.
 */
export interface IRateProvider {
  getRate(
    asset: SupportedAsset,
    fiatCurrency: FiatCurrency,
  ): Promise<RateQuote>;
}
