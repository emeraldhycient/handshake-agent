/**
 * Prisma-backed implementation of ISanctionsRecordRepository (admin read-only).
 *
 * SanctionsRecord is append-only — this repository only reads. Only this file
 * (infrastructure layer) imports the generated Prisma client; application and
 * domain never see it (CLAUDE.md §3.2 / §4.1).
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import { ScreeningVerdict } from '../../../../generated/prisma/client';
import type {
  ISanctionsRecordRepository,
  SanctionsRecordRecord,
  ScreeningVerdictValue,
} from '../application/ports/sanctions-record.repository.port';

function fromVerdict(v: ScreeningVerdict): ScreeningVerdictValue {
  return v;
}

@Injectable()
export class SanctionsRecordPrismaRepository implements ISanctionsRecordRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(page: { limit: number }): Promise<SanctionsRecordRecord[]> {
    const rows = await this.prisma.sanctionsRecord.findMany({
      select: {
        id: true,
        counterpartyId: true,
        verdict: true,
        provider: true,
        screeningType: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit,
    });

    return rows.map((row) => ({
      id: row.id,
      counterpartyId: row.counterpartyId,
      verdict: fromVerdict(row.verdict),
      provider: row.provider,
      screeningType: row.screeningType,
      createdAt: row.createdAt,
    }));
  }
}
