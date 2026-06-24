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
import type { ILedgerRepository } from '../application/ports/ledger.repository.port';

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
    return (latest.balanceAfter as { toString(): string }).toString();
  }
}
