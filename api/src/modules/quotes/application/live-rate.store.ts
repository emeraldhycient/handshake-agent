import { Injectable } from '@nestjs/common';

/**
 * LiveRateStore — the in-memory, per-process cache of live market rates.
 *
 * The scheduled poller (LiveRateService) writes composed, divergence-validated
 * rates here; the single base-rate resolution seam both the quote adapter and
 * the execution engine share (resolveEffectiveBaseRate) reads them. When a pair
 * has no FRESH, non-degraded, strictly-positive entry, the seam falls back to
 * the admin config baseRate — so an empty / cold store is byte-identical to the
 * pre-feed behaviour (fail-open to the admin floor, never to a bad number).
 *
 * Pure state: no framework I/O, no config, no clock — freshness is decided by
 * the `now` / `stalenessSec` the caller passes, keeping it deterministic and
 * unit-testable. Singleton scope (bound in QuotesModule) so the cache persists
 * across requests. Per-process by design: each Nest process (API + worker) runs
 * its own poller and reads its own store; a process whose poller has not run
 * simply serves the config fallback.
 */

/** A cached live rate for one (asset, fiat) pair. */
export interface LiveRate {
  /** Fiat per 1 unit of the asset. */
  rate: number;
  /** When the poller composed this value. */
  fetchedAt: Date;
  /** Which source(s) produced it, e.g. 'quidax' | 'coingecko+erapi'. */
  source: string;
  /**
   * true → the poller rejected this tick's value (divergence over the admin
   * band, or an upstream source failed) and this entry must NOT be trusted:
   * getFresh returns null so the money path falls back to the config baseRate.
   */
  degraded: boolean;
}

/** Bulk-set input row (asset+fiat identify the pair). */
export interface LiveRateInput extends LiveRate {
  asset: string;
  fiat: string;
}

/** Per-source liveness recorded by the poller for the operator health card. */
export interface SourceHealth {
  source: string;
  ok: boolean;
  checkedAt: Date;
  /** Failure detail when `ok === false`. */
  error?: string;
}

/** A point-in-time health summary of the whole feed (system-health card + warn logs). */
export interface LiveRateFeedHealth {
  status: 'ok' | 'degraded' | 'down';
  /** Entries that are non-degraded, positive, and within the staleness window. */
  freshCount: number;
  /** Total (asset, fiat) entries currently held. */
  totalCount: number;
  /** Entries explicitly marked degraded by the last tick. */
  degradedCount: number;
  /** Source keys whose last fetch failed. */
  sourcesDown: string[];
  /** Most recent `fetchedAt` across all entries, or null when the store is cold. */
  lastFetchedAt: Date | null;
  /** Age (ms) of the most recent fetch relative to `now`, or null when cold. */
  lastFetchAgeMs: number | null;
}

@Injectable()
export class LiveRateStore {
  private readonly rates = new Map<string, LiveRate>();
  private readonly sources = new Map<string, SourceHealth>();

  private key(asset: string, fiat: string): string {
    return `${asset}:${fiat}`;
  }

  /**
   * The FRESH live rate for a pair, or null when it is unknown / stale /
   * degraded / non-positive. Never throws. A null return is the signal for the
   * seam to fall back to the admin config baseRate.
   */
  getFresh(
    asset: string,
    fiat: string,
    now: Date,
    stalenessSec: number,
  ): number | null {
    const entry = this.rates.get(this.key(asset, fiat));
    if (!entry || entry.degraded) return null;
    // A 0 / negative / NaN rate would zero (or corrupt) the fiat-equivalent used
    // by the KYC / velocity / Travel-Rule gate — never serve it (§3.1 / §3.3).
    if (!(entry.rate > 0)) return null;
    const ageMs = now.getTime() - entry.fetchedAt.getTime();
    if (ageMs > stalenessSec * 1000) return null;
    return entry.rate;
  }

  /** Read the raw entry for a pair (health / diagnostics), or undefined. */
  get(asset: string, fiat: string): LiveRate | undefined {
    return this.rates.get(this.key(asset, fiat));
  }

  /** Bulk-upsert composed rates (one tick's output). */
  setRates(inputs: readonly LiveRateInput[]): void {
    for (const input of inputs) {
      this.rates.set(this.key(input.asset, input.fiat), {
        rate: input.rate,
        fetchedAt: input.fetchedAt,
        source: input.source,
        degraded: input.degraded,
      });
    }
  }

  /** Bulk-upsert per-source liveness for the health card. */
  setSourceHealth(health: readonly SourceHealth[]): void {
    for (const entry of health) {
      this.sources.set(entry.source, { ...entry });
    }
  }

  /**
   * Summarise feed health as of `now`. Pure — the caller supplies the staleness
   * window (config-driven). Used by the operator system-health card and to
   * decide whether to log a warn on a tick.
   */
  healthSnapshot(now: Date, stalenessSec: number): LiveRateFeedHealth {
    const entries = [...this.rates.values()];
    const totalCount = entries.length;
    const degradedCount = entries.filter((e) => e.degraded).length;
    const freshCount = entries.filter(
      (e) =>
        !e.degraded &&
        e.rate > 0 &&
        now.getTime() - e.fetchedAt.getTime() <= stalenessSec * 1000,
    ).length;
    const sourcesDown = [...this.sources.values()]
      .filter((s) => !s.ok)
      .map((s) => s.source);

    const lastFetchedAt =
      entries.length === 0
        ? null
        : entries.reduce<Date>(
            (max, e) => (e.fetchedAt > max ? e.fetchedAt : max),
            entries[0].fetchedAt,
          );
    const lastFetchAgeMs =
      lastFetchedAt === null ? null : now.getTime() - lastFetchedAt.getTime();

    let status: LiveRateFeedHealth['status'];
    if (totalCount === 0 || freshCount === 0) {
      status = 'down';
    } else if (
      freshCount === totalCount &&
      degradedCount === 0 &&
      sourcesDown.length === 0
    ) {
      status = 'ok';
    } else {
      status = 'degraded';
    }

    return {
      status,
      freshCount,
      totalCount,
      degradedCount,
      sourcesDown,
      lastFetchedAt,
      lastFetchAgeMs,
    };
  }
}
