/**
 * Prisma implementation of ISessionRepository (Fix G).
 *
 * Lives in core/auth/infrastructure so that PrismaService is accessible
 * (core may use PrismaService — CLAUDE.md §4.1). The service layer (SessionService)
 * only sees the ISessionRepository port; it never imports this file.
 *
 * Session rows on the WhatsApp flow path use a synthetic accessTokenHash (a
 * random UUID) because real JWT tokens are managed by the web-app auth layer.
 * The synthetic token is unique-per-session and safe to store hashed in the
 * same column — this is explicitly noted so future auth revamp can clean up.
 */

import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import type {
  ISessionRepository,
  SessionRecord,
} from '../ports/session.repository.port';

// Step-up session TTL on creation: 24 hours. The real expiry is the stepUp TTL
// (auth.stepUp.ttlSeconds); this just keeps the Session row alive long enough.
const SESSION_DURATION_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class SessionPrismaRepository implements ISessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveByUserAndDevice(
    userId: string,
    deviceId: string,
  ): Promise<SessionRecord | null> {
    const now = new Date();
    const row = await this.prisma.session.findFirst({
      where: {
        userId,
        deviceId,
        isActive: true,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        deviceId: true,
        stepUpCompletedAt: true,
        expiresAt: true,
        isActive: true,
      },
    });

    if (row === null) return null;

    return {
      id: row.id,
      userId: row.userId,
      deviceId: row.deviceId,
      stepUpCompletedAt: row.stepUpCompletedAt,
      expiresAt: row.expiresAt,
      isActive: row.isActive,
    };
  }

  async touchOrCreate(
    userId: string,
    deviceId: string,
    now: Date,
  ): Promise<SessionRecord> {
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

    // Try to find and update an existing active session first.
    const existing = await this.findActiveByUserAndDevice(userId, deviceId);

    if (existing !== null) {
      // Bump lastActivityAt on the existing session row.
      await this.prisma.session.update({
        where: { id: existing.id },
        data: { lastActivityAt: now },
      });
      return existing;
    }

    // No active session — create one with synthetic token hashes.
    // accessTokenHash and refreshTokenHash must be unique strings.
    const created = await this.prisma.session.create({
      data: {
        userId,
        deviceId,
        // Synthetic token hashes: UUID prefixed to guarantee uniqueness and
        // distinguish them from real JWT hashes if we ever inspect the table.
        accessTokenHash: `synthetic_access_${randomUUID()}`,
        refreshTokenHash: `synthetic_refresh_${randomUUID()}`,
        channel: 'web',
        isActive: true,
        issuedAt: now,
        expiresAt,
        lastActivityAt: now,
      },
      select: {
        id: true,
        userId: true,
        deviceId: true,
        stepUpCompletedAt: true,
        expiresAt: true,
        isActive: true,
      },
    });

    return {
      id: created.id,
      userId: created.userId,
      deviceId: created.deviceId,
      stepUpCompletedAt: created.stepUpCompletedAt,
      expiresAt: created.expiresAt,
      isActive: created.isActive,
    };
  }

  async recordStepUp(
    userId: string,
    deviceId: string,
    stepUpCompletedAt: Date,
  ): Promise<void> {
    // Update the most recently created active session row.
    // updateMany is safe here: in practice there's only one active session per
    // (userId, deviceId) pair because touchOrCreate reuses existing ones.
    await this.prisma.session.updateMany({
      where: {
        userId,
        deviceId,
        isActive: true,
        revokedAt: null,
      },
      data: { stepUpCompletedAt },
    });
  }

  async findPinnedDeviceId(userId: string): Promise<string | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pinnedDeviceId: true },
    });
    return row?.pinnedDeviceId ?? null;
  }
}
