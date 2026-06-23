/**
 * Prisma adapter for the SettlementOutbox repository port (task 4.5a).
 *
 * The outbox table is append-only: rows are created here, then dequeued and
 * retried by a worker (out of scope for task 4.5a). Uses generated Prisma enums
 * (SettlementType, SettlementOutboxStatus) — never `as never`.
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
  ISettlementOutboxRepository,
  SettlementOutboxRecord,
} from '../application/ports/settlement-outbox.repository.port';

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
      select: {
        id: true,
        transactionId: true,
        settlementType: true,
        payload: true,
        idempotencyKey: true,
        status: true,
        processorRef: true,
        createdAt: true,
      },
    });

    return {
      id: row.id,
      transactionId: row.transactionId,
      settlementType: row.settlementType,
      payload: row.payload as Record<string, unknown>,
      idempotencyKey: row.idempotencyKey,
      status: row.status,
      processorRef: row.processorRef,
      createdAt: row.createdAt,
    };
  }
}
