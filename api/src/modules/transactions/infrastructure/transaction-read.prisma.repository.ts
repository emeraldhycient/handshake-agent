/**
 * Prisma adapter for the admin-facing transaction READ port (Phase 2, Task 2).
 *
 * Read-only: it never creates or mutates Transaction rows (that is solely
 * ExecutionService via TransactionPrismaRepository). Maps Prisma rows to the
 * application-level TransactionListRecord so no Prisma type leaks past
 * infrastructure.
 *
 * Dependency rule: infrastructure → core (PrismaService). Application imports
 * NOTHING from here (dependency-cruiser enforces the inward-only rule).
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  ITransactionReadRepository,
  TransactionListRecord,
} from '../application/ports/transaction-read.repository.port';

@Injectable()
export class TransactionReadPrismaRepository implements ITransactionReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(
    userId: string,
    limit: number,
  ): Promise<TransactionListRecord[]> {
    const rows = await this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        status: true,
        metadata: true,
        createdAt: true,
      },
    });

    return rows.map((row) => {
      const econ = projectEconomics(row.metadata);
      return {
        id: row.id,
        type: row.type,
        status: row.status,
        asset: econ.asset,
        amount: econ.amount,
        fiatAmount: econ.fiatAmount,
        fiatCurrency: econ.fiatCurrency,
        createdAt: row.createdAt,
      };
    });
  }
}

/**
 * Best-effort projection of the amount/asset/fiat leg from Transaction.metadata
 * (a Json blob: { asset, amount, fiatAmount, fiatCurrency, ... }). Any field the
 * JSON does not carry as a primitive string/number resolves to null — this is a
 * trust boundary (§13.6): unknown-shaped JSON never throws, it degrades to null.
 */
function projectEconomics(metadata: unknown): {
  asset: string | null;
  amount: string | null;
  fiatAmount: string | null;
  fiatCurrency: string | null;
} {
  const m =
    metadata !== null && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>)
      : {};
  return {
    asset: readString(m.asset),
    amount: readString(m.amount),
    fiatAmount: readString(m.fiatAmount),
    fiatCurrency: readString(m.fiatCurrency),
  };
}

/** Reads a metadata value as a string when it is a string or finite number, else null. */
function readString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}
