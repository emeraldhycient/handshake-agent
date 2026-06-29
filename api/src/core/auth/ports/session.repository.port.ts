/**
 * Repository port for Session state (Fix G). SessionService depends on this
 * interface, never on SessionPrismaRepository directly (clean-arch §4.1).
 *
 * The DI token SESSION_REPOSITORY is injected by AuthModule; the infrastructure
 * binding is SessionPrismaRepository.
 */

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

/** Snapshot of the step-up-relevant fields on a Session row. */
export interface SessionRecord {
  id: string;
  userId: string;
  deviceId: string | null;
  stepUpCompletedAt: Date | null;
  expiresAt: Date;
  isActive: boolean;
}

/** Read/write contract for Session persistence (step-up tracking). */
export interface ISessionRepository {
  /**
   * Finds the most-recently-created active (non-expired, not-revoked) session
   * for the given userId + deviceId pair.
   * Returns null when no session exists.
   */
  findActiveByUserAndDevice(
    userId: string,
    deviceId: string,
  ): Promise<SessionRecord | null>;

  /**
   * Upserts a session for the (userId, deviceId) pair:
   *   - If an active, non-expired session already exists, bumps lastActivityAt.
   *   - If no suitable session exists, creates a minimal one with a synthetic
   *     accessTokenHash (a UUID — only real login flows hold JWT tokens; this
   *     is the device-step-up path where the token is managed externally).
   *
   * Returns the upserted record.
   */
  touchOrCreate(
    userId: string,
    deviceId: string,
    now: Date,
  ): Promise<SessionRecord>;

  /**
   * Sets stepUpCompletedAt on the active session for (userId, deviceId).
   * No-op (safe) if no active session exists — callers must call
   * touchOrCreate first.
   */
  recordStepUp(
    userId: string,
    deviceId: string,
    stepUpCompletedAt: Date,
  ): Promise<void>;

  /**
   * Returns the pinnedDeviceId for the given userId, or null when no device
   * is bound. Used to resolve the acting device when not explicitly supplied.
   */
  findPinnedDeviceId(userId: string): Promise<string | null>;

  /**
   * Resolves the Device id for the given userId + fingerprint, or null when no
   * device with that fingerprint belongs to the user. Used to bind a step-up to
   * the acting browser/device from the client-supplied fingerprint (§3.4).
   */
  findDeviceIdByFingerprint(
    userId: string,
    fingerprint: string,
  ): Promise<string | null>;
}
