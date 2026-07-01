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
   * Records an incremented failure count and, when the account is being locked,
   * the `lockedUntil` timestamp. Pass null for `lockedUntil` when under the
   * maxAttempts threshold (not yet locked).
   */
  recordFailure(
    userId: string,
    count: number,
    lockedUntil: Date | null,
  ): Promise<void>;

  /** Resets `pinFailureCount` to 0 and clears `pinLockedUntil` after a successful verify. */
  resetFailures(userId: string): Promise<void>;

  /**
   * Clears the PIN entirely: sets `pinHash` to null and resets
   * `pinFailureCount`/`pinLockedUntil`. Used by an admin force-reset — it never
   * sets a new PIN; the user must re-establish one via re-verification.
   */
  clearPin(userId: string): Promise<void>;
}
