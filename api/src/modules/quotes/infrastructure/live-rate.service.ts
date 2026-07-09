import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';

import { CLOCK, type Clock } from '../../../core/common/clock';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type {
  PricingConfig,
  PricingFeedConfig,
} from '../../../core/config/configuration';
import type { Env } from '../../../core/config/env.schema';
import {
  LiveRateStore,
  type LiveRateInput,
  type SourceHealth,
} from '../application/live-rate.store';

/** Per-request HTTP timeout for a source fetch (ms). */
const FETCH_TIMEOUT_MS = 6_000;
/** Named scheduler interval so it can be cleared on shutdown. */
const INTERVAL_NAME = 'pricing-feed-poll';

/**
 * The three source keys, surfaced in SourceHealth + the system-health note.
 * `erapi` = open.er-api.com (the USD→fiat legs).
 */
const SOURCE = {
  coingecko: 'coingecko',
  erapi: 'erapi',
  quidax: 'quidax',
} as const;

// ---------------------------------------------------------------------------
// Pure composition + divergence validation (unit-tested without HTTP)
// ---------------------------------------------------------------------------

/** Raw per-source values one tick fetched (null = that source was unavailable). */
export interface FetchedSources {
  /** CoinGecko USD price per asset symbol. */
  coingeckoUsd: Record<string, number> | null;
  /** open.er-api.com USD→fiat rates keyed by fiat code. */
  fx: Record<string, number> | null;
  /** Quidax local USDT/NGN last price. */
  quidaxUsdtNgn: number | null;
}

interface DerivedRate {
  rate: number | null;
  source: string;
}

/**
 * Derive one (asset, fiat) live rate from the fetched sources:
 *   - USDT/NGN uses the Quidax local ticker when present (the on-ground rate),
 *   - USD legs use the CoinGecko USD price directly (no FX),
 *   - every other fiat is CoinGecko-USD × er-api USD→fiat.
 * Returns rate=null when a required source is unavailable (→ degraded).
 */
function deriveRate(
  asset: string,
  fiat: string,
  sources: FetchedSources,
): DerivedRate {
  if (
    asset === 'USDT' &&
    fiat === 'NGN' &&
    typeof sources.quidaxUsdtNgn === 'number' &&
    sources.quidaxUsdtNgn > 0
  ) {
    return { rate: sources.quidaxUsdtNgn, source: SOURCE.quidax };
  }

  const usd = sources.coingeckoUsd?.[asset];
  if (!(typeof usd === 'number' && usd > 0)) {
    return { rate: null, source: SOURCE.coingecko };
  }
  if (fiat === 'USD') {
    return { rate: usd, source: SOURCE.coingecko };
  }

  const fx = sources.fx?.[fiat];
  if (!(typeof fx === 'number' && fx > 0)) {
    return { rate: null, source: `${SOURCE.coingecko}+${SOURCE.erapi}` };
  }
  return { rate: usd * fx, source: `${SOURCE.coingecko}+${SOURCE.erapi}` };
}

/**
 * Compose the tick's rate rows. A row is produced ONLY for pairs that have a
 * positive config-floor baseRate — that floor is BOTH the divergence anchor and
 * the fallback, so we never inject an unvalidated rate for an unpriced pair
 * (which must keep failing closed). A row is marked `degraded` (→ config
 * fallback on the money path) when the source is unavailable, the rate is
 * non-positive, or it diverges from the floor by more than `divergenceBps`.
 */
export function composeLiveRates(
  feed: PricingFeedConfig,
  pricing: PricingConfig | undefined,
  now: Date,
  sources: FetchedSources,
): LiveRateInput[] {
  const configAssets = pricing?.assets ?? {};
  const rows: LiveRateInput[] = [];

  for (const asset of Object.keys(feed.coingecko.ids)) {
    for (const fiat of feed.fiats) {
      const configBase = configAssets[asset]?.baseRates?.[fiat];
      if (!(typeof configBase === 'number' && configBase > 0)) continue;

      const { rate, source } = deriveRate(asset, fiat, sources);
      if (rate === null || !(rate > 0)) {
        rows.push({
          asset,
          fiat,
          rate: configBase,
          fetchedAt: now,
          source,
          degraded: true,
        });
        continue;
      }

      const divBps = (Math.abs(rate - configBase) / configBase) * 10_000;
      const degraded = divBps > feed.divergenceBps;
      rows.push({
        asset,
        fiat,
        // Keep the config fallback as the stored value when rejected so a
        // diagnostic read never shows the bad print as authoritative.
        rate: degraded ? configBase : rate,
        fetchedAt: now,
        source,
        degraded,
      });
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// LiveRateService — the scheduled poller
// ---------------------------------------------------------------------------

/**
 * LiveRateService — polls CoinGecko (crypto USD prices), Quidax (local USDT/NGN)
 * and open.er-api.com (USD→fiat legs), composes per-(asset, fiat) rates,
 * validates freshness + divergence vs the admin config floor, and writes the
 * survivors into the process-local LiveRateStore that the base-rate seam reads.
 *
 * NO mock mode: the poller always runs, gated ONLY by the admin
 * `pricing.feed.enabled` kill-switch. Sources are hit through the injected
 * HttpService (the Flutterwave/Blockradar axios pattern) so tests fake HTTP;
 * there is no PRICING_FEED_MOCK_MODE. It moves NO money (§3.1) — it only refreshes
 * a cache the deterministic engine reads, and every value is bounded by the admin
 * divergence band before it can be trusted.
 */
@Injectable()
export class LiveRateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveRateService.name);
  private isRunning = false;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<Env, true>,
    private readonly effectiveConfig: EffectiveConfigService,
    private readonly store: LiveRateStore,
    private readonly schedulerRegistry: SchedulerRegistry,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  /**
   * Schedule the poll interval from `pricing.feed.pollIntervalSec`. Skipped under
   * NODE_ENV=test so unit/e2e suites never make real network calls (they drive
   * tick() directly with a faked HttpService). The interval always schedules
   * (independent of `enabled`) so a runtime kill-switch flip re-activates polling
   * without a restart — tick() re-checks `enabled` each run.
   */
  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;

    const feed = this.effectiveConfig.get<PricingFeedConfig | undefined>(
      'pricing.feed',
    );
    const pollIntervalSec =
      typeof feed?.pollIntervalSec === 'number' && feed.pollIntervalSec > 0
        ? feed.pollIntervalSec
        : 300;

    if (this.schedulerRegistry.doesExist('interval', INTERVAL_NAME)) return;
    const handle = setInterval(() => {
      void this.tick().catch((err: unknown) => {
        this.logger.error({ err }, '[pricing-feed] tick threw');
      });
    }, pollIntervalSec * 1000);
    this.schedulerRegistry.addInterval(INTERVAL_NAME, handle);
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', INTERVAL_NAME)) {
      this.schedulerRegistry.deleteInterval(INTERVAL_NAME);
    }
  }

  /**
   * One poll cycle: fetch each source independently (one failing must not abort
   * the others), compose + validate, write to the store, and warn on any
   * degraded/stale/source-down state. Public so tests drive it directly.
   */
  async tick(): Promise<void> {
    const feed = this.effectiveConfig.get<PricingFeedConfig | undefined>(
      'pricing.feed',
    );
    // Kill-switch (admin, hot-reloaded): do nothing → the seam serves config rates.
    if (!feed || !feed.enabled) return;

    if (this.isRunning) {
      this.logger.warn('[pricing-feed] previous tick still running — skipping');
      return;
    }
    this.isRunning = true;

    try {
      const pricing = this.effectiveConfig.get<PricingConfig>('pricing');
      const now = this.clock.now();

      const [coingeckoRes, fxRes, quidaxRes] = await Promise.allSettled([
        this.fetchCoingeckoUsd(feed),
        this.fetchExchangeRates(feed),
        this.fetchQuidaxUsdtNgn(feed),
      ]);

      const coingeckoUsd =
        coingeckoRes.status === 'fulfilled' ? coingeckoRes.value : null;
      const fx = fxRes.status === 'fulfilled' ? fxRes.value : null;
      const quidaxUsdtNgn =
        quidaxRes.status === 'fulfilled' ? quidaxRes.value : null;

      const sourceHealth: SourceHealth[] = [
        this.sourceHealthOf(SOURCE.coingecko, coingeckoRes, now),
        this.sourceHealthOf(SOURCE.erapi, fxRes, now),
        this.sourceHealthOf(SOURCE.quidax, quidaxRes, now),
      ];

      const rows = composeLiveRates(feed, pricing, now, {
        coingeckoUsd,
        fx,
        quidaxUsdtNgn,
      });

      this.store.setRates(rows);
      this.store.setSourceHealth(sourceHealth);

      const health = this.store.healthSnapshot(now, feed.stalenessSec);
      if (health.status !== 'ok') {
        this.logger.warn(
          `[pricing-feed] ${health.status}: fresh ${health.freshCount}/${health.totalCount}, ` +
            `degraded ${health.degradedCount}, sourcesDown [${health.sourcesDown.join(', ')}]`,
        );
      }
    } finally {
      this.isRunning = false;
    }
  }

  // -------------------------------------------------------------------------
  // Source fetchers (injected HttpService → tests fake HTTP; no mock-mode flag)
  // -------------------------------------------------------------------------

  private async fetchCoingeckoUsd(
    feed: PricingFeedConfig,
  ): Promise<Record<string, number>> {
    const baseUrl = this.config.get('COINGECKO_BASE_URL', { infer: true });
    const apiKey = this.config.get('COINGECKO_API_KEY', { infer: true });
    const ids = Object.values(feed.coingecko.ids).join(',');
    const params: Record<string, string> = { ids, vs_currencies: 'usd' };
    if (apiKey) params.x_cg_demo_api_key = apiKey;

    try {
      const res = await firstValueFrom(
        this.http.get<Record<string, { usd?: number }>>(
          `${baseUrl}/simple/price`,
          { params, timeout: FETCH_TIMEOUT_MS },
        ),
      );
      const body = res.data ?? {};
      const bySymbol: Record<string, number> = {};
      for (const [symbol, coinId] of Object.entries(feed.coingecko.ids)) {
        const usd = body[coinId]?.usd;
        if (typeof usd === 'number' && usd > 0) bySymbol[symbol] = usd;
      }
      return bySymbol;
    } catch (err: unknown) {
      throw this.wrapError('coingecko', err);
    }
  }

  private async fetchExchangeRates(
    feed: PricingFeedConfig,
  ): Promise<Record<string, number>> {
    const baseUrl = this.config.get('EXCHANGERATE_BASE_URL', { infer: true });
    try {
      const res = await firstValueFrom(
        this.http.get<{ result?: string; rates?: Record<string, number> }>(
          `${baseUrl}/latest/${feed.exchangerate.base}`,
          { timeout: FETCH_TIMEOUT_MS },
        ),
      );
      const body = res.data ?? {};
      if (typeof body.result === 'string' && body.result !== 'success') {
        throw new Error(`open.er-api result=${body.result}`);
      }
      return body.rates ?? {};
    } catch (err: unknown) {
      throw this.wrapError('erapi', err);
    }
  }

  private async fetchQuidaxUsdtNgn(
    feed: PricingFeedConfig,
  ): Promise<number | null> {
    const baseUrl = this.config.get('QUIDAX_BASE_URL', { infer: true });
    try {
      const res = await firstValueFrom(
        this.http.get<{ data?: { ticker?: { last?: string | number } } }>(
          `${baseUrl}/markets/tickers/${feed.quidax.market}`,
          { timeout: FETCH_TIMEOUT_MS },
        ),
      );
      const last = res.data?.data?.ticker?.last;
      const value =
        typeof last === 'string'
          ? parseFloat(last)
          : typeof last === 'number'
            ? last
            : NaN;
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch (err: unknown) {
      throw this.wrapError('quidax', err);
    }
  }

  private sourceHealthOf(
    source: string,
    result: PromiseSettledResult<unknown>,
    now: Date,
  ): SourceHealth {
    if (result.status === 'fulfilled') {
      return { source, ok: true, checkedAt: now };
    }
    return {
      source,
      ok: false,
      checkedAt: now,
      error:
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
    };
  }

  private wrapError(source: string, err: unknown): Error {
    const axiosErr = err as AxiosError;
    const status = axiosErr?.response?.status;
    if (status !== undefined) {
      return new Error(`pricing-feed ${source} error (HTTP ${status})`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
