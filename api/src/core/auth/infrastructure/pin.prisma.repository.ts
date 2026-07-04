/**
 * Prisma implementation of IPinRepository (task 4.3).
 *
 * Lives in core/auth/infrastructure so that PrismaService is accessible
 * (core may use PrismaService — CLAUDE.md §4.1). The service layer (PinService)
 * only sees the IPinRepository port; it never imports this file.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import type { IPinRepository, PinState } from '../ports/pin.repository.port';

@Injectable()
export class PinPrismaRepository implements IPinRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getPinState(userId: string): Promise<PinState | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pinHash: true, pinFailureCount: true, pinLockedUntil: true },
    });

    if (!user) return null;

    return {
      pinHash: user.pinHash,
      pinFailureCount: user.pinFailureCount,
      pinLockedUntil: user.pinLockedUntil,
    };
  }

  async setPinHash(userId: string, pinHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash },
    });
  }

  async registerFailedAttempt(
    userId: string,
    now: Date,
  ): Promise<{ count: number; lockedUntil: Date | null }> {
    // ONE atomic statement folds the expired-window reset INTO the increment.
    // A separate resetFailures()-then-increment could interleave under a
    // concurrent burst on a just-expired lock and let every guess reach the
    // scrypt comparison — reintroducing the TOCTOU brute-force bypass
    // (CLAUDE.md §3.4). Postgres serializes the row update, so concurrent
    // callers observe strictly increasing counts. `now` comes from the service's
    // injected clock (not the DB clock) so lockout timing stays deterministic.
    const rows = await this.prisma.$queryRaw<
      Array<{ pinFailureCount: number; pinLockedUntil: Date | null }>
    >`
      UPDATE "users"
      SET
        "pinFailureCount" = CASE
          WHEN "pinLockedUntil" IS NOT NULL AND "pinLockedUntil" >  ${now} THEN "pinFailureCount"
          WHEN "pinLockedUntil" IS NOT NULL AND "pinLockedUntil" <= ${now} THEN 1
          ELSE "pinFailureCount" + 1
        END,
        "pinLockedUntil" = CASE
          WHEN "pinLockedUntil" IS NOT NULL AND "pinLockedUntil" <= ${now} THEN NULL
          ELSE "pinLockedUntil"
        END
      WHERE "id" = ${userId}::uuid
      RETURNING "pinFailureCount", "pinLockedUntil"
    `;

    const row = rows[0];
    // Row vanished between the caller's state read and this update (rare delete
    // race): report a cleared counter so the caller does not lock a ghost.
    if (!row) return { count: 0, lockedUntil: null };

    return {
      count: Number(row.pinFailureCount),
      lockedUntil: row.pinLockedUntil ?? null,
    };
  }

  async setLock(userId: string, lockedUntil: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pinLockedUntil: lockedUntil },
    });
  }

  async resetFailures(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pinFailureCount: 0,
        pinLockedUntil: null,
      },
    });
  }

  async clearPin(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pinHash: null,
        pinFailureCount: 0,
        pinLockedUntil: null,
      },
    });
  }
}
