/**
 * Prisma adapter for IUserSessionReadRepository (admin user-detail Security tab).
 *
 * The READ path selects only non-secret session metadata joined to the bound
 * device for UA/IP telemetry — `accessTokenHash` / `refreshTokenHash` are NEVER
 * selected, so token hashes cannot leak past this port (§3.4 spirit: minimal,
 * non-secret projection). The WRITE path (Phase 9) marks sessions REVOKED via
 * `updateMany` (never deletes — the row is retained for the audit trail), always
 * scoped by `userId` so an admin can never revoke another user's session.
 *
 * Infrastructure layer only — the only place this feature imports the generated
 * Prisma client / PrismaService (dependency-cruiser rule §3.2). Maps Prisma rows
 * to the application-level UserSessionRecord so no Prisma type leaks upward.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  IUserSessionReadRepository,
  UserSessionRecord,
} from '../application/ports/user-session-read.repository.port';

@Injectable()
export class UserSessionReadPrismaRepository implements IUserSessionReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(
    userId: string,
    limit: number,
  ): Promise<UserSessionRecord[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId },
      // Active sessions first, then newest-issued — matches the Security tab
      // where a live session should surface above expired/revoked history.
      orderBy: [{ isActive: 'desc' }, { issuedAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        channel: true,
        deviceId: true,
        isActive: true,
        stepUpCompletedAt: true,
        issuedAt: true,
        expiresAt: true,
        lastActivityAt: true,
        revokedAt: true,
        // Join the device for UA/IP telemetry (routing only — never an auth anchor).
        device: {
          select: { userAgent: true, ipAddressAtBinding: true },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      deviceId: row.deviceId,
      userAgent: row.device?.userAgent ?? null,
      ipAddress: row.device?.ipAddressAtBinding ?? null,
      isActive: row.isActive,
      stepUpCompletedAt: row.stepUpCompletedAt,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      lastActivityAt: row.lastActivityAt,
      revokedAt: row.revokedAt,
    }));
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    revokedAt: Date,
    reason: string,
  ): Promise<boolean> {
    // Scope by userId (cross-user safety) AND isActive (already-revoked → no-op).
    // updateMany returns the affected count without needing a prior read.
    const { count } = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, isActive: true },
      data: { isActive: false, revokedAt, revokedReason: reason },
    });
    return count > 0;
  }

  async revokeAllForUser(
    userId: string,
    revokedAt: Date,
    reason: string,
  ): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false, revokedAt, revokedReason: reason },
    });
    return count;
  }
}
