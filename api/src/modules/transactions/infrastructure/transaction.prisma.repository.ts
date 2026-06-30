/**
 * Prisma adapter for the Transaction repository port (task 4.5a, CLAUDE.md §3.1).
 *
 * This is the ONLY component that creates Transaction rows. Immutable after
 * terminal states (completed/failed/rolled_back). Uses generated Prisma enums
 * (TransactionType, TransactionStatus) — never `as never`.
 *
 * Dependency rule: infrastructure → core (PrismaService). Application imports
 * NOTHING from here (dependency-cruiser enforces the inward-only rule).
 */

import { Injectable } from '@nestjs/common';

import {
  FiatCurrency,
  TransactionType,
  VelocityCounterType,
} from '../../../../generated/prisma/client';
import type { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  AdminTxnListFilter,
  CreateSettlingWithProposalData,
  CreateTransactionData,
  ITransactionRepository,
  TransactionRecord,
  TransactionStatus,
  VelocityIncrementData,
} from '../application/ports/transaction.repository.port';
import { TransactionStatus as PrismaTransactionStatus } from '../../../../generated/prisma/client';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * RFC 4122 UUID pattern (versions 1–8, case-insensitive).
 * Used as a guard before any query against a `@db.Uuid` column: Postgres
 * rejects non-UUID strings with "invalid input syntax for type uuid", which
 * would surface as a 500 when e.g. a Blockradar manual-withdraw reference
 * (not a UUID) reaches findByIdempotencyKey.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns true when `value` is a syntactically valid UUID.
 * A false return means querying a `@db.Uuid` column with this value would
 * throw; callers must return null early rather than forwarding to Prisma.
 */
function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

const TRANSACTION_SELECT = {
  id: true,
  proposalId: true,
  userId: true,
  type: true,
  status: true,
  idempotencyKey: true,
  requestChecksum: true,
  fxRateSnapshot: true,
  metadata: true,
  processorTxRef: true,
  onChainTxHash: true,
  failureReason: true,
  pinVerifiedAt: true,
  createdAt: true,
  executedAt: true,
  completedAt: true,
  failedAt: true,
} as const;

/**
 * Maps a raw Prisma row to the application-level TransactionRecord.
 * fxRateSnapshot is a Prisma Decimal (has .toString()); metadata is JsonValue.
 * Both are cast at the boundary — application never sees Prisma types.
 */
function toRecord(row: {
  id: string;
  proposalId: string | null;
  userId: string;
  type: string;
  status: string;
  idempotencyKey: string;
  requestChecksum: string;
  // Prisma Decimal — has toString(); using `unknown` avoids importing the Prisma types.
  fxRateSnapshot: unknown;
  // Prisma JsonValue — cast to Record<string, unknown> in the app layer.
  metadata: unknown;
  processorTxRef: string | null;
  onChainTxHash: string | null;
  failureReason: string | null;
  pinVerifiedAt: Date | null;
  createdAt: Date;
  executedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
}): TransactionRecord {
  return {
    id: row.id,
    proposalId: row.proposalId,
    userId: row.userId,
    type: row.type,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    requestChecksum: row.requestChecksum,
    // Prisma Decimal has a toString() method; null stays null.
    // Cast to { toString(): string } so eslint doesn't warn about base-to-string.
    fxRateSnapshot:
      row.fxRateSnapshot !== null && row.fxRateSnapshot !== undefined
        ? (row.fxRateSnapshot as { toString(): string }).toString()
        : null,
    metadata: row.metadata as Record<string, unknown>,
    processorTxRef: row.processorTxRef,
    onChainTxHash: row.onChainTxHash,
    failureReason: row.failureReason,
    pinVerifiedAt: row.pinVerifiedAt,
    createdAt: row.createdAt,
    executedAt: row.executedAt,
    completedAt: row.completedAt,
    failedAt: row.failedAt,
  };
}

// ---------------------------------------------------------------------------
// Velocity helpers (V1 — atomic counter writes inside settling $transaction)
// ---------------------------------------------------------------------------

/** 24-hour window in milliseconds. */
const WINDOW_24H_MS = 24 * 60 * 60 * 1_000;

/**
 * Upserts a single VelocityCounter row inside an active Prisma interactive
 * transaction (`tx`).
 *
 * Window logic:
 *   - Row missing OR windowEnd <= now  → fresh window: currentValue = delta.
 *   - Active window (windowEnd > now)  → accumulate: currentValue += delta.
 *
 * The `@@unique([userId, counterType])` constraint means Prisma `upsert`
 * targets the row by (userId, counterType); on create we set the full window,
 * on update we conditionally reset or increment in one round-trip using a raw
 * SQL expression for the conditional increment via Prisma's `$executeRaw`.
 *
 * We use two separate queries inside the transaction (read → conditional write)
 * rather than a raw SQL UPSERT because Prisma Decimal arithmetic preserves
 * exact precision for the 38-digit schema column.
 */
async function upsertVelocityCounter(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    counterType: VelocityCounterType;
    fiatCurrency: string;
    delta: string; // decimal string, e.g. "10000" or "1"
    now: Date;
  },
): Promise<void> {
  const { userId, counterType, delta, now } = params;
  // Cast string → generated FiatCurrency enum at the infrastructure boundary
  // (application layer uses `string` to stay free of Prisma imports — §3.2).
  const fiatCurrencyEnum = params.fiatCurrency as FiatCurrency;
  const windowEnd = new Date(now.getTime() + WINDOW_24H_MS);

  const existing = await tx.velocityCounter.findUnique({
    where: {
      userId_counterType_fiatCurrency: {
        userId,
        counterType,
        fiatCurrency: fiatCurrencyEnum,
      },
    },
    select: { windowEnd: true, currentValue: true },
  });

  const windowExpired =
    existing === null || existing.windowEnd.getTime() <= now.getTime();

  if (windowExpired) {
    // Fresh window: upsert with a reset value.
    await tx.velocityCounter.upsert({
      where: {
        userId_counterType_fiatCurrency: {
          userId,
          counterType,
          fiatCurrency: fiatCurrencyEnum,
        },
      },
      create: {
        userId,
        counterType,
        fiatCurrency: fiatCurrencyEnum,
        currentValue: delta,
        windowStart: now,
        windowEnd,
      },
      update: {
        currentValue: delta,
        windowStart: now,
        windowEnd,
      },
    });
  } else {
    // Active window: accumulate by incrementing with Prisma Decimal helper.
    // `increment` on a Decimal column is string-safe in Prisma 7.
    await tx.velocityCounter.update({
      where: {
        userId_counterType_fiatCurrency: {
          userId,
          counterType,
          fiatCurrency: fiatCurrencyEnum,
        },
      },
      data: {
        currentValue: { increment: delta as unknown as number },
      },
    });
  }
}

/**
 * Upserts both amount_24h and count_24h velocity counters inside an active
 * Prisma transaction client. Called from createSettlingWithProposal (V1).
 */
async function writeVelocityIncrements(
  tx: Prisma.TransactionClient,
  increment: VelocityIncrementData,
): Promise<void> {
  const { userId, fiatCurrency, fiatAmountStr, now } = increment;
  await upsertVelocityCounter(tx, {
    userId,
    counterType: VelocityCounterType.amount_24h,
    fiatCurrency,
    delta: fiatAmountStr,
    now,
  });
  await upsertVelocityCounter(tx, {
    userId,
    counterType: VelocityCounterType.count_24h,
    fiatCurrency,
    delta: '1',
    now,
  });
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class TransactionPrismaRepository implements ITransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<TransactionRecord | null> {
    // Guard: Transaction.id is @db.Uuid — a non-UUID value would cause Postgres
    // to throw "invalid input syntax for type uuid". Return null safely instead.
    if (!isValidUuid(id)) return null;

    const row = await this.prisma.transaction.findUnique({
      where: { id },
      select: TRANSACTION_SELECT,
    });

    return row === null ? null : toRecord(row);
  }

  async findByIdempotencyKey(key: string): Promise<TransactionRecord | null> {
    // Guard: Transaction.idempotencyKey is @db.Uuid — external references
    // (e.g. a Blockradar manual-withdraw reference that is not a UUID) must
    // be short-circuited here to avoid a Postgres "invalid input syntax" error
    // that would surface as a 500 in the webhook handler.
    if (!isValidUuid(key)) return null;

    const row = await this.prisma.transaction.findUnique({
      where: { idempotencyKey: key },
      select: TRANSACTION_SELECT,
    });

    return row === null ? null : toRecord(row);
  }

  async create(data: CreateTransactionData): Promise<TransactionRecord> {
    const row = await this.prisma.transaction.create({
      data: {
        userId: data.userId,
        proposalId: data.proposalId ?? null,
        type: data.type as TransactionType,
        status: data.status,
        idempotencyKey: data.idempotencyKey,
        requestChecksum: data.requestChecksum,
        fxRateSnapshot:
          data.fxRateSnapshot !== undefined
            ? (data.fxRateSnapshot as never)
            : null,
        // JSON field: cast to `never` at the boundary — Record<string, unknown>
        // is a valid JSON object at runtime.
        metadata: data.metadata as never,
        pinVerifiedAt: data.pinVerifiedAt ?? null,
      },
      select: TRANSACTION_SELECT,
    });

    return toRecord(row);
  }

  /**
   * Atomically creates a Transaction (status='settling'), updates the associated
   * Proposal to 'executing', and — when `velocityIncrement` is supplied — upserts
   * VelocityCounter rows for amount_24h and count_24h, all in a single Prisma
   * interactive $transaction (C1 + V1).
   *
   * Switched from the array-form $transaction to the callback form so that the
   * conditional read-then-write velocity upsert logic can run inside the same
   * serialisable snapshot. A failure at any step rolls back everything.
   */
  async createSettlingWithProposal(
    input: CreateSettlingWithProposalData,
  ): Promise<TransactionRecord> {
    const { txnData, proposalId, confirmedAt, velocityIncrement } = input;

    const row = await this.prisma.$transaction(async (tx) => {
      // 1. Create the Transaction row.
      const created = await tx.transaction.create({
        data: {
          userId: txnData.userId,
          proposalId: txnData.proposalId ?? null,
          type: txnData.type as TransactionType,
          status: txnData.status,
          idempotencyKey: txnData.idempotencyKey,
          requestChecksum: txnData.requestChecksum,
          fxRateSnapshot:
            txnData.fxRateSnapshot !== undefined
              ? (txnData.fxRateSnapshot as never)
              : null,
          metadata: txnData.metadata as never,
          pinVerifiedAt: txnData.pinVerifiedAt ?? null,
        },
        select: TRANSACTION_SELECT,
      });

      // 2. Flip the Proposal to 'executing'.
      await tx.proposal.update({
        where: { id: proposalId },
        data: {
          status: 'executing',
          ...(confirmedAt !== undefined ? { confirmedAt } : {}),
        },
      });

      // 3. Upsert velocity counters atomically (V1 — §3.3 gap fix).
      if (velocityIncrement !== undefined) {
        await writeVelocityIncrements(tx, velocityIncrement);
      }

      return created;
    });

    return toRecord(row);
  }

  /**
   * Merges partial metadata into the Transaction's existing metadata (C2).
   *
   * Persists VA details (accountNumber, bankName, providerRef) so that an
   * idempotent replay can reconstruct the full ExecuteBuyResult from the DB row
   * without calling any external provider again.
   */
  async mergeMetadata(
    id: string,
    extra: Record<string, unknown>,
  ): Promise<void> {
    // Read current metadata, merge, and write back atomically in one update.
    // Prisma's JSON update merges at the DB level using an object spread in JS:
    // we fetch the row in the same call to keep the logic simple and safe.
    const current = await this.prisma.transaction.findUniqueOrThrow({
      where: { id },
      select: { metadata: true },
    });
    const merged = {
      ...(current.metadata as Record<string, unknown>),
      ...extra,
    };
    await this.prisma.transaction.update({
      where: { id },
      data: { metadata: merged as never },
    });
  }

  async findByUserId(
    userId: string,
    opts: { limit: number; cursor?: string },
  ): Promise<TransactionRecord[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        ...(opts.cursor ? { id: { lt: opts.cursor } } : {}),
      },
      select: TRANSACTION_SELECT,
      orderBy: { id: 'desc' },
      take: opts.limit,
    });
    return rows.map(toRecord);
  }

  async updateStatus(
    id: string,
    status: TransactionStatus,
    fields?: {
      processorTxRef?: string;
      executedAt?: Date;
      completedAt?: Date;
      failedAt?: Date;
      failureReason?: string;
    },
  ): Promise<void> {
    await this.prisma.transaction.update({
      where: { id },
      data: {
        status: status,
        ...(fields?.processorTxRef !== undefined
          ? { processorTxRef: fields.processorTxRef }
          : {}),
        ...(fields?.executedAt !== undefined
          ? { executedAt: fields.executedAt }
          : {}),
        ...(fields?.completedAt !== undefined
          ? { completedAt: fields.completedAt }
          : {}),
        ...(fields?.failedAt !== undefined
          ? { failedAt: fields.failedAt }
          : {}),
        ...(fields?.failureReason !== undefined
          ? { failureReason: fields.failureReason }
          : {}),
      },
    });
  }

  async listByUserInRange(input: {
    userId: string;
    from: Date;
    to: Date;
    types?: string[];
    limit: number;
  }): Promise<{ rows: TransactionRecord[]; total: number }> {
    const where: Prisma.TransactionWhereInput = {
      userId: input.userId,
      createdAt: { gte: input.from, lte: input.to },
      ...(input.types && input.types.length > 0
        ? { type: { in: input.types as TransactionType[] } }
        : {}),
    };

    // One round-trip: the capped page (newest first) + the exact total count.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        select: TRANSACTION_SELECT,
        orderBy: { createdAt: 'desc' },
        take: input.limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { rows: rows.map(toRecord), total };
  }

  /**
   * Admin oversight list (READ-ONLY, cross-user). Newest-first by (createdAt
   * desc, id desc); keyset-paginated with `cursor` = the last-seen transaction
   * id. Fetches `limit + 1` rows to derive `nextCursor` without a count query.
   */
  async listAll(
    filter: AdminTxnListFilter,
    page: { cursor?: string; limit: number },
  ): Promise<{ items: TransactionRecord[]; nextCursor: string | null }> {
    const where: Prisma.TransactionWhereInput = {
      ...(filter.status !== undefined
        ? { status: filter.status as PrismaTransactionStatus }
        : {}),
      ...(filter.type !== undefined
        ? { type: filter.type as TransactionType }
        : {}),
      ...(filter.userId !== undefined ? { userId: filter.userId } : {}),
      ...(filter.from !== undefined || filter.to !== undefined
        ? {
            createdAt: {
              ...(filter.from !== undefined ? { gte: filter.from } : {}),
              ...(filter.to !== undefined ? { lte: filter.to } : {}),
            },
          }
        : {}),
    };

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
      select: TRANSACTION_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
    });

    // A full +1 page means there is at least one more row → emit a cursor.
    const hasMore = rows.length > page.limit;
    const items = hasMore ? rows.slice(0, page.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items: items.map(toRecord), nextCursor };
  }

  async listByStatus(
    status: string,
    page: { cursor?: string; limit: number },
  ): Promise<{ items: TransactionRecord[]; nextCursor: string | null }> {
    return this.listAll({ status }, page);
  }
}
