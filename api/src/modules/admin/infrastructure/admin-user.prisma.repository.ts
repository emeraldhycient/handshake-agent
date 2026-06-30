import { Injectable } from '@nestjs/common';

import type { AdminUser } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  type AdminUserRecord,
  type CreateInvitedAdminInput,
  type IAdminUserRepository,
  type ListAdminUsersQuery,
  type ListAdminUsersResult,
} from '../application/ports/admin-user.repository.port';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class AdminUserPrismaRepository implements IAdminUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createInvited(
    input: CreateInvitedAdminInput,
  ): Promise<AdminUserRecord> {
    const row = await this.prisma.adminUser.create({
      data: {
        email: input.email,
        roleId: input.roleId,
        // Pending admins have no usable credential until they accept.
        passwordHash: '',
        status: 'pending',
      },
    });
    return toRecord(row);
  }

  async findByEmail(email: string): Promise<AdminUserRecord | null> {
    const row = await this.prisma.adminUser.findUnique({ where: { email } });
    return row ? toRecord(row) : null;
  }

  async findById(id: string): Promise<AdminUserRecord | null> {
    const row = await this.prisma.adminUser.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async list(query: ListAdminUsersQuery): Promise<ListAdminUsersResult> {
    const take = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const rows = await this.prisma.adminUser.findMany({
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const items = page.map(toRecord);
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async setStatus(
    id: string,
    status: 'active' | 'suspended' | 'offboarded',
    at: Date,
  ): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id },
      data: {
        status,
        ...(status === 'suspended' ? { suspendedAt: at } : {}),
        ...(status === 'offboarded' ? { offboardedAt: at } : {}),
      },
    });
  }

  async updateRole(id: string, roleId: string): Promise<void> {
    await this.prisma.adminUser.update({ where: { id }, data: { roleId } });
  }

  async setPasswordAndActivate(
    id: string,
    passwordHash: string,
    at: Date,
  ): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id },
      data: { passwordHash, status: 'active', acceptedAt: at },
    });
  }

  async enableMfa(
    id: string,
    encSecret: string,
    hashedRecoveryCodes: string[],
  ): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id },
      data: {
        mfaEnabled: true,
        mfaSecret: encSecret,
        mfaRecoveryCodes: hashedRecoveryCodes,
      },
    });
  }

  async consumeRecoveryCode(
    id: string,
    matches: (codeHash: string) => boolean,
  ): Promise<boolean> {
    // Serialize load → mutate → write so two concurrent consumers can't both
    // burn the same code (the row is locked for the transaction's duration).
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.adminUser.findUnique({
        where: { id },
        select: { mfaRecoveryCodes: true },
      });
      if (!row) {
        return false;
      }
      const index = row.mfaRecoveryCodes.findIndex(matches);
      if (index === -1) {
        return false;
      }
      const remaining = row.mfaRecoveryCodes.filter((_, i) => i !== index);
      await tx.adminUser.update({
        where: { id },
        data: { mfaRecoveryCodes: remaining },
      });
      return true;
    });
  }

  async recordLogin(id: string, at: Date): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id },
      data: { lastLoginAt: at },
    });
  }
}

function toRecord(row: AdminUser): AdminUserRecord {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    mfaEnabled: row.mfaEnabled,
    mfaSecret: row.mfaSecret,
    mfaRecoveryCodes: row.mfaRecoveryCodes,
    roleId: row.roleId,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
  };
}
