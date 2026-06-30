import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import type { IAuthSessionRepository } from '../application/ports/auth-session.repository.port';

@Injectable()
export class AuthSessionPrismaRepository implements IAuthSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    userId: string;
    deviceId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<{ sessionId: string }> {
    const row = await this.prisma.session.create({
      data: {
        userId: input.userId,
        deviceId: input.deviceId,
        accessTokenHash: input.accessTokenHash,
        refreshTokenHash: input.refreshTokenHash,
        channel: 'web',
        isActive: true,
        expiresAt: input.expiresAt,
        lastActivityAt: new Date(),
      },
      select: { id: true },
    });
    return { sessionId: row.id };
  }

  async findActiveByAccessHash(
    accessTokenHash: string,
    now: Date,
  ): Promise<{ id: string; userId: string; deviceId: string | null } | null> {
    const row = await this.prisma.session.findFirst({
      where: {
        accessTokenHash,
        isActive: true,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true, userId: true, deviceId: true },
    });
    return row ?? null;
  }

  async findActiveByRefreshHash(
    refreshTokenHash: string,
    now: Date,
  ): Promise<{ id: string; userId: string; deviceId: string | null } | null> {
    const row = await this.prisma.session.findFirst({
      where: {
        refreshTokenHash,
        isActive: true,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true, userId: true, deviceId: true },
    });
    return row ?? null;
  }

  async rotate(
    sessionId: string,
    input: { accessTokenHash: string; refreshTokenHash: string; now: Date },
  ): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        accessTokenHash: input.accessTokenHash,
        refreshTokenHash: input.refreshTokenHash,
        lastActivityAt: input.now,
      },
    });
  }

  async revoke(sessionId: string, now: Date, reason?: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { isActive: false, revokedAt: now, revokedReason: reason },
    });
  }
}
