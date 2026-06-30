/**
 * Prisma adapter for the LedgerRepository port (task S4a, CLAUDE.md §3.1).
 *
 * `getAccountBalance` reads the latest LedgerEntry.balanceAfter for the given
 * (accountType, accountId, currency) triple. This is the AUTHORITATIVE balance
 * (the ledger is the single source of truth for sell-proposal balance checks).
 *
 * Dependency rule (enforced by dependency-cruiser):
 *   infrastructure imports core (PrismaService).
 *   It must NOT be imported by application or domain layers.
 */

import { Injectable } from '@nestjs/common';

import { LedgerAccountType } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  ILedgerRepository,
  LedgerEntryRecord,
} from '../application/ports/ledger.repository.port';

/** A Prisma Decimal exposes a canonical `toString()`. */
function decimalToString(value: { toString(): string }): string {
  return value.toString();
}

@Injectable()
export class LedgerPrismaRepository implements ILedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the current authoritative balance for the given account triple by
   * selecting the LedgerEntry row with the highest sequence number and returning
   * its `balanceAfter`. Returns `'0'` when no entries exist.
   *
   * The query uses a single `findFirst` ordered by sequence DESC so it never
   * performs a full table scan on large ledgers — the (accountType, accountId,
   * currency, sequence) index covers this query.
   */
  async getAccountBalance(
    accountType: string,
    accountId: string,
    currency: string,
  ): Promise<string> {
    const latest = await this.prisma.ledgerEntry.findFirst({
      where: {
        accountType: accountType as LedgerAccountType,
        accountId,
        currency,
      },
      orderBy: { sequence: 'desc' },
      select: { balanceAfter: true },
    });

    if (latest === null) {
      return '0';
    }

    // balanceAfter is stored as Decimal(38,18) in Postgres; Prisma returns it
    // as a Decimal object with a toString() method that produces a canonical
    // decimal string — safe to return directly to the application layer.
    return decimalToString(latest.balanceAfter);
  }

  /**
   * Returns the most recent `limit` ledger entries for the given account,
   * newest-first by `sequence` (the per-account monotonic counter — the
   * authoritative ordering), then `postedAt`. Decimal columns are mapped to
   * canonical decimal strings so no Prisma type leaks past infrastructure.
   */
  async listLedgerEntries(
    accountType: string,
    accountId: string,
    limit: number,
  ): Promise<LedgerEntryRecord[]> {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: {
        accountType: accountType as LedgerAccountType,
        accountId,
      },
      orderBy: [{ sequence: 'desc' }, { postedAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        transactionId: true,
        accountType: true,
        accountId: true,
        currency: true,
        amount: true,
        direction: true,
        balanceAfter: true,
        postedAt: true,
      },
    });

    return rows.map((row) => ({
      id: row.id,
      transactionId: row.transactionId,
      accountType: row.accountType,
      accountId: row.accountId,
      currency: row.currency,
      amount: decimalToString(row.amount),
      direction: row.direction,
      balanceAfter: decimalToString(row.balanceAfter),
      postedAt: row.postedAt,
    }));
  }
}
