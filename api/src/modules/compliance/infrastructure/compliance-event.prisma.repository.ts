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

import type { PrismaService } from '../../../core/prisma/prisma.service';
import {
  ComplianceEventType,
  ComplianceStatus,
  Severity,
} from '../../../../generated/prisma/client';
import type {
  IComplianceEventRepository,
  CreateComplianceEventInput,
  ComplianceEventRecord,
  ComplianceEventTypeValue,
  ComplianceStatusValue,
  SeverityValue,
} from '../application/ports/compliance-event.repository.port';

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
        details: input.details as Parameters<
          typeof this.prisma.complianceEvent.create
        >[0]['data']['details'],
        status: toStatus(input.status),
      },
      select: {
        id: true,
        userId: true,
        transactionId: true,
        eventType: true,
        severity: true,
        screeningProvider: true,
        ruleOrHit: true,
        details: true,
        status: true,
        createdAt: true,
      },
    });

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
      createdAt: row.createdAt,
    };
  }
}
