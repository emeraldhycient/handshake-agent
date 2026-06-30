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
  status: AdminUserStatus;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  mfaRecoveryCodes: string[];
  roleId: string;
  roleName: string;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface CreateInvitedAdminInput {
  email: string;
  roleId: string;
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
  /** Accept an invitation: set password hash, activate, stamp acceptedAt. */
  setPasswordAndActivate(
    id: string,
    passwordHash: string,
    at: Date,
  ): Promise<void>;
  /** Enable MFA, storing the encrypted secret and hashed recovery codes. */
  enableMfa(
    id: string,
    encSecret: string,
    hashedRecoveryCodes: string[],
  ): Promise<void>;
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
}
