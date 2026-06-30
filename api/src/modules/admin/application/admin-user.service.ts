import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../../../core/audit/application/audit.service';
import { AdminNotFoundError } from '../domain/admin-errors';
import {
  ADMIN_SESSION_REPOSITORY,
  type IAdminSessionRepository,
} from './ports/admin-session.repository.port';
import {
  ADMIN_USER_REPOSITORY,
  type AdminUserRecord,
  type IAdminUserRepository,
  type ListAdminUsersQuery,
  type ListAdminUsersResult,
} from './ports/admin-user.repository.port';

export type AdminUserStatusChange = 'active' | 'suspended' | 'offboarded';

// ADM-01 admin user management: listing, lookup, role changes, and lifecycle
// status changes. Offboarding additionally revokes every live session for the
// admin so access is cut immediately. All mutations are audited.
@Injectable()
export class AdminUserService {
  constructor(
    @Inject(ADMIN_USER_REPOSITORY)
    private readonly users: IAdminUserRepository,
    @Inject(ADMIN_SESSION_REPOSITORY)
    private readonly sessions: IAdminSessionRepository,
    private readonly audit: AuditService,
  ) {}

  list(query: ListAdminUsersQuery): Promise<ListAdminUsersResult> {
    return this.users.list(query);
  }

  async get(id: string): Promise<AdminUserRecord> {
    const user = await this.users.findById(id);
    if (!user) throw new AdminNotFoundError('Admin user');
    return user;
  }

  async updateRole(
    id: string,
    roleId: string,
    actorAdminId: string,
    now: Date,
  ): Promise<void> {
    await this.users.updateRole(id, roleId);
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId,
      subject: `AdminUser:${id}`,
      action: 'admin_update',
      details: { at: now.toISOString() },
      after: { roleId },
    });
  }

  async setStatus(
    id: string,
    status: AdminUserStatusChange,
    actorAdminId: string,
    now: Date,
  ): Promise<void> {
    await this.users.setStatus(id, status, now);
    if (status === 'offboarded') {
      await this.sessions.revokeAllForAdmin(id, now);
    }
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId,
      subject: `AdminUser:${id}`,
      action: 'admin_update',
      after: { status },
    });
  }
}
