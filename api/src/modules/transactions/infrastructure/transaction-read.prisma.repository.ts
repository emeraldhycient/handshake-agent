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
      select: { id: true, type: true, status: true, createdAt: true },
    });

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      createdAt: row.createdAt,
    }));
  }
}
