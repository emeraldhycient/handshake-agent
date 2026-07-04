/**
 * Repository port for PIN state (task 4.3). PinService depends on this
 * interface, never on PrismaPinRepository directly (clean-arch §4.1).
 *
 * The DI token PIN_REPOSITORY is injected by AuthModule; the infrastructure
 * binding is PinPrismaRepository.
 */

export const PIN_REPOSITORY = Symbol('PIN_REPOSITORY');

/** Snapshot of the PIN-related fields on a User row. */
export interface PinState {
  /** Null when the user has never set a PIN. */
  pinHash: string | null;
  pinFailureCount: number;
  pinLockedUntil: Date | null;
}

/** Read/write contract for PIN persistence. */
export interface IPinRepository {
  /**
   * Loads PIN state for the given user id.
   * Returns null when no User row exists (distinct from a row with no PIN set).
   */
  getPinState(userId: string): Promise<PinState | null>;

  /** Persists a new hash (call after hashing a new PIN). */
  setPinHash(userId: string, pinHash: string): Promise<void>;

  /**
   * Registers a single failed-verify attempt and returns the resulting counter
   * state. This MUST be executed as ONE atomic SQL statement that, evaluated
   * against the row's current `pinLockedUntil`:
   *   - if a lockout window has EXPIRED (`pinLockedUntil` in the past) → starts a
   *     fresh window: sets `pinFailureCount = 1` and clears `pinLockedUntil`;
   *   - otherwise → increments `pinFailureCount` by 1;
   *   - if a lock is still ACTIVE (`pinLockedUntil` in the future) → leaves the
   *     count untouched (the caller rejects without counting the attempt).
   * Folding the expired-window reset INTO the increment in a single statement is
   * what closes the TOCTOU brute-force bypass (CLAUDE.md §3.4): a separate
   * reset-then-increment could interleave under a concurrent burst on a just-
   * expired lock and let every guess reach the comparison. `now` is supplied by
   * the caller's injected clock so the decision is deterministic/testable.
   *
   * Returns the post-update `count` and `lockedUntil` (the latter lets the caller
   * detect a concurrently-set active lock).
   */
  registerFailedAttempt(
    userId: string,
    now: Date,
  ): Promise<{ count: number; lockedUntil: Date | null }>;

  /**
   * Persists `pinLockedUntil` when the failure threshold is crossed. Kept
   * separate from the increment so the lock is written only once, right after
   * the atomic counter reveals the threshold was reached.
   */
  setLock(userId: string, lockedUntil: Date): Promise<void>;

  /** Resets `pinFailureCount` to 0 and clears `pinLockedUntil` after a successful verify. */
  resetFailures(userId: string): Promise<void>;

  /**
   * Clears the PIN entirely: sets `pinHash` to null and resets
   * `pinFailureCount`/`pinLockedUntil`. Used by an admin force-reset — it never
   * sets a new PIN; the user must re-establish one via re-verification.
   */
  clearPin(userId: string): Promise<void>;
}
