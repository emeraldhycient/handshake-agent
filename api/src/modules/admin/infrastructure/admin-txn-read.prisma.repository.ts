import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import type { Prisma } from '../../../../generated/prisma/client';
import {
  TransactionStatus as PrismaTransactionStatus,
  TransactionType as PrismaTransactionType,
} from '../../../../generated/prisma/client';
import type {
  AdminTxnReadFilter,
  AdminTxnReadRecord,
  AdminTxnViewCountsRecord,
  IAdminTxnReadRepository,
} from '../application/ports/admin-txn-read.repository.port';

/** In-flight statuses folded into the "Stuck / Pending" view count. */
const STUCK_STATUSES: PrismaTransactionStatus[] = [
  PrismaTransactionStatus.pending,
  PrismaTransactionStatus.validating,
  PrismaTransactionStatus.confirmed,
  PrismaTransactionStatus.settling,
];

const TXN_SELECT = {
  id: true,
  userId: true,
  type: true,
  status: true,
  idempotencyKey: true,
  processorTxRef: true,
  onChainTxHash: true,
  metadata: true,
  createdAt: true,
} as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Prisma adapter for the admin TRANSACTION read repository (Phase 6b).
 *
 * Infrastructure layer only — the only place in this read path that imports the
 * Prisma client (dependency-cruiser §3.2). Reads the `transaction` table with a
 * (createdAt, id) keyset (newest-first), adds a free-text `q` OR-match, computes
 * the four view-tab counts, and joins user emails. The service never sees Prisma
 * types; `metadata` is projected as a plain record. Nothing here moves money
 * (§3.1) — it only reads.
 */
@Injectable()
export class AdminTxnReadPrismaRepository implements IAdminTxnReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    filter: AdminTxnReadFilter,
    page: { cursor?: string; limit: number },
  ): Promise<{ items: AdminTxnReadRecord[]; nextCursor: string | null }> {
    const where = this.buildWhere(filter);

    // Resolve the cursor row's createdAt so the keyset compares on (createdAt,
    // id). A non-UUID or unknown cursor yields no anchor → return the first page.
    const cursorAnchor =
      page.cursor !== undefined && isValidUuid(page.cursor)
        ? await this.prisma.transaction.findUnique({
            where: { id: page.cursor },
            select: { createdAt: true, id: true },
          })
        : null;

    const keysetWhere: Prisma.TransactionWhereInput =
      cursorAnchor !== null
        ? {
            OR: [
              { createdAt: { lt: cursorAnchor.createdAt } },
              {
                createdAt: cursorAnchor.createdAt,
                id: { lt: cursorAnchor.id },
              },
            ],
          }
        : {};

    const rows = await this.prisma.transaction.findMany({
      where: { AND: [where, keysetWhere] },
      select: TXN_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
    });

    const hasMore = rows.length > page.limit;
    const items = hasMore ? rows.slice(0, page.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items: items.map((r) => this.toRecord(r)), nextCursor };
  }

  async countViews(
    filter: AdminTxnReadFilter,
  ): Promise<AdminTxnViewCountsRecord> {
    // The base filter (q/type/userId/date) applies to every view; each view then
    // adds its own status slice. Counted over the FULL matching set (no cursor).
    const base = this.buildWhere({ ...filter, status: undefined });

    const [all, stuck, failed, refunds] = await Promise.all([
      this.prisma.transaction.count({ where: base }),
      this.prisma.transaction.count({
        where: { AND: [base, { status: { in: STUCK_STATUSES } }] },
      }),
      this.prisma.transaction.count({
        where: { AND: [base, { status: PrismaTransactionStatus.failed }] },
      }),
      this.prisma.transaction.count({
        where: { AND: [base, { status: PrismaTransactionStatus.rolled_back }] },
      }),
    ]);

    return { all, stuck, failed, refunds };
  }

  async emailsByUserIds(
    userIds: string[],
  ): Promise<Map<string, string | null>> {
    const unique = [...new Set(userIds.filter((id) => isValidUuid(id)))];
    if (unique.length === 0) return new Map();

    const rows = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, email: true },
    });

    return new Map(rows.map((r) => [r.id, r.email]));
  }

  async emailByUserId(userId: string): Promise<string | null> {
    if (!isValidUuid(userId)) return null;
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return row?.email ?? null;
  }

  /** Builds the shared Prisma where-clause from the admin filter (incl. `q`). */
  private buildWhere(filter: AdminTxnReadFilter): Prisma.TransactionWhereInput {
    const and: Prisma.TransactionWhereInput[] = [];

    if (filter.status !== undefined) {
      and.push({ status: filter.status as PrismaTransactionStatus });
    }
    if (filter.type !== undefined) {
      and.push({ type: filter.type as PrismaTransactionType });
    }
    if (filter.userId !== undefined) {
      and.push({ userId: filter.userId });
    }
    if (filter.from !== undefined || filter.to !== undefined) {
      and.push({
        createdAt: {
          ...(filter.from !== undefined ? { gte: filter.from } : {}),
          ...(filter.to !== undefined ? { lte: filter.to } : {}),
        },
      });
    }

    const q = filter.q?.trim();
    if (q) {
      // The design's "id, hash, ref…" search pill. `id` + `idempotencyKey` are
      // uuid columns (no `contains` operator) — match them by exact equality only
      // when `q` is itself a valid uuid; `onChainTxHash` / `processorTxRef` are
      // free strings matched case-insensitively by substring.
      const or: Prisma.TransactionWhereInput[] = [
        { onChainTxHash: { contains: q, mode: 'insensitive' } },
        { processorTxRef: { contains: q, mode: 'insensitive' } },
      ];
      if (isValidUuid(q)) {
        or.push({ id: q }, { idempotencyKey: q });
      }
      and.push({ OR: or });
    }

    return and.length > 0 ? { AND: and } : {};
  }

  private toRecord(row: {
    id: string;
    userId: string;
    type: string;
    status: string;
    idempotencyKey: string;
    processorTxRef: string | null;
    onChainTxHash: string | null;
    metadata: unknown;
    createdAt: Date;
  }): AdminTxnReadRecord {
    return {
      id: row.id,
      userId: row.userId,
      type: row.type,
      status: row.status,
      idempotencyKey: row.idempotencyKey,
      processorTxRef: row.processorTxRef,
      onChainTxHash: row.onChainTxHash,
      metadata:
        row.metadata !== null && typeof row.metadata === 'object'
          ? (row.metadata as Record<string, unknown>)
          : {},
      createdAt: row.createdAt,
    };
  }
}
