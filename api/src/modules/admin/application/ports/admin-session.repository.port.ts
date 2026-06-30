// Port for admin sessions (ADM-08). Only the token hash is stored — never the JWT.
// A session is "active" when it is neither revoked nor expired. `stepUpCompletedAt`
// gates money-affecting / limit-changing admin actions within the step-up TTL.

export const ADMIN_SESSION_REPOSITORY = Symbol('ADMIN_SESSION_REPOSITORY');

export interface CreateAdminSessionInput {
  /**
   * Optional caller-supplied row id. When provided, the caller controls the id
   * so it can be embedded as the JWT `sub` and re-checked by AdminSessionGuard
   * (`session.id === token.sub`). When omitted, the DB generates it.
   */
  id?: string;
  adminUserId: string;
  tokenHash: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AdminSessionRecord {
  id: string;
  adminUserId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  stepUpCompletedAt: Date | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface IAdminSessionRepository {
  create(input: CreateAdminSessionInput): Promise<AdminSessionRecord>;
  /** Active = revokedAt null AND expiresAt > now. */
  findActiveByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<AdminSessionRecord | null>;
  revoke(id: string, at: Date): Promise<void>;
  /** Stamp the last successful step-up (re-auth) on this session. */
  recordStepUp(id: string, at: Date): Promise<void>;
  findById(id: string): Promise<AdminSessionRecord | null>;
  listForAdmin(adminUserId: string): Promise<AdminSessionRecord[]>;
  revokeAllForAdmin(adminUserId: string, at: Date): Promise<void>;
}
