/**
 * JSON-defaults layer of the layered config (root CLAUDE.md §7). These are the
 * committed baseline values; env overrides infra/secrets and the DB-admin layer
 * (not built yet) overrides business-tunable values at runtime.
 *
 * NOTE: `baseRate` here is a placeholder default — production replaces the
 * ConfigRateProvider with a live pricing-feed adapter. `spreadBps` /
 * `processingFeeBps` are genuinely admin-tunable and belong in config.
 */
export interface AssetPricing {
  baseRate: number;
  cryptoDecimals: number;
}

export interface PricingConfig {
  spreadBps: number;
  processingFeeBps: number;
  expiresInSec: number;
  assets: Record<string, AssetPricing>;
}

export interface AppConfig {
  pricing: PricingConfig;
}

export default (): AppConfig => ({
  pricing: {
    spreadBps: 150,
    processingFeeBps: 100,
    expiresInSec: 30,
    assets: {
      USDT: { baseRate: 1600, cryptoDecimals: 6 },
      BTC: { baseRate: 100_000_000, cryptoDecimals: 8 },
    },
  },
});
