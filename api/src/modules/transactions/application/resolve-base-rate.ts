import type { PricingConfig } from '../../../core/config/configuration';

import { BaseRateMisconfiguredError } from '../domain/execution-errors';

/**
 * The minimal read surface the base-rate seam needs from the live-rate cache.
 * Declared here (not imported from the quotes module) so this pure helper stays
 * free of cross-module coupling; LiveRateStore satisfies it structurally.
 */
export interface LiveRateReader {
  /** Fresh live rate for the pair, or null when unknown / stale / degraded. */
  getFresh(
    asset: string,
    fiat: string,
    now: Date,
    stalenessSec: number,
  ): number | null;
}

/**
 * The live-rate store the money path should consult, honouring the admin
 * kill-switch (`pricing.feed.enabled`). Returns `null` the MOMENT the flag is
 * false so {@link resolveEffectiveBaseRate} reverts to the config floor
 * immediately — config is hot-reloaded, so the switch takes effect on the very
 * next read rather than `stalenessSec` later once the poller's last-written live
 * entries age out. This is what makes the documented contract true ("Off → the
 * money path uses the config baseRates instead of live rates"): the poller only
 * stops WRITING on disable, so without this read-side gate the cached live rates
 * would keep pricing buy/sell/send/swap for the whole staleness window.
 *
 * An absent feed block leaves the store in play (parity with pre-kill-switch
 * behaviour; the poller writes nothing when the feed is absent, so in production
 * the store is empty anyway and the config fallback is reached regardless).
 */
export function liveStoreWhenEnabled<T extends LiveRateReader>(
  store: T | null | undefined,
  feed: { enabled?: boolean } | undefined,
): T | null {
  if (feed?.enabled === false) return null;
  return store ?? null;
}

/**
 * THE single base-rate resolution seam shared by the quote adapter
 * (ConfigRateProvider) and the execution engine (ProposalService /
 * ExecutionService / mock-swap cross-rate). It resolves the per-fiat baseRate
 * for an asset as:
 *
 *   1. the LIVE feed rate when the store has a fresh, non-degraded, positive
 *      value for the pair (LiveRateService validates freshness + divergence vs
 *      the config floor before writing), else
 *   2. the admin config `baseRates.<fiat>` fallback (the kill-switch / floor).
 *
 * Routing BOTH the quote and the execution re-quote through this one seam is
 * what keeps them in agreement: a feed wired only behind the quote adapter would
 * make quotes live while execution re-quotes stayed on config → drift-check
 * failures and a wrong KYC fiat-equivalent (CLAUDE.md §3.1 / §3.3).
 *
 * Fail-closed: when NEITHER a fresh live rate NOR a positive config baseRate
 * exists it throws — a 0 / negative / missing rate would zero the fiat-
 * equivalent and silently bypass the KYC / velocity / Travel-Rule money gate.
 * An empty / absent store is byte-identical to reading the config directly.
 *
 * @returns the effective, strictly-positive baseRate.
 * @throws {BaseRateMisconfiguredError} when neither a fresh live rate nor a
 *   positive config baseRate is available.
 */
export function resolveEffectiveBaseRate(
  pricingConfig: PricingConfig | undefined,
  liveStore: LiveRateReader | null | undefined,
  asset: string,
  fiat: string,
  now: Date,
  stalenessSec: number,
): number {
  const live = liveStore?.getFresh(asset, fiat, now, stalenessSec) ?? null;
  if (live !== null && live > 0) {
    return live;
  }

  const baseRate = pricingConfig?.assets?.[asset]?.baseRates?.[fiat];
  if (!baseRate || baseRate <= 0) {
    throw new BaseRateMisconfiguredError(asset, fiat);
  }
  return baseRate;
}

/**
 * Config-only base-rate resolution — the fail-closed money-gate guard. Retained
 * as a thin wrapper over {@link resolveEffectiveBaseRate} with no live store, so
 * call sites that intentionally ignore the live feed (and the existing unit
 * suite) keep identical semantics: live store absent → the config fallback.
 *
 * @returns the validated, strictly-positive baseRate.
 * @throws {BaseRateMisconfiguredError} when the rate is absent / 0 / negative.
 */
export function resolveBaseRate(
  pricingConfig: PricingConfig | undefined,
  asset: string,
  fiat: string,
): number {
  return resolveEffectiveBaseRate(
    pricingConfig,
    null,
    asset,
    fiat,
    new Date(),
    0,
  );
}
