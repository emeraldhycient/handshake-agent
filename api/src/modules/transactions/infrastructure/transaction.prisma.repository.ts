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
  TransactionStatus,
  TransactionType,
} from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  CreateTransactionData,
  ITransactionRepository,
  TransactionRecord,
} from '../application/ports/transaction.repository.port';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
  pinVerifiedAt: true,
  createdAt: true,
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
  pinVerifiedAt: Date | null;
  createdAt: Date;
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
    pinVerifiedAt: row.pinVerifiedAt,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class TransactionPrismaRepository implements ITransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByIdempotencyKey(key: string): Promise<TransactionRecord | null> {
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
        status: data.status as TransactionStatus,
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

  async updateStatus(
    id: string,
    status: string,
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
        status: status as TransactionStatus,
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
}
