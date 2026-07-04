import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  type CreateCustomFiatInput,
  type CustomFiatRecord,
  type ICustomFiatRepository,
  type UpdateCustomFiatInput,
} from '../application/ports/custom-fiat.repository.port';

/** The persisted row shape this repo reads back from Prisma (before mapping). */
interface CustomFiatRow {
  code: string;
  displayName: string;
  symbol: string;
  decimals: number;
  enabled: boolean;
  createdAt: Date;
}

/**
 * Prisma-backed runtime custom-fiat repository (the "Add currency" feature). Backs the
 * `custom_fiats` table. Codes are stored upper-case (the code is the PK). `create`
 * persists the currency DISABLED (the model default) so a new currency is never live
 * until pricing is configured and it is explicitly enabled (§3.3, fail-closed). Only
 * this infrastructure repository imports the generated client via PrismaService (§3.2 / §4).
 */
@Injectable()
export class CustomFiatPrismaRepository implements ICustomFiatRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listAll(): Promise<CustomFiatRecord[]> {
    const rows = (await this.prisma.customFiat.findMany({
      orderBy: { createdAt: 'desc' },
    })) as CustomFiatRow[];
    return rows.map(toRecord);
  }

  async findByCode(code: string): Promise<CustomFiatRecord | null> {
    const row = (await this.prisma.customFiat.findUnique({
      where: { code },
    })) as CustomFiatRow | null;
    return row ? toRecord(row) : null;
  }

  async create(input: CreateCustomFiatInput): Promise<CustomFiatRecord> {
    const row = (await this.prisma.customFiat.create({
      data: {
        code: input.code,
        displayName: input.displayName,
        symbol: input.symbol,
        decimals: input.decimals,
        addedByAdminId: input.addedByAdminId,
        // `enabled` intentionally omitted → defaults to false (created DISABLED).
      },
    })) as CustomFiatRow;
    return toRecord(row);
  }

  async update(
    code: string,
    patch: UpdateCustomFiatInput,
  ): Promise<CustomFiatRecord> {
    const row = (await this.prisma.customFiat.update({
      where: { code },
      data: {
        ...(patch.enabled !== undefined && { enabled: patch.enabled }),
        ...(patch.displayName !== undefined && {
          displayName: patch.displayName,
        }),
        ...(patch.symbol !== undefined && { symbol: patch.symbol }),
        ...(patch.decimals !== undefined && { decimals: patch.decimals }),
      },
    })) as CustomFiatRow;
    return toRecord(row);
  }
}

// ── mapper (Prisma row → port record) ─────────────────────────────────────────────

/** Projects a persisted row into the plain port record (drops addedByAdminId/updatedAt). */
function toRecord(row: CustomFiatRow): CustomFiatRecord {
  return {
    code: row.code,
    displayName: row.displayName,
    symbol: row.symbol,
    decimals: row.decimals,
    enabled: row.enabled,
    createdAt: row.createdAt,
  };
}
