import { Injectable } from '@nestjs/common';

// The generated Prisma client is the ONLY sanctioned DB door (CLAUDE.md §3.2).
// This is the infrastructure layer — the only place it is allowed.
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  CreateQuoteData,
  IQuoteRepository,
} from '../application/ports/quote.repository.port';

/**
 * Prisma adapter for the Quote repository port. Maps application-level
 * CreateQuoteData to Prisma create args; application never sees Prisma types.
 *
 * Dependency rule: infrastructure → core (PrismaService). Application imports
 * NOTHING from here (dependency-cruiser enforces the inward-only rule).
 *
 * Fiat/fee amounts are passed as strings; Prisma 7 accepts string → Decimal.
 * Enums are cast via `as never` at the boundary — string values match DB enum values exactly.
 */
@Injectable()
export class QuotePrismaRepository implements IQuoteRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateQuoteData): Promise<{ id: string }> {
    const row = await this.prisma.quote.create({
      data: {
        userId: data.userId,
        type: data.type as never,
        asset: data.asset as never,
        fiatCurrency: data.fiatCurrency as never,
        // Prisma 7 accepts a string for Decimal fields; no import needed.
        fiatAmount: data.fiatAmount as never,
        cryptoAmount: data.cryptoAmount,
        fxRate: data.fxRate,
        baseRate: data.baseRate,
        spreadBps: data.spreadBps,
        processingFeeBps: data.processingFeeBps,
        processingFeeAmount: data.processingFeeAmount as never,
        quotedAt: data.quotedAt,
        expiresAt: data.expiresAt,
        status: 'valid' as never,
      },
      select: { id: true },
    });

    return { id: row.id };
  }
}
