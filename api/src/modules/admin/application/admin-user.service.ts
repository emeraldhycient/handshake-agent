import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../../../core/audit/application/audit.service';
import {
  AdminNotFoundError,
  AdminSelfActionForbiddenError,
} from '../domain/admin-errors';
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

/**
 * The admin display name to persist/show: the caller-supplied name when it is
 * non-blank, otherwise the email local-part (the part before the '@'). Never
 * returns an empty string. Shared by invitation-accept, the AdminMe view, and
 * the list serializer so the fallback is identical everywhere.
 */
export function resolveAdminDisplayName(
  email: string,
  displayName?: string | null,
): string {
  const trimmed = displayName?.trim();
  if (trimmed) return trimmed;
  return email.split('@')[0]?.trim() || email;
}

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

  /**
   * Self-service profile edit: an operator updating their OWN display name
   * (`PATCH /admin/me`). No elevated permission — self-edit is always allowed;
   * the value is already validated (trimmed, 1–80 chars) at the DTO boundary.
   * Audited under the acting admin as both actor and subject.
   */
  async updateOwnDisplayName(
    adminId: string,
    displayName: string,
    now: Date,
  ): Promise<void> {
    await this.users.setDisplayName(adminId, displayName);
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `AdminUser:${adminId}`,
      action: 'admin_update',
      details: { at: now.toISOString() },
      after: { displayName },
    });
  }

  async setStatus(
    id: string,
    status: AdminUserStatusChange,
    actorAdminId: string,
    now: Date,
  ): Promise<void> {
    // Self-guard (§3.3): an operator may not suspend or offboard their own
    // account — that would lock them (and possibly the last super-admin) out.
    // Enforced server-side regardless of permissions; the UI also hides these
    // controls on the self row. Reactivating yourself (→ active) is harmless.
    if (
      id === actorAdminId &&
      (status === 'suspended' || status === 'offboarded')
    ) {
      throw new AdminSelfActionForbiddenError(
        status === 'suspended' ? 'suspend' : 'offboard',
      );
    }
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
