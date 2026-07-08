/**
 * Repository port for PersonalAccessToken persistence (Wave C — PAT/MCP).
 * PatService and PatAuthGuard depend on this interface, never on the Prisma
 * adapter directly (clean-arch §4.1 / §3.2).
 *
 * Security posture baked into the contract:
 *   - the RAW token never crosses this port — only its SHA-256 hex;
 *   - reads never return `tokenHash` back out (masked projections only);
 *   - `revoke` is scoped by userId so a caller can never revoke a foreign
 *     token by guessing its id (false → the service fails closed with 404).
 */

export const PAT_REPOSITORY = Symbol('PAT_REPOSITORY');

/** Masked projection of one PAT row — safe to surface to the owner. */
export interface PatRecord {
  id: string;
  label: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

/** Auth-path projection resolved from a token hash (guard principal source). */
export interface PatPrincipalRecord {
  patId: string;
  userId: string;
  scopes: string[];
}

export interface IPatRepository {
  /** Persists a new token row (hash only) and returns its masked projection. */
  create(input: {
    userId: string;
    label: string;
    tokenHash: string;
    scopes: string[];
    expiresAt: Date | null;
  }): Promise<PatRecord>;

  /** The user's UNREVOKED tokens, newest first, masked (never the hash). */
  listForUser(userId: string): Promise<PatRecord[]>;

  /**
   * Resolves the principal for an UNREVOKED, UNEXPIRED token hash.
   * Returns null (never throws) for unknown/revoked/expired — the guard maps
   * null to 401 without disclosing which condition failed.
   */
  findActiveByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<PatPrincipalRecord | null>;

  /**
   * Soft-revokes (sets revokedAt) the token, scoped to the owning user.
   * Returns true when a live token was revoked; false for an unknown id, a
   * token owned by someone else, or one already revoked (service → 404).
   */
  revoke(userId: string, patId: string, revokedAt: Date): Promise<boolean>;

  /** Bumps lastUsedAt — called fire-and-forget from the auth guard. */
  touchLastUsed(patId: string, at: Date): Promise<void>;
}
