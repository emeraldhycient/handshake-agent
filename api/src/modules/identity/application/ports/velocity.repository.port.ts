/**
 * Port (interface) for the velocity repository. Infrastructure provides the
 * Prisma adapter; application only knows this symbol and the interface.
 *
 * Dependency rule: application imports this port; infrastructure implements it.
 * No Prisma or DB references here.
 */

export const VELOCITY_REPOSITORY = Symbol('VELOCITY_REPOSITORY');

/** Application-level record — NOT a Prisma-generated type. */
export interface DailyUsage {
  /**
   * Sum of fiat-equivalent amounts transacted in the current 24-h window (NGN),
   * as a decimal string (e.g. "195000.00"). String type to preserve exact decimal
   * precision — callers convert via toScaled() for BigInt comparison (Fix-C).
   */
  fiatTotal: string;
  /** Number of transactions in the current 24-h window. */
  txCount: number;
}

/** Rolling 7-day fiat usage (weekly cap). Amount only — no count cap on the week. */
export interface WeeklyUsage {
  /**
   * Sum of fiat-equivalent amounts transacted in the current rolling 7-day window,
   * as an exact decimal string (same scale/round-trip discipline as DailyUsage).
   */
  fiatTotal: string;
}

export interface IVelocityRepository {
  /**
   * Returns the aggregated fiat total and transaction count for the given user
   * that fall inside the 24-h window ending at `asOf`, scoped to `fiatCurrency`.
   *
   * The window is `[asOf - 24h, asOf]` — uses the VelocityCounter rows whose
   * `windowEnd > (asOf - 24h)` and `windowStart <= asOf`.
   *
   * Only rows for the given `fiatCurrency` are included — no cross-currency
   * aggregation (per-currency isolation added in WN task 10).
   *
   * Returns `{ fiatTotal: '0', txCount: 0 }` when no rows are found.
   */
  getDailyUsage(
    userId: string,
    asOf: Date,
    fiatCurrency: string,
  ): Promise<DailyUsage>;

  /**
   * Returns the aggregated fiat total for the given user inside the rolling 7-day
   * window ending at `asOf`, scoped to `fiatCurrency`. Reads the `amount_7d`
   * VelocityCounter (window `(asOf - 7d, asOf]`). Returns `{ fiatTotal: '0' }` when
   * no active row exists. Required (not optional) so every implementor must provide
   * it — an implementor that forgot it would silently drop weekly enforcement (§3.6).
   */
  getWeeklyUsage(
    userId: string,
    asOf: Date,
    fiatCurrency: string,
  ): Promise<WeeklyUsage>;

  /**
   * Count the user's on-chain (crypto-address) SEND transactions created within the
   * `windowMs` window ending at `asOf` — the rolling-10-minute anti-rapid-fire cap.
   * Counts by actual Transaction rows (all statuses — a rapid burst of attempts is the
   * risk), so it needs no dedicated counter. Required so every implementor provides it
   * (a missing impl would silently drop the cap, §3.6).
   */
  getRecentSendCount(
    userId: string,
    asOf: Date,
    windowMs: number,
  ): Promise<number>;
}
