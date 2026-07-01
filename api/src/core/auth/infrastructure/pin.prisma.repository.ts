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

  async recordFailure(
    userId: string,
    count: number,
    lockedUntil: Date | null,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pinFailureCount: count,
        pinLockedUntil: lockedUntil,
      },
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
