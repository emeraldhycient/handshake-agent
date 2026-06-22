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
  /** Sum of fiat-equivalent amounts transacted in the current 24-h window (NGN). */
  fiatTotal: number;
  /** Number of transactions in the current 24-h window. */
  txCount: number;
}

export interface IVelocityRepository {
  /**
   * Returns the aggregated fiat total and transaction count for the given user
   * that fall inside the 24-h window ending at `asOf`.
   *
   * The window is `[asOf - 24h, asOf]` — uses the VelocityCounter rows whose
   * `windowEnd > (asOf - 24h)` and `windowStart <= asOf`.
   *
   * Returns `{ fiatTotal: 0, txCount: 0 }` when no rows are found.
   */
  getDailyUsage(userId: string, asOf: Date): Promise<DailyUsage>;
}
