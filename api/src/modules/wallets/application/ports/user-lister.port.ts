/**
 * DI token + port interface for paging active user IDs in the backfill service.
 *
 * Why a dedicated port here (not importing from identity)?
 *   - The wallets module must NOT import from identity's application or domain
 *     layers (dependency-cruiser forbids cross-feature circular imports).
 *   - This thin port is owned by wallets/application; identity/infrastructure
 *     provides a concrete adapter that queries `User` rows via PrismaService.
 *   - The shape is minimal: only `id` is needed to drive provisioning.
 *
 * Swap seam: any module that can enumerate active user IDs can provide this
 * adapter — identity is the natural owner at launch.
 */
export const USER_LISTER = Symbol('USER_LISTER');

/**
 * Minimal active-user projection needed for the backfill page cursor.
 */
export interface ActiveUserPage {
  /** IDs of active users on this page. */
  ids: string[];
  /**
   * Cursor for the next page (the last id in this page).
   * `null` when this is the final page.
   */
  nextCursor: string | null;
}

/**
 * Port for paging active user IDs.
 * Only the infrastructure layer (e.g. IdentityPrismaRepository) provides an
 * implementation — the application service never knows which adapter is wired.
 */
export interface IUserLister {
  /**
   * Returns a page of active user IDs.
   *
   * @param cursor - Exclusive lower-bound user id (for keyset pagination by id).
   *   Pass `null` to start from the beginning.
   * @param limit - Maximum number of ids to return per page.
   */
  listActiveUserIds(input: {
    cursor: string | null;
    limit: number;
  }): Promise<ActiveUserPage>;
}
