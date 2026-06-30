/**
 * Prisma-backed implementation of ITravelRuleRepository (admin read-only).
 *
 * TravelRuleData is immutable; this repository only reads, and projects ONLY the
 * non-PII summary columns (the encrypted originator/beneficiary PII is never
 * surfaced to the list). Only this file (infrastructure layer) imports the
 * generated Prisma client (CLAUDE.md §3.2 / §4.1).
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  ITravelRuleRepository,
  TravelRuleRecord,
} from '../application/ports/travel-rule.repository.port';

@Injectable()
export class TravelRulePrismaRepository implements ITravelRuleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(page: { limit: number }): Promise<TravelRuleRecord[]> {
    const rows = await this.prisma.travelRuleData.findMany({
      select: {
        id: true,
        transactionId: true,
        asset: true,
        amount: true,
        amountFiat: true,
        triggeringFactor: true,
        capturedAt: true,
        reportedAt: true,
      },
      orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
      take: page.limit,
    });

    return rows.map((row) => ({
      id: row.id,
      transactionId: row.transactionId,
      asset: row.asset,
      // amountFiat is a Prisma Decimal — serialize to a canonical string (never float).
      amount: row.amount,
      amountFiat: row.amountFiat.toString(),
      triggeringFactor: row.triggeringFactor,
      capturedAt: row.capturedAt,
      reportedAt: row.reportedAt,
    }));
  }
}
