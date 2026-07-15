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

/** Row shape for the raw handle-owner lookups (users LEFT JOIN kyc_profiles). */
interface HandleOwnerRow {
  id: string;
  handle: string;
  firstName: string | null;
  lastName: string | null;
}

@Injectable()
export class HandlePrismaRepository implements IHandleRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The case-insensitive handle lookups use RAW parameterized SQL
   * (`lower("col") = $1`) rather than Prisma's `{ equals, mode: 'insensitive' }`
   * filter. That filter compiles to `col ILIKE $1`, which the planner CANNOT
   * satisfy with the `lower(col)` functional indexes from the Task-2 migration
   * (`users_payId_lower_key`, `public_aliases_alias_lower_key`) — it degrades to
   * a sequential scan of the WHOLE users / public_aliases table. `resolveHandle`
   * is the hot path (called on every @handle send, Task 9), so these MUST hit
   * the index. The tagged-template interpolation is parameterized ($1), not
   * string-concatenated — no SQL-injection surface. `handleLower` is already
   * normalized to lowercase by the caller (HandleService), so it matches the
   * lower(col) index expression exactly.
   */
  async findUserByPayId(
    handleLower: string,
  ): Promise<HandleOwnerRecord | null> {
    const rows = await this.prisma.$queryRaw<HandleOwnerRow[]>`
      SELECT u."id", u."payId" AS "handle", k."firstName", k."lastName"
      FROM "users" u
      LEFT JOIN "kyc_profiles" k ON k."userId" = u."id"
      WHERE lower(u."payId") = ${handleLower}
      LIMIT 1
    `;
    return rows.length > 0 ? this.toOwner(rows[0]) : null;
  }

  /**
   * The user's own handle by internal id: their PayID via COALESCE, falling back
   * to their earliest public nickname. One round-trip; the correlated sub-select
   * only runs for the (rare) payId-less user. Returns null when both are absent
   * (COALESCE → NULL). `userId` is cast to uuid to match the `users.id` column.
   */
  async findHandleByUserId(userId: string): Promise<HandleOwnerRecord | null> {
    const rows = await this.prisma.$queryRaw<
      Array<HandleOwnerRow & { handle: string | null }>
    >`
      SELECT u."id",
             COALESCE(u."payId", (
               SELECT a."alias" FROM "public_aliases" a
               WHERE a."userId" = u."id"
               ORDER BY a."createdAt" ASC
               LIMIT 1
             )) AS "handle",
             k."firstName", k."lastName"
      FROM "users" u
      LEFT JOIN "kyc_profiles" k ON k."userId" = u."id"
      WHERE u."id" = ${userId}::uuid
      LIMIT 1
    `;
    if (rows.length === 0 || rows[0].handle === null) return null;
    return this.toOwner({ ...rows[0], handle: rows[0].handle });
  }

  async findAliasOwner(handleLower: string): Promise<HandleOwnerRecord | null> {
    const rows = await this.prisma.$queryRaw<HandleOwnerRow[]>`
      SELECT u."id", a."alias" AS "handle", k."firstName", k."lastName"
      FROM "public_aliases" a
      JOIN "users" u ON u."id" = a."userId"
      LEFT JOIN "kyc_profiles" k ON k."userId" = u."id"
      WHERE lower(a."alias") = ${handleLower}
      LIMIT 1
    `;
    return rows.length > 0 ? this.toOwner(rows[0]) : null;
  }

  async isPayIdTaken(handleLower: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ one: number }>>`
      SELECT 1 AS "one" FROM "users" WHERE lower("payId") = ${handleLower} LIMIT 1
    `;
    return rows.length > 0;
  }

  async isAliasTaken(handleLower: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ one: number }>>`
      SELECT 1 AS "one" FROM "public_aliases" WHERE lower("alias") = ${handleLower} LIMIT 1
    `;
    return rows.length > 0;
  }

  private toOwner(row: HandleOwnerRow): HandleOwnerRecord {
    return {
      userId: row.id,
      handle: row.handle,
      firstName: row.firstName,
      lastName: row.lastName,
    };
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

  async setPayId(userId: string, payId: string): Promise<boolean> {
    try {
      // CONDITIONAL write (`where: { payIdChangedAt: null }`) — this is what
      // actually enforces "change exactly once" under concurrency, NOT the
      // read in HandleService.changePayId. Two concurrent calls both pass the
      // stale getPayIdChangedAt read; only the FIRST conditional updateMany
      // matches the row (payIdChangedAt still null) and writes — the second
      // matches zero rows (count === 0) and returns false, so the service
      // throws PayIdAlreadyChangedError. An unconditional update would let both
      // writes land, defeating the guard (TOCTOU).
      const { count } = await this.prisma.user.updateMany({
        where: { id: userId, payIdChangedAt: null },
        data: { payId, payIdChangedAt: new Date() },
      });
      return count > 0;
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
