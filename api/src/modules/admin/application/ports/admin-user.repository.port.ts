// Port for the admin identity store (ADM-01). Admins are a SEPARATE identity space
// from end users; this repository never touches user money tables. The encrypted
// TOTP secret and hashed MFA recovery codes are written here but the secret is never
// surfaced beyond MFA verification. `mfaSecret`/`mfaRecoveryCodes` are read back so
// the application layer can verify/consume them; the API never returns them.

export const ADMIN_USER_REPOSITORY = Symbol('ADMIN_USER_REPOSITORY');

export type AdminUserStatus = 'pending' | 'active' | 'suspended' | 'offboarded';

export interface AdminUserRecord {
  id: string;
  email: string;
  /** Human display name — never empty at this layer: the repository falls back
   * to the email local-part when the stored column is blank. */
  displayName: string;
  status: AdminUserStatus;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  mfaRecoveryCodes: string[];
  roleId: string;
  roleName: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  /** Consecutive failed-login count; reset to 0 on any fully successful login. */
  failedLoginCount: number;
  /** When set and in the future, login is refused (account-lockout, §3.3). */
  loginLockedUntil: Date | null;
}

export interface CreateInvitedAdminInput {
  email: string;
  roleId: string;
  /** Optional display name; defaults server-side to the email local-part. */
  displayName?: string;
}

export interface ListAdminUsersQuery {
  /** Opaque cursor (the previous page's last record id). */
  cursor?: string;
  limit?: number;
}

export interface ListAdminUsersResult {
  items: AdminUserRecord[];
  nextCursor: string | null;
}

export interface IAdminUserRepository {
  /** Create a pending admin (invited, no password yet). */
  createInvited(input: CreateInvitedAdminInput): Promise<AdminUserRecord>;
  findByEmail(email: string): Promise<AdminUserRecord | null>;
  findById(id: string): Promise<AdminUserRecord | null>;
  list(query: ListAdminUsersQuery): Promise<ListAdminUsersResult>;
  /**
   * Move an admin into a terminal/non-active status. Sets the matching timestamp
   * (suspendedAt for suspended, offboardedAt for offboarded).
   */
  setStatus(
    id: string,
    status: 'active' | 'suspended' | 'offboarded',
    at: Date,
  ): Promise<void>;
  updateRole(id: string, roleId: string): Promise<void>;
  /** Persist an admin's display name. */
  setDisplayName(id: string, displayName: string): Promise<void>;
  /**
   * Accept an invitation: set password hash, activate, stamp acceptedAt, and —
   * when a non-empty display name is supplied — persist it in the same write.
   */
  setPasswordAndActivate(
    id: string,
    passwordHash: string,
    at: Date,
    displayName?: string,
  ): Promise<void>;
  /** Enable MFA, storing the encrypted secret and hashed recovery codes. */
  enableMfa(
    id: string,
    encSecret: string,
    hashedRecoveryCodes: string[],
  ): Promise<void>;
  /**
   * Reset MFA for an admin: clear the encrypted secret + recovery codes and set
   * mfaEnabled=false. Used by the reset-2FA-for-another-admin RBAC action.
   */
  disableMfa(id: string): Promise<void>;
  /**
   * Atomically consume the first recovery code the predicate matches: load the
   * stored hashes, find the first match, remove exactly that one, and persist.
   * Returns whether a code was consumed.
   */
  consumeRecoveryCode(
    id: string,
    matches: (codeHash: string) => boolean,
  ): Promise<boolean>;
  recordLogin(id: string, at: Date): Promise<void>;
  /**
   * Registers a failed-login attempt in ONE atomic SQL statement that, evaluated
   * against the row's current `loginLockedUntil`: starts a fresh window
   * (`failedLoginCount = 1`, clear lock) when a prior lock has EXPIRED; increments
   * otherwise; leaves the count untouched while a lock is still ACTIVE. Folding the
   * expired-window reset INTO the increment (rather than a separate reset-then-
   * increment) is what keeps the credential-stuffing lockout from being bypassed
   * by a concurrent burst on a just-expired lock (TOCTOU guard, §3.3 — mirrors
   * PinService.registerFailedAttempt). Called BEFORE the argon2 verify so at most
   * `maxAttempts` concurrent callers reach the expensive comparison. `now` comes
   * from the caller so lockout timing stays deterministic/testable.
   */
  registerFailedLogin(
    id: string,
    now: Date,
  ): Promise<{ count: number; lockedUntil: Date | null }>;
  /** Lock the account until `until` (set when the failure count crosses the cap). */
  setLoginLock(id: string, until: Date): Promise<void>;
  /** Clear the failure counter + lock (on a fully successful login). */
  resetLoginFailures(id: string): Promise<void>;
}
