import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  type ActiveAdminInvitationRecord,
  type AdminInvitationCreatedRecord,
  type CreateAdminInvitationInput,
  type IAdminInvitationRepository,
} from '../application/ports/admin-invitation.repository.port';

@Injectable()
export class AdminInvitationPrismaRepository implements IAdminInvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    input: CreateAdminInvitationInput,
  ): Promise<AdminInvitationCreatedRecord> {
    const row = await this.prisma.adminInvitation.create({
      data: {
        email: input.email,
        roleId: input.roleId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        createdByAdminId: input.createdByAdminId,
        reason: input.reason ?? null,
      },
      select: { id: true, email: true, expiresAt: true },
    });
    return { id: row.id, email: row.email, expiresAt: row.expiresAt };
  }

  async findActiveByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<ActiveAdminInvitationRecord | null> {
    const row = await this.prisma.adminInvitation.findFirst({
      where: { tokenHash, acceptedAt: null, expiresAt: { gt: now } },
      select: { id: true, email: true, roleId: true },
    });
    return row ? { id: row.id, email: row.email, roleId: row.roleId } : null;
  }

  async markAccepted(id: string, at: Date): Promise<void> {
    await this.prisma.adminInvitation.update({
      where: { id },
      data: { acceptedAt: at },
    });
  }

  async countAdmins(): Promise<number> {
    return this.prisma.adminUser.count();
  }
}
