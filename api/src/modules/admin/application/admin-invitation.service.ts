import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../../../core/audit/application/audit.service';
import { AdminInvitationInvalidError } from '../domain/admin-errors';
import {
  ADMIN_INVITATION_REPOSITORY,
  type IAdminInvitationRepository,
} from './ports/admin-invitation.repository.port';
import {
  ADMIN_USER_REPOSITORY,
  type IAdminUserRepository,
} from './ports/admin-user.repository.port';

/** Single-use admin invitations live for 7 days. */
export const INVITATION_TTL_SECONDS = 7 * 24 * 3600;

export interface CreateInvitationCommand {
  email: string;
  roleId: string;
  reason?: string;
}

export interface CreateInvitationResult {
  id: string;
  email: string;
  expiresAt: Date;
  /** Plaintext token — surfaced once, never persisted (only its hash is stored). */
  invitationToken: string;
}

export interface AcceptInvitationCommand {
  token: string;
  /** Already hashed by the caller; this service never sees the plaintext password. */
  passwordHash: string;
}

function genToken(): string {
  return randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ADM-07 admin invitations. `create` provisions a pending admin + a single-use,
// TTL-bounded invitation (only the token hash is stored). `accept` activates the
// admin and burns the invitation. Both are audited.
@Injectable()
export class AdminInvitationService {
  constructor(
    @Inject(ADMIN_INVITATION_REPOSITORY)
    private readonly invitations: IAdminInvitationRepository,
    @Inject(ADMIN_USER_REPOSITORY)
    private readonly users: IAdminUserRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    input: CreateInvitationCommand,
    createdByAdminId: string,
    now: Date,
  ): Promise<CreateInvitationResult> {
    await this.users.createInvited({
      email: input.email,
      roleId: input.roleId,
    });
    const token = genToken();
    const invitation = await this.invitations.create({
      email: input.email,
      roleId: input.roleId,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + INVITATION_TTL_SECONDS * 1000),
      createdByAdminId,
      reason: input.reason,
    });
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: createdByAdminId,
      subject: `AdminInvitation:${invitation.id}`,
      action: 'admin_update',
      after: { email: input.email, roleId: input.roleId },
    });
    return {
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      invitationToken: token,
    };
  }

  async accept(
    input: AcceptInvitationCommand,
    now: Date,
  ): Promise<{ adminId: string }> {
    const invitation = await this.invitations.findActiveByTokenHash(
      hashToken(input.token),
      now,
    );
    if (!invitation) throw new AdminInvitationInvalidError();

    const user = await this.users.findByEmail(invitation.email);
    if (!user) throw new AdminInvitationInvalidError();

    await this.users.setPasswordAndActivate(user.id, input.passwordHash, now);
    await this.invitations.markAccepted(invitation.id, now);
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: user.id,
      subject: `AdminInvitation:${invitation.id}`,
      action: 'admin_update',
      after: { adminId: user.id },
    });
    return { adminId: user.id };
  }
}
