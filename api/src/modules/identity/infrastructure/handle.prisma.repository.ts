import { Injectable } from '@nestjs/common';

// The generated Prisma client is the ONLY sanctioned DB door (CLAUDE.md §3.2).
// This is the infrastructure layer — the only place it is allowed.
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { HandleTakenError } from '../domain/handle-errors';
import type {
  HandleOwnerRecord,
  IHandleRepository,
  PublicNicknameRecord,
} from '../application/ports/handle.repository.port';

const NICKNAME_SELECT = { id: true, alias: true } as const;

@Injectable()
export class HandlePrismaRepository implements IHandleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByPayId(
    handleLower: string,
  ): Promise<HandleOwnerRecord | null> {
    const user = await this.prisma.user.findFirst({
      where: { payId: { equals: handleLower, mode: 'insensitive' } },
      select: {
        id: true,
        payId: true,
        kycProfile: { select: { firstName: true, lastName: true } },
      },
    });
    // payId is nullable at the schema level; a matching row always has one
    // (the query filtered on it), but the type is widened — guard anyway.
    if (!user?.payId) return null;
    return {
      userId: user.id,
      handle: user.payId,
      firstName: user.kycProfile?.firstName ?? null,
      lastName: user.kycProfile?.lastName ?? null,
    };
  }

  async findAliasOwner(handleLower: string): Promise<HandleOwnerRecord | null> {
    const row = await this.prisma.publicAlias.findFirst({
      where: { alias: { equals: handleLower, mode: 'insensitive' } },
      select: {
        alias: true,
        user: {
          select: {
            id: true,
            kycProfile: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!row) return null;
    return {
      userId: row.user.id,
      handle: row.alias,
      firstName: row.user.kycProfile?.firstName ?? null,
      lastName: row.user.kycProfile?.lastName ?? null,
    };
  }

  async isPayIdTaken(handleLower: string): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: { payId: { equals: handleLower, mode: 'insensitive' } },
    });
    return count > 0;
  }

  async isAliasTaken(handleLower: string): Promise<boolean> {
    const count = await this.prisma.publicAlias.count({
      where: { alias: { equals: handleLower, mode: 'insensitive' } },
    });
    return count > 0;
  }

  async countPublicNicknames(userId: string): Promise<number> {
    return this.prisma.publicAlias.count({ where: { userId } });
  }

  async createPublicNickname(
    userId: string,
    alias: string,
  ): Promise<PublicNicknameRecord> {
    try {
      return await this.prisma.publicAlias.create({
        data: { userId, alias },
        select: NICKNAME_SELECT,
      });
    } catch (err) {
      // The `public_aliases_alias_lower_key` partial index (migration
      // 20260714113651) is the DB-level backstop closing the check-then-act
      // race the service already screened with isPayIdTaken/isAliasTaken.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new HandleTakenError(alias);
      }
      throw err;
    }
  }

  async deletePublicNickname(userId: string, id: string): Promise<void> {
    // Scoped delete: a foreign or unknown id matches zero rows — a silent
    // no-op, not an error (§3.1, this endpoint moves no money).
    await this.prisma.publicAlias.deleteMany({ where: { id, userId } });
  }

  async listPublicNicknames(userId: string): Promise<PublicNicknameRecord[]> {
    return this.prisma.publicAlias.findMany({
      where: { userId },
      select: NICKNAME_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async getPayIdChangedAt(userId: string): Promise<Date | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { payIdChangedAt: true },
    });
    return user?.payIdChangedAt ?? null;
  }

  async setPayId(userId: string, payId: string): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { payId, payIdChangedAt: new Date() },
      });
    } catch (err) {
      // `users_payId_lower_key` (migration 20260714113651) is the DB-level
      // backstop closing the check-then-act race against a concurrent claim.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new HandleTakenError(payId);
      }
      throw err;
    }
  }
}
