/**
 * Prisma adapter for IPatRepository (Wave C — PAT/MCP surface).
 *
 * Infrastructure layer only — the sole place this feature touches
 * PrismaService (§3.2). Reads project MASKED records (tokenHash is selected
 * only as the WHERE key on the auth path, never returned); `revoke` is an
 * updateMany scoped by userId so a foreign id can never be revoked.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  IPatRepository,
  PatPrincipalRecord,
  PatRecord,
} from '../application/ports/pat.repository.port';

const MASKED_SELECT = {
  id: true,
  label: true,
  scopes: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
} as const;

@Injectable()
export class PatPrismaRepository implements IPatRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    userId: string;
    label: string;
    tokenHash: string;
    scopes: string[];
    expiresAt: Date | null;
  }): Promise<PatRecord> {
    return this.prisma.personalAccessToken.create({
      data: {
        userId: input.userId,
        label: input.label,
        tokenHash: input.tokenHash,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
      },
      select: MASKED_SELECT,
    });
  }

  async listForUser(userId: string): Promise<PatRecord[]> {
    return this.prisma.personalAccessToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: MASKED_SELECT,
    });
  }

  async findActiveByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<PatPrincipalRecord | null> {
    const row = await this.prisma.personalAccessToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true, userId: true, scopes: true },
    });
    if (row === null) return null;
    return { patId: row.id, userId: row.userId, scopes: row.scopes };
  }

  async revoke(
    userId: string,
    patId: string,
    revokedAt: Date,
  ): Promise<boolean> {
    // Scope by userId (cross-user safety) AND unrevoked (already-revoked → no-op).
    const { count } = await this.prisma.personalAccessToken.updateMany({
      where: { id: patId, userId, revokedAt: null },
      data: { revokedAt },
    });
    return count > 0;
  }

  async touchLastUsed(patId: string, at: Date): Promise<void> {
    await this.prisma.personalAccessToken.update({
      where: { id: patId },
      data: { lastUsedAt: at },
    });
  }
}
