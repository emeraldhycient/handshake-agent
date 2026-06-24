/**
 * Prisma adapter for the SettlementOutbox repository port (task 4.5a, Fix F).
 *
 * The outbox table is append-only: rows are created here, then dequeued and
 * retried by the SettlementReconciliationService (Fix F). Uses generated Prisma
 * enums (SettlementType, SettlementOutboxStatus) — never `as never`.
 *
 * Dependency rule: infrastructure → core (PrismaService). Application imports
 * NOTHING from here (dependency-cruiser enforces the inward-only rule).
 */

import { Injectable } from '@nestjs/common';

import {
  SettlementOutboxStatus,
  SettlementType,
} from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  CreateSettlementOutboxData,
  FindPendingOptions,
  ISettlementOutboxRepository,
  SettlementOutboxRecord,
} from '../application/ports/settlement-outbox.repository.port';

// ---------------------------------------------------------------------------
// Column selector shared by all queries to keep the return shape consistent.
// ---------------------------------------------------------------------------
const OUTBOX_SELECT = {
  id: true,
  transactionId: true,
  settlementType: true,
  payload: true,
  idempotencyKey: true,
  status: true,
  processorRef: true,
  attempt: true,
  lastAttemptAt: true,
  createdAt: true,
} as const;

@Injectable()
export class SettlementOutboxPrismaRepository implements ISettlementOutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: CreateSettlementOutboxData,
  ): Promise<SettlementOutboxRecord> {
    const row = await this.prisma.settlementOutbox.create({
      data: {
        transactionId: data.transactionId,
        settlementType: data.settlementType as SettlementType,
        // JSON field: cast to `never` at the boundary.
        payload: data.payload as never,
        idempotencyKey: data.idempotencyKey ?? null,
        status: data.status as SettlementOutboxStatus,
        processorRef: data.processorRef ?? null,
      },
      select: OUTBOX_SELECT,
    });

    return this.toRecord(row);
  }

  /**
   * Returns pending outbox rows older than olderThanSec, up to limit.
   * Ordered by createdAt ASC so oldest rows are processed first.
   */
  async findPending(
    options: FindPendingOptions,
  ): Promise<SettlementOutboxRecord[]> {
    const { olderThanSec, limit } = options;
    const cutoff = new Date(Date.now() - olderThanSec * 1_000);

    const rows = await this.prisma.settlementOutbox.findMany({
      where: {
        status: SettlementOutboxStatus.pending,
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: OUTBOX_SELECT,
    });

    return rows.map((r) => this.toRecord(r));
  }

  /**
   * Increments the attempt counter and records the attempt timestamp.
   * Does NOT change the status so a concurrent call can still see the row.
   */
  async markAttempt(id: string): Promise<void> {
    await this.prisma.settlementOutbox.update({
      where: { id },
      data: {
        attempt: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
  }

  /**
   * Transitions the row to 'completed' (terminal — row is fully drained).
   * Idempotent: updating an already-completed row is a no-op at the DB level.
   */
  async complete(id: string): Promise<void> {
    await this.prisma.settlementOutbox.update({
      where: { id },
      data: {
        status: SettlementOutboxStatus.completed,
        completedAt: new Date(),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private toRecord(row: {
    id: string;
    transactionId: string;
    settlementType: string;
    payload: unknown;
    idempotencyKey: string | null;
    status: string;
    processorRef: string | null;
    attempt: number;
    lastAttemptAt: Date | null;
    createdAt: Date;
  }): SettlementOutboxRecord {
    return {
      id: row.id,
      transactionId: row.transactionId,
      settlementType: row.settlementType,
      payload: row.payload as Record<string, unknown>,
      idempotencyKey: row.idempotencyKey,
      status: row.status,
      processorRef: row.processorRef,
      attempt: row.attempt,
      lastAttemptAt: row.lastAttemptAt,
      createdAt: row.createdAt,
    };
  }
}
