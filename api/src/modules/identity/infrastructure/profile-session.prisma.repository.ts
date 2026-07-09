/**
 * Prisma adapter for IProfileSessionRepository (Wave C settings — Security tab).
 *
 * Mirrors the admin UserSessionReadPrismaRepository pattern, scoped to the
 * CURRENT user: reads select only non-secret session metadata (token hashes
 * are NEVER selected); the write marks the session REVOKED via updateMany
 * (never deletes — audit trail) always filtered by userId so a caller can
 * never revoke a foreign session (§3.2/§3.3).
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  IProfileSessionRepository,
  ProfileSessionRecord,
} from '../application/ports/profile-session.repository.port';

@Injectable()
export class ProfileSessionPrismaRepository implements IProfileSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listActiveForUser(
    userId: string,
    now: Date,
  ): Promise<ProfileSessionRecord[]> {
    const rows = await this.prisma.session.findMany({
      where: {
        userId,
        isActive: true,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { issuedAt: 'desc' },
      select: {
        id: true,
        channel: true,
        issuedAt: true,
        lastActivityAt: true,
        expiresAt: true,
        // Device join for the user-agent hint (telemetry, never an auth anchor).
        device: { select: { userAgent: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      userAgent: row.device?.userAgent ?? null,
      issuedAt: row.issuedAt,
      lastActivityAt: row.lastActivityAt,
      expiresAt: row.expiresAt,
    }));
  }

  async revokeOwn(
    userId: string,
    sessionId: string,
    revokedAt: Date,
    reason: string,
  ): Promise<boolean> {
    // Scope by userId (cross-user safety) AND isActive (already-revoked → no-op).
    const { count } = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, isActive: true },
      data: { isActive: false, revokedAt, revokedReason: reason },
    });
    return count > 0;
  }
}
