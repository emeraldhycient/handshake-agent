import { Injectable } from '@nestjs/common';

import type {
  Permission,
  Prisma,
  Role,
} from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  type CreateRoleInput,
  type IRoleRepository,
  type RoleRecord,
  type RoleWithPermissions,
  type UpdateRoleInput,
} from '../application/ports/role.repository.port';
import { permissionCatalogId } from '../application/ports/permission.repository.port';

// Role row joined with the Permission rows reachable through the assignment table.
type RoleWithJoin = Role & {
  permissions: { permission: Permission }[];
};

const WITH_PERMISSIONS = {
  permissions: { include: { permission: true } },
} satisfies Prisma.RoleInclude;

@Injectable()
export class RolePrismaRepository implements IRoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateRoleInput): Promise<RoleRecord> {
    const permissionRowIds = await this.resolvePermissionRowIds(
      input.permissionIds,
    );
    const role = await this.prisma.role.create({
      data: {
        name: input.name,
        description: input.description,
        isBuiltin: input.isBuiltin,
        permissions: {
          create: permissionRowIds.map((permissionId) => ({ permissionId })),
        },
      },
    });
    return toRoleRecord(role);
  }

  async findById(id: string): Promise<RoleWithPermissions | null> {
    const row = await this.prisma.role.findUnique({
      where: { id },
      include: WITH_PERMISSIONS,
    });
    return row ? toRoleWithPermissions(row) : null;
  }

  async findByName(name: string): Promise<RoleWithPermissions | null> {
    const row = await this.prisma.role.findUnique({
      where: { name },
      include: WITH_PERMISSIONS,
    });
    return row ? toRoleWithPermissions(row) : null;
  }

  async list(): Promise<RoleWithPermissions[]> {
    const rows = await this.prisma.role.findMany({
      include: WITH_PERMISSIONS,
      orderBy: { name: 'asc' },
    });
    return rows.map(toRoleWithPermissions);
  }

  async update(id: string, input: UpdateRoleInput): Promise<void> {
    const permissionRowIds =
      input.permissionIds === undefined
        ? undefined
        : await this.resolvePermissionRowIds(input.permissionIds);

    await this.prisma.$transaction(async (tx) => {
      if (input.description !== undefined) {
        await tx.role.update({
          where: { id },
          data: { description: input.description },
        });
      }
      if (permissionRowIds !== undefined) {
        // Replace the assignment set wholesale.
        await tx.rolePermissionAssignment.deleteMany({ where: { roleId: id } });
        await tx.rolePermissionAssignment.createMany({
          data: permissionRowIds.map((permissionId) => ({
            roleId: id,
            permissionId,
          })),
        });
      }
    });
  }

  async countAdmins(roleId: string): Promise<number> {
    return this.prisma.adminUser.count({ where: { roleId } });
  }

  /**
   * Map canonical catalog id strings (`resourceType:resourceId:action`) to the
   * matching Permission row ids; ids with no matching row are silently dropped.
   */
  private async resolvePermissionRowIds(
    catalogIds: string[],
  ): Promise<string[]> {
    if (catalogIds.length === 0) {
      return [];
    }
    const permissions = await this.prisma.permission.findMany();
    const byCatalogId = new Map(
      permissions.map((p) => [permissionCatalogId(p), p.id]),
    );
    return catalogIds
      .map((id) => byCatalogId.get(id))
      .filter((id): id is string => id !== undefined);
  }
}

function toRoleRecord(row: Role): RoleRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isBuiltin: row.isBuiltin,
  };
}

function toRoleWithPermissions(row: RoleWithJoin): RoleWithPermissions {
  return {
    ...toRoleRecord(row),
    permissionIds: row.permissions.map((a) =>
      permissionCatalogId(a.permission),
    ),
  };
}
