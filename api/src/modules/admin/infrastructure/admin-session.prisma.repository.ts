import { Injectable } from '@nestjs/common';

import type { AdminSession } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  type AdminSessionRecord,
  type CreateAdminSessionInput,
  type IAdminSessionRepository,
} from '../application/ports/admin-session.repository.port';

@Injectable()
export class AdminSessionPrismaRepository implements IAdminSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateAdminSessionInput): Promise<AdminSessionRecord> {
    const row = await this.prisma.adminSession.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        adminUserId: input.adminUserId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
    return toRecord(row);
  }

  async findActiveByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<AdminSessionRecord | null> {
    const row = await this.prisma.adminSession.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
    });
    return row ? toRecord(row) : null;
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.prisma.adminSession.update({
      where: { id },
      data: { revokedAt: at },
    });
  }

  async recordStepUp(id: string, at: Date): Promise<void> {
    await this.prisma.adminSession.update({
      where: { id },
      data: { stepUpCompletedAt: at },
    });
  }

  async findById(id: string): Promise<AdminSessionRecord | null> {
    const row = await this.prisma.adminSession.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async listForAdmin(adminUserId: string): Promise<AdminSessionRecord[]> {
    const rows = await this.prisma.adminSession.findMany({
      where: { adminUserId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRecord);
  }

  async revokeAllForAdmin(adminUserId: string, at: Date): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { adminUserId, revokedAt: null },
      data: { revokedAt: at },
    });
  }
}

function toRecord(row: AdminSession): AdminSessionRecord {
  return {
    id: row.id,
    adminUserId: row.adminUserId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    stepUpCompletedAt: row.stepUpCompletedAt,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };
}
