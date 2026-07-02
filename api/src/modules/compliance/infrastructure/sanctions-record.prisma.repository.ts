/**
 * Prisma-backed implementation of ISanctionsRecordRepository (admin compliance
 * console).
 *
 * SanctionsRecord is append-only on the screener's finding: the `verdict` column is
 * immutable evidence and is never written here. `disposition` records the operator's
 * decision as an annotation alongside it. Only this file (infrastructure layer)
 * imports the generated Prisma client; application and domain never see it
 * (CLAUDE.md §3.2 / §4.1).
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  ScreeningVerdict,
  SanctionsDisposition,
} from '../../../../generated/prisma/client';
import type {
  ISanctionsRecordRepository,
  SanctionsDispositionInput,
  SanctionsDispositionValue,
  SanctionsRecordRecord,
  ScreeningVerdictValue,
} from '../application/ports/sanctions-record.repository.port';

function fromVerdict(v: ScreeningVerdict): ScreeningVerdictValue {
  return v;
}

function fromDisposition(
  d: SanctionsDisposition | null,
): SanctionsDispositionValue | null {
  return d;
}

const SELECT = {
  id: true,
  counterpartyId: true,
  verdict: true,
  provider: true,
  screeningType: true,
  disposition: true,
  createdAt: true,
} as const;

@Injectable()
export class SanctionsRecordPrismaRepository implements ISanctionsRecordRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(page: { limit: number }): Promise<SanctionsRecordRecord[]> {
    const rows = await this.prisma.sanctionsRecord.findMany({
      select: SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit,
    });

    return rows.map((row) => this.toRecord(row));
  }

  async findById(id: string): Promise<SanctionsRecordRecord | null> {
    const row = await this.prisma.sanctionsRecord.findUnique({
      where: { id },
      select: SELECT,
    });
    return row === null ? null : this.toRecord(row);
  }

  async disposition(
    id: string,
    input: SanctionsDispositionInput,
  ): Promise<void> {
    // The immutable screener `verdict` is intentionally NOT part of this write —
    // only the operator-annotation columns are set.
    await this.prisma.sanctionsRecord.update({
      where: { id },
      data: {
        disposition: input.disposition,
        dispositionAdminId: input.adminId,
        dispositionComment: input.comment ?? null,
        dispositionAt: input.at,
      },
    });
  }

  private toRecord(row: {
    id: string;
    counterpartyId: string;
    verdict: ScreeningVerdict;
    provider: string;
    screeningType: string;
    disposition: SanctionsDisposition | null;
    createdAt: Date;
  }): SanctionsRecordRecord {
    return {
      id: row.id,
      counterpartyId: row.counterpartyId,
      verdict: fromVerdict(row.verdict),
      provider: row.provider,
      screeningType: row.screeningType,
      disposition: fromDisposition(row.disposition),
      createdAt: row.createdAt,
    };
  }
}
