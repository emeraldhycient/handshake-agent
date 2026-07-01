import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../../generated/prisma/client';
import type { AuditLog } from '../../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { computeAuditHash } from '../domain/audit-hash';
import {
  type AppendAuditInput,
  type AuditAppendResult,
  type AuditChainVerifyResult,
  type AuditListQuery,
  type AuditListResult,
  type AuditLogRecord,
  type IAuditLogRepository,
} from '../application/ports/audit-log.repository.port';

// Advisory-lock key serializing all chain appends (AUD-01). pg_advisory_xact_lock
// is held until the transaction commits, so the read-last-hash → compute → insert
// critical section is atomic across concurrent writers — the chain can never fork.
const AUDIT_CHAIN_LOCK_KEY = 770042;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
// Genesis prevHash. 64 chars so it fits the CHAR(64) column exactly — a shorter
// sentinel ('0') would be space-padded on round-trip and break hash recompute.
const GENESIS_PREV_HASH = '0'.repeat(64);

@Injectable()
export class AuditLogPrismaRepository implements IAuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(input: AppendAuditInput): Promise<AuditAppendResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`;

      // `seq` (a BIGSERIAL) is the chain's total order — assigned by the DB at
      // insert, monotonic, tie-free. The advisory lock makes read-last → insert
      // atomic so the chain never forks.
      const last = await tx.auditLog.findFirst({
        orderBy: { seq: 'desc' },
        select: { currentHash: true },
      });
      const prevHash = last?.currentHash ?? GENESIS_PREV_HASH;
      const createdAt = new Date();
      const currentHash = computeAuditHash({
        actor: input.actor,
        actorUserId: input.actorUserId ?? null,
        actorAdminId: input.actorAdminId ?? null,
        subject: input.subject,
        action: input.action,
        details: input.details,
        before: input.before ?? null,
        after: input.after ?? null,
        createdAt: createdAt.toISOString(),
        prevHash,
      });

      const row = await tx.auditLog.create({
        data: {
          correlationId: input.correlationId,
          actor: input.actor,
          actorUserId: input.actorUserId ?? null,
          actorAdminId: input.actorAdminId ?? null,
          subject: input.subject,
          action: input.action,
          details: input.details as Prisma.InputJsonValue,
          before: toJsonInput(input.before),
          after: toJsonInput(input.after),
          prevHash,
          currentHash,
          createdAt,
        },
        select: { id: true },
      });

      return { id: row.id, prevHash, currentHash, createdAt };
    });
  }

  async list(query: AuditListQuery): Promise<AuditListResult> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorAdminId ? { actorAdminId: query.actorAdminId } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.subject ? { subject: query.subject } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const take = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { seq: 'desc' },
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const items = page.map(toRecord);
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async verifyChain(): Promise<AuditChainVerifyResult> {
    const rows = await this.prisma.auditLog.findMany({
      orderBy: { seq: 'asc' },
    });

    let prevHash = GENESIS_PREV_HASH;
    let checked = 0;
    for (const row of rows) {
      const expected = computeAuditHash({
        actor: row.actor,
        actorUserId: row.actorUserId,
        actorAdminId: row.actorAdminId,
        subject: row.subject,
        action: row.action,
        details: row.details,
        before: row.before,
        after: row.after,
        createdAt: row.createdAt.toISOString(),
        prevHash,
      });
      if (row.prevHash !== prevHash || row.currentHash !== expected) {
        return { ok: false, checked, brokenAt: row.id };
      }
      prevHash = row.currentHash;
      checked += 1;
    }
    return { ok: true, checked, brokenAt: null };
  }
}

function toJsonInput(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value == null ? Prisma.DbNull : value;
}

function toRecord(row: AuditLog): AuditLogRecord {
  return {
    id: row.id,
    correlationId: row.correlationId,
    actor: row.actor,
    actorUserId: row.actorUserId,
    actorAdminId: row.actorAdminId,
    subject: row.subject,
    action: row.action,
    details: row.details,
    before: row.before ?? null,
    after: row.after ?? null,
    prevHash: row.prevHash,
    currentHash: row.currentHash,
    createdAt: row.createdAt,
  };
}
