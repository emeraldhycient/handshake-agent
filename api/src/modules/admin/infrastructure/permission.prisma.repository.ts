import { Injectable } from '@nestjs/common';

import type { Permission } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  type IPermissionRepository,
  type PermissionCatalogEntry,
  type PermissionRecord,
} from '../application/ports/permission.repository.port';

@Injectable()
export class PermissionPrismaRepository implements IPermissionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertCatalog(entries: PermissionCatalogEntry[]): Promise<void> {
    // Idempotent: keyed by the unique [resourceType, resourceId, action], so a
    // re-run updates the catalog metadata without duplicating rows.
    await this.prisma.$transaction(
      entries.map((entry) =>
        this.prisma.permission.upsert({
          where: {
            resourceType_resourceId_action: {
              resourceType: entry.resourceType,
              resourceId: entry.resourceId,
              action: entry.action,
            },
          },
          create: {
            resourceType: entry.resourceType,
            resourceId: entry.resourceId,
            action: entry.action,
            category: entry.category,
            description: entry.description,
          },
          update: {
            category: entry.category,
            description: entry.description,
          },
        }),
      ),
    );
  }

  async list(): Promise<PermissionRecord[]> {
    const rows = await this.prisma.permission.findMany({
      orderBy: [{ category: 'asc' }, { resourceId: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async findByRole(roleId: string): Promise<PermissionRecord[]> {
    const rows = await this.prisma.permission.findMany({
      where: { roles: { some: { roleId } } },
      orderBy: [{ category: 'asc' }, { resourceId: 'asc' }],
    });
    return rows.map(toRecord);
  }
}

function toRecord(row: Permission): PermissionRecord {
  return {
    id: row.id,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    action: row.action,
    category: row.category,
    description: row.description,
  };
}
