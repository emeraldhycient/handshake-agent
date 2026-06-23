import { Injectable } from '@nestjs/common';

// The generated Prisma client is the ONLY sanctioned DB door (CLAUDE.md §3.2).
// This is the infrastructure layer — the only place it is allowed.
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  CreateQuoteData,
  IQuoteRepository,
  QuoteRecord,
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

  async findById(id: string): Promise<QuoteRecord | null> {
    const row = await this.prisma.quote.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        type: true,
        asset: true,
        fiatCurrency: true,
        fiatAmount: true,
        cryptoAmount: true,
        fxRate: true,
        baseRate: true,
        spreadBps: true,
        processingFeeBps: true,
        processingFeeAmount: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    if (row === null) return null;

    return {
      id: row.id,
      userId: row.userId,
      type: row.type,
      asset: row.asset,
      fiatCurrency: row.fiatCurrency,
      fiatAmount: row.fiatAmount.toString(),
      cryptoAmount: row.cryptoAmount,
      fxRate: row.fxRate,
      baseRate: row.baseRate,
      spreadBps: row.spreadBps,
      processingFeeBps: row.processingFeeBps,
      processingFeeAmount: row.processingFeeAmount.toString(),
      status: row.status,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }
}
