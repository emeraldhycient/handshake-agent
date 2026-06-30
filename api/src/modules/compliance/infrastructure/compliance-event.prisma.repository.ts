/**
 * Prisma-backed implementation of IComplianceEventRepository (N2).
 *
 * Append-only: no UPDATE or DELETE operations. The Prisma `ComplianceEvent`
 * model has no UPDATE/DELETE hooks (immutability is enforced here, not at the
 * DB layer — see AUD-01 comment in the schema).
 *
 * Only this file (infrastructure layer) imports the generated Prisma client.
 * Application and domain layers never see it (CLAUDE.md §3.2 / §4.1).
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  ComplianceEventType,
  ComplianceStatus,
  Prisma,
  Severity,
} from '../../../../generated/prisma/client';
import type {
  IComplianceEventRepository,
  CreateComplianceEventInput,
  ComplianceEventRecord,
  ComplianceEventListFilter,
  ComplianceEventDispositionInput,
  ComplianceEventTypeValue,
  ComplianceStatusValue,
  SeverityValue,
} from '../application/ports/compliance-event.repository.port';

// Columns projected for every read (create, list, detail) — kept in one place so
// the row→record mapper stays exhaustive.
const EVENT_SELECT = {
  id: true,
  userId: true,
  transactionId: true,
  eventType: true,
  severity: true,
  screeningProvider: true,
  ruleOrHit: true,
  details: true,
  status: true,
  dispositionComment: true,
  dispositionAt: true,
  createdAt: true,
} as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Enum mappers (app-layer string literals → generated Prisma enums)
// ---------------------------------------------------------------------------

function toEventType(v: ComplianceEventTypeValue): ComplianceEventType {
  return v;
}

function toStatus(v: ComplianceStatusValue): ComplianceStatus {
  return v;
}

function toSeverity(v: SeverityValue): Severity {
  return v;
}

// ---------------------------------------------------------------------------
// Reverse mappers (Prisma enum → app-layer string literals)
// ---------------------------------------------------------------------------

function fromEventType(v: ComplianceEventType): ComplianceEventTypeValue {
  return v;
}

function fromStatus(v: ComplianceStatus): ComplianceStatusValue {
  return v;
}

function fromSeverity(v: Severity): SeverityValue {
  return v;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class ComplianceEventPrismaRepository implements IComplianceEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    input: CreateComplianceEventInput,
  ): Promise<ComplianceEventRecord> {
    const row = await this.prisma.complianceEvent.create({
      data: {
        userId: input.userId,
        transactionId: input.transactionId ?? null,
        eventType: toEventType(input.eventType),
        severity: toSeverity(input.severity),
        screeningProvider: input.screeningProvider,
        ruleOrHit: input.ruleOrHit ?? null,
        details: input.details as Prisma.InputJsonValue,
        status: toStatus(input.status),
      },
      select: EVENT_SELECT,
    });

    return toRecord(row);
  }

  async listByStatus(
    filter: ComplianceEventListFilter,
    page: { cursor?: string; limit: number },
  ): Promise<{ items: ComplianceEventRecord[]; nextCursor: string | null }> {
    const where: Prisma.ComplianceEventWhereInput = {
      ...(filter.status !== undefined
        ? { status: filter.status as ComplianceStatus }
        : {}),
      ...(filter.severity !== undefined
        ? { severity: filter.severity as Severity }
        : {}),
      ...(filter.userId !== undefined ? { userId: filter.userId } : {}),
    };

    // Keyset on (createdAt, id): resolve the cursor row's createdAt so the page
    // boundary is stable. An unknown/invalid cursor yields the first page.
    const anchor =
      page.cursor !== undefined && UUID_RE.test(page.cursor)
        ? await this.prisma.complianceEvent.findUnique({
            where: { id: page.cursor },
            select: { createdAt: true, id: true },
          })
        : null;

    const keysetWhere: Prisma.ComplianceEventWhereInput =
      anchor !== null
        ? {
            OR: [
              { createdAt: { lt: anchor.createdAt } },
              { createdAt: anchor.createdAt, id: { lt: anchor.id } },
            ],
          }
        : {};

    const rows = await this.prisma.complianceEvent.findMany({
      where: { AND: [where, keysetWhere] },
      select: EVENT_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
    });

    const hasMore = rows.length > page.limit;
    const items = hasMore ? rows.slice(0, page.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items: items.map(toRecord), nextCursor };
  }

  async findById(id: string): Promise<ComplianceEventRecord | null> {
    const row = await this.prisma.complianceEvent.findUnique({
      where: { id },
      select: EVENT_SELECT,
    });
    return row !== null ? toRecord(row) : null;
  }

  async updateDisposition(
    id: string,
    input: ComplianceEventDispositionInput,
  ): Promise<void> {
    await this.prisma.complianceEvent.update({
      where: { id },
      data: {
        status: toStatus(input.status),
        dispositionAdminId: input.adminId,
        dispositionComment: input.comment ?? null,
        dispositionAt: input.at,
      },
    });
  }
}

// Row (EVENT_SELECT projection) → app-layer record.
function toRecord(row: {
  id: string;
  userId: string;
  transactionId: string | null;
  eventType: ComplianceEventType;
  severity: Severity;
  screeningProvider: string;
  ruleOrHit: string | null;
  details: unknown;
  status: ComplianceStatus;
  dispositionComment: string | null;
  dispositionAt: Date | null;
  createdAt: Date;
}): ComplianceEventRecord {
  return {
    id: row.id,
    userId: row.userId,
    transactionId: row.transactionId,
    eventType: fromEventType(row.eventType),
    severity: fromSeverity(row.severity),
    screeningProvider: row.screeningProvider,
    ruleOrHit: row.ruleOrHit,
    details: row.details as Record<string, unknown>,
    status: fromStatus(row.status),
    dispositionComment: row.dispositionComment,
    dispositionAt: row.dispositionAt,
    createdAt: row.createdAt,
  };
}
