/**
 * DI token and port for the SELF-SERVICE session repository (Wave C settings).
 *
 * The user-facing sibling of the admin IUserSessionReadRepository: the same
 * Session rows, but every operation is scoped to the CURRENT user — a caller
 * can only ever see or revoke their own sessions. Token hashes NEVER cross
 * this port; only non-secret session metadata is projected. Revocation marks
 * the row REVOKED (never deletes — audit trail), and revoking the caller's
 * own current session is allowed (it behaves like logout: the JwtAuthGuard
 * active-session check 401s the next request).
 */

export const PROFILE_SESSION_REPOSITORY = Symbol('PROFILE_SESSION_REPOSITORY');

/** One ACTIVE session, joined to its device for the user-agent hint. */
export interface ProfileSessionRecord {
  id: string;
  channel: string;
  /** User-agent from the bound device (telemetry only). */
  userAgent: string | null;
  issuedAt: Date;
  lastActivityAt: Date | null;
  expiresAt: Date;
}

export interface IProfileSessionRepository {
  /**
   * The user's ACTIVE (isActive, unrevoked, unexpired at `now`) sessions,
   * newest-issued first. Never selects token hashes.
   */
  listActiveForUser(userId: string, now: Date): Promise<ProfileSessionRecord[]>;

  /**
   * Marks one ACTIVE session REVOKED, scoped to the owning user. Returns true
   * when a live session was revoked; false for an unknown id, a session owned
   * by someone else, or one already revoked/expired (service → 404).
   */
  revokeOwn(
    userId: string,
    sessionId: string,
    revokedAt: Date,
    reason: string,
  ): Promise<boolean>;
}
