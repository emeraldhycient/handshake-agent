/**
 * Config-driven minimum-amount floors for the proposal use-cases (findings #3/#4).
 *
 * Pure domain — no Nest, no Prisma. The minimums are admin-tunable (root §7):
 * they are read from the `pricing` config section's OPTIONAL `minBuyFiat` /
 * `minCryptoAmount` keys, falling back to documented defaults when absent so the
 * floor is enforced even before the config keys are seeded. Returning decimal
 * STRINGS (never floats) lets callers compare BigInt-exact via `toScaled`.
 *
 * NOTE (cross-layer): the canonical home for these keys is the `PricingConfig`
 * interface + JSON defaults in `api/src/core/config/configuration.ts`. Adding
 * them there (typed, with seed values) is tracked as a cross-layer need; this
 * resolver reads them through a narrow optional shape so the guard is live now.
 */

/**
 * Default minimum fiat amount for a buy when no per-fiat override is configured.
 * 100 (e.g. ₦100) — comfortably above the dust threshold where the processing
 * fee + sub-cent crypto rounding make the trade economically degenerate.
 */
export const DEFAULT_MIN_BUY_FIAT = '100';

/**
 * Default minimum crypto amount for sell/send/swap when no per-asset override is
 * configured. 0.000001 is the smallest non-dust unit at 6-dp asset precision and
 * still leaves the explicit fee-coverage check (send) to reject fee-dwarfing
 * amounts; admins raise this per asset via config.
 */
export const DEFAULT_MIN_CRYPTO = '0.000001';

/** Operations whose amount is denominated in crypto (vs fiat for buy). */
export type CryptoFloorOperation = 'sell' | 'send' | 'swap';

/**
 * Narrow read-shape over the optional minimum-amount keys in the pricing config.
 * Both maps are keyed by fiat code / asset symbol; absent entries fall back to
 * the documented defaults above.
 */
export interface AmountFloorConfig {
  /** Per-fiat minimum buy amount, in major fiat units (e.g. { NGN: 500 }). */
  minBuyFiat?: Record<string, number>;
  /** Per-operation, per-asset minimum crypto amount (e.g. { send: { USDT: 0.5 } }). */
  minCryptoAmount?: Partial<
    Record<CryptoFloorOperation, Record<string, number>>
  >;
}

/** Resolves the minimum buy amount (decimal string) for a fiat currency. */
export function resolveMinBuyFiat(
  pricing: AmountFloorConfig | undefined,
  fiatCurrency: string,
): string {
  const configured = pricing?.minBuyFiat?.[fiatCurrency];
  return configured !== undefined ? String(configured) : DEFAULT_MIN_BUY_FIAT;
}

/** Resolves the minimum crypto amount (decimal string) for an operation + asset. */
export function resolveMinCryptoAmount(
  pricing: AmountFloorConfig | undefined,
  operation: CryptoFloorOperation,
  asset: string,
): string {
  const configured = pricing?.minCryptoAmount?.[operation]?.[asset];
  return configured !== undefined ? String(configured) : DEFAULT_MIN_CRYPTO;
}
