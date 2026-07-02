/**
 * DI token and port for the admin-facing END-USER auth-session READ repository.
 *
 * Read-only oversight for the user-detail Security tab: the user's JWT/refresh
 * `sessions` rows (NOT the admin's own console sessions — those are the ADMIN
 * session repo). Token hashes NEVER cross this port — only non-secret session
 * metadata is projected. Revocation is a Phase-7 write; this is reads only.
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
}
