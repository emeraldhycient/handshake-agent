import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../../core/config/env.schema';
import { AuditService } from '../../../core/audit/application/audit.service';
import {
  AdminBootstrapForbiddenError,
  AdminNotFoundError,
} from '../domain/admin-errors';
import { PermissionCatalogService } from './permission-catalog.service';
import { RoleService } from './role.service';
import { INVITATION_TTL_SECONDS } from './admin-invitation.service';
import {
  ADMIN_INVITATION_REPOSITORY,
  type IAdminInvitationRepository,
} from './ports/admin-invitation.repository.port';
import {
  ADMIN_USER_REPOSITORY,
  type IAdminUserRepository,
} from './ports/admin-user.repository.port';
import {
  ROLE_REPOSITORY,
  type IRoleRepository,
} from './ports/role.repository.port';

export interface BootstrapResult {
  invitationId: string;
  invitationToken: string;
  expiresAt: Date;
}

function genToken(): string {
  return randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// First-admin bootstrap. Guarded by the one-time `ADMIN_BOOTSTRAP_TOKEN` and the
// "no admins yet" invariant, it seeds the permission catalog + built-in roles and
// mints a single super_admin invitation. The invitation self-references the freshly
// created pending admin so the non-null `createdByAdminId` FK is satisfied.
@Injectable()
export class AdminBootstrapService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(ADMIN_INVITATION_REPOSITORY)
    private readonly invitations: IAdminInvitationRepository,
    @Inject(ADMIN_USER_REPOSITORY)
    private readonly users: IAdminUserRepository,
    @Inject(ROLE_REPOSITORY)
    private readonly roles: IRoleRepository,
    private readonly catalog: PermissionCatalogService,
    private readonly roleService: RoleService,
    private readonly audit: AuditService,
  ) {}

  async bootstrap(
    token: string,
    email: string,
    now: Date,
  ): Promise<BootstrapResult> {
    const expected = this.config.get('ADMIN_BOOTSTRAP_TOKEN', { infer: true });
    if (
      !token ||
      token !== expected ||
      (await this.invitations.countAdmins()) > 0
    ) {
      throw new AdminBootstrapForbiddenError();
    }

    await this.catalog.syncCatalog();
    await this.roleService.seedBuiltins();

    const superRole = await this.roles.findByName('super_admin');
    if (!superRole) throw new AdminNotFoundError('Role super_admin');

    const pendingUser = await this.users.createInvited({
      email,
      roleId: superRole.id,
    });
    const token2 = genToken();
    const invitation = await this.invitations.create({
      email,
      roleId: superRole.id,
      tokenHash: hashToken(token2),
      expiresAt: new Date(now.getTime() + INVITATION_TTL_SECONDS * 1000),
      // Self-reference: satisfies the non-null FK before any admin "exists" properly.
      createdByAdminId: pendingUser.id,
      reason: 'bootstrap',
    });
    await this.audit.record({
      correlationId: randomUUID(),
      actor: 'system',
      subject: `AdminInvitation:${invitation.id}`,
      action: 'admin_update',
      after: { email, roleId: superRole.id, reason: 'bootstrap' },
    });

    return {
      invitationId: invitation.id,
      invitationToken: token2,
      expiresAt: invitation.expiresAt,
    };
  }
}
