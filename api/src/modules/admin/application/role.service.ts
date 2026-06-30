import { randomUUID } from 'node:crypto';

import { Injectable, Inject } from '@nestjs/common';

import {
  BUILTIN_ROLES,
  PERMISSION_CATALOG,
  permissionId,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import {
  AdminNotFoundError,
  BuiltinRoleImmutableError,
} from '../domain/admin-errors';
import {
  ROLE_REPOSITORY,
  type IRoleRepository,
  type RoleRecord,
  type RoleWithPermissions,
} from './ports/role.repository.port';

export interface CreateRoleCommand {
  name: string;
  description: string;
  permissionIds: string[];
}

export interface UpdateRoleCommand {
  description?: string;
  permissionIds?: string[];
}

// ADM-03/04 roles. Built-in roles are seeded from the contracts catalog and are
// immutable; custom roles are admin-managed permission sets. Every mutation is
// recorded in the hash-chained audit log.
@Injectable()
export class RoleService {
  constructor(
    @Inject(ROLE_REPOSITORY)
    private readonly roles: IRoleRepository,
    private readonly audit: AuditService,
  ) {}

  /** Idempotently create any built-in role that does not yet exist. */
  async seedBuiltins(): Promise<void> {
    for (const def of BUILTIN_ROLES) {
      const existing = await this.roles.findByName(def.name);
      if (existing) continue;
      await this.roles.create({
        name: def.name,
        description: def.description,
        isBuiltin: true,
        permissionIds: PERMISSION_CATALOG.filter(def.grants).map(permissionId),
      });
    }
  }

  list(): Promise<RoleWithPermissions[]> {
    return this.roles.list();
  }

  async create(
    input: CreateRoleCommand,
    actorAdminId: string,
  ): Promise<RoleRecord> {
    const role = await this.roles.create({
      name: input.name,
      description: input.description,
      isBuiltin: false,
      permissionIds: input.permissionIds,
    });
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId,
      subject: `Role:${role.id}`,
      action: 'admin_update',
      after: input,
    });
    return role;
  }

  async update(
    id: string,
    input: UpdateRoleCommand,
    actorAdminId: string,
  ): Promise<void> {
    const role = await this.roles.findById(id);
    if (!role) throw new AdminNotFoundError('Role');
    if (role.isBuiltin) throw new BuiltinRoleImmutableError();
    await this.roles.update(id, input);
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId,
      subject: `Role:${id}`,
      action: 'admin_update',
      before: role,
      after: input,
    });
  }
}
