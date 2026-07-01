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
  LedgerIntegrityResult,
} from '../application/ports/ledger.repository.port';

/** A Prisma Decimal exposes a canonical `toString()`. */
function decimalToString(value: { toString(): string }): string {
  return value.toString();
}

/** Ledger amounts are Decimal(38,18); 18 fractional digits is the column scale. */
const LEDGER_SCALE = 18;

/**
 * Parses a signed decimal string into a scaled BigInt (×10^18) for exact integer
 * arithmetic — floats cannot represent 18-digit ledger amounts without drift.
 * Accepts an optional leading '-', an integer part, and an optional fraction.
 */
function toScaledBigInt(value: string): bigint {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [intPart, fracPart = ''] = unsigned.split('.');
  const fracPadded = (fracPart + '0'.repeat(LEDGER_SCALE)).slice(
    0,
    LEDGER_SCALE,
  );
  const magnitude = BigInt((intPart || '0') + fracPadded);
  return negative ? -magnitude : magnitude;
}

const LEDGER_FIELDS = {
  id: true,
  transactionId: true,
  accountType: true,
  accountId: true,
  currency: true,
  amount: true,
  direction: true,
  balanceAfter: true,
  sequence: true,
  postedAt: true,
} as const;

/** Maps a raw ledger row (with Prisma Decimal columns) to the app record. */
function toLedgerRecord(row: {
  id: string;
  transactionId: string;
  accountType: string;
  accountId: string;
  currency: string;
  amount: { toString(): string };
  direction: string;
  balanceAfter: { toString(): string };
  sequence: number;
  postedAt: Date;
}): LedgerEntryRecord {
  return {
    id: row.id,
    transactionId: row.transactionId,
    accountType: row.accountType,
    accountId: row.accountId,
    currency: row.currency,
    amount: decimalToString(row.amount),
    direction: row.direction,
    balanceAfter: decimalToString(row.balanceAfter),
    sequence: row.sequence,
    postedAt: row.postedAt,
  };
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
      select: LEDGER_FIELDS,
    });

    return rows.map(toLedgerRecord);
  }

  /**
   * Admin oversight (READ-ONLY): all legs of one transaction in posting order
   * (sequence ascending). Empty array for an unknown transaction.
   */
  async listByTransaction(transactionId: string): Promise<LedgerEntryRecord[]> {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { transactionId },
      orderBy: [{ sequence: 'asc' }],
      select: LEDGER_FIELDS,
    });
    return rows.map(toLedgerRecord);
  }

  /**
   * Admin oversight (READ-ONLY): recent `limit` entries for the (accountType,
   * accountId, currency) triple, newest-first by sequence.
   */
  async getAccountHistory(
    accountType: string,
    accountId: string,
    currency: string,
    limit: number,
  ): Promise<LedgerEntryRecord[]> {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: {
        accountType: accountType as LedgerAccountType,
        accountId,
        currency,
      },
      orderBy: [{ sequence: 'desc' }, { postedAt: 'desc' }],
      take: limit,
      select: LEDGER_FIELDS,
    });
    return rows.map(toLedgerRecord);
  }

  /**
   * Admin oversight (READ-ONLY): re-sums a transaction's legs per currency using
   * exact scaled-integer arithmetic. `amount` is already signed in the schema
   * (credit positive, debit negative), so the per-currency sum must net to zero.
   * `brokenAt` is the first currency (in posting order) that fails; `balanced`
   * requires every currency to net to zero AND at least one leg. NEVER mutates.
   */
  async verifyTransactionIntegrity(
    transactionId: string,
  ): Promise<LedgerIntegrityResult> {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { transactionId },
      orderBy: [{ sequence: 'asc' }],
      select: { currency: true, amount: true },
    });

    if (rows.length === 0) {
      return { balanced: false, legCount: 0, brokenAt: null };
    }

    // Accumulate the scaled-integer sum per currency, preserving first-seen order.
    const sums = new Map<string, bigint>();
    const order: string[] = [];
    for (const row of rows) {
      const currency = row.currency;
      if (!sums.has(currency)) {
        order.push(currency);
        sums.set(currency, 0n);
      }
      sums.set(
        currency,
        sums.get(currency)! + toScaledBigInt(decimalToString(row.amount)),
      );
    }

    const brokenAt = order.find((c) => sums.get(c) !== 0n) ?? null;

    return {
      balanced: brokenAt === null,
      legCount: rows.length,
      brokenAt,
    };
  }
}
