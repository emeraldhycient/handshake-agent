/**
 * DI token and port for the admin-facing END-USER auth-session repository.
 *
 * Oversight for the user-detail Security tab: the user's JWT/refresh `sessions`
 * rows (NOT the admin's own console sessions — those are the ADMIN session repo).
 * Token hashes NEVER cross this port — only non-secret session metadata is
 * projected on the read path. The write path (Phase 9) marks sessions REVOKED
 * (never deletes — the row stays for the audit trail): a single session by id,
 * or all of a user's live sessions in one force-sign-out.
 *
 * Distinct from ITransactionReadRepository / IIdentityRepository: it is a thin,
 * purpose-built projection. The concrete Prisma adapter lives in infrastructure;
 * application/domain depend only on this contract (CLAUDE.md §3.2).
 */
export const USER_SESSION_READ_REPOSITORY = Symbol(
  'USER_SESSION_READ_REPOSITORY',
);

// ---------------------------------------------------------------------------
// Record type (application-layer projection — never a Prisma type)
// ---------------------------------------------------------------------------

/** A single end-user auth session, joined to its device for UA/IP telemetry. */
export interface UserSessionRecord {
  id: string;
  channel: string;
  deviceId: string | null;
  /** User-agent surfaced from the bound device (routing/telemetry only). */
  userAgent: string | null;
  /** IP recorded at device binding (routing/telemetry only). */
  ipAddress: string | null;
  isActive: boolean;
  stepUpCompletedAt: Date | null;
  issuedAt: Date;
  expiresAt: Date;
  lastActivityAt: Date | null;
  revokedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IUserSessionReadRepository {
  /**
   * Returns the user's sessions newest-first (by issuedAt), capped at `limit`.
   * Active sessions come first; token hashes are never selected. Returns an
   * empty array when the user has no sessions.
   */
  listForUser(userId: string, limit: number): Promise<UserSessionRecord[]>;

  /**
   * Marks a single session REVOKED, scoped to the owning user so an admin can
   * never revoke another user's session by guessing an id. Sets `isActive=false`
   * + `revokedAt`/`revokedReason`; the row is retained (never deleted) for audit.
   * Returns `true` if a live session was revoked, `false` if none matched (an
   * unknown id, a session not owned by `userId`, or one already revoked) — the
   * service maps a `false` to a 404 so the action fails closed.
   */
  revokeSession(
    userId: string,
    sessionId: string,
    revokedAt: Date,
    reason: string,
  ): Promise<boolean>;

  /**
   * Force sign-out: marks ALL of the user's currently-active sessions REVOKED in
   * one write (same fields as `revokeSession`). Rows are retained for audit.
   * Returns the count revoked (0 when the user had no live sessions).
   */
  revokeAllForUser(
    userId: string,
    revokedAt: Date,
    reason: string,
  ): Promise<number>;
}
