// Port for single-use, TTL-bounded admin invitations (ADM-07). Only the token hash is
// stored. An invitation is "active" when unaccepted and unexpired. `countAdmins` backs
// the bootstrap path (the very first admin is seeded only when none exist).

export const ADMIN_INVITATION_REPOSITORY = Symbol(
  'ADMIN_INVITATION_REPOSITORY',
);

export interface CreateAdminInvitationInput {
  email: string;
  roleId: string;
  tokenHash: string;
  expiresAt: Date;
  createdByAdminId: string;
  reason?: string | null;
}

export interface AdminInvitationCreatedRecord {
  id: string;
  email: string;
  expiresAt: Date;
}

export interface ActiveAdminInvitationRecord {
  id: string;
  email: string;
  roleId: string;
}

export interface IAdminInvitationRepository {
  create(
    input: CreateAdminInvitationInput,
  ): Promise<AdminInvitationCreatedRecord>;
  /** Active = acceptedAt null AND expiresAt > now. */
  findActiveByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<ActiveAdminInvitationRecord | null>;
  markAccepted(id: string, at: Date): Promise<void>;
  /** Total AdminUser count — used by the first-admin bootstrap. */
  countAdmins(): Promise<number>;
}
