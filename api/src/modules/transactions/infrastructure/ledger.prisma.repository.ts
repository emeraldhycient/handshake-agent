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

import { LedgerAccountType, Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  ILedgerRepository,
  LedgerEntryRecord,
  LedgerGlobalFilter,
  LedgerGlobalPage,
  LedgerIntegrityResult,
  LedgerSequenceIntegrityResult,
} from '../application/ports/ledger.repository.port';

/** Matches a syntactically valid UUID — a `@db.Uuid` column rejects anything else. */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

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

  /**
   * Admin oversight (READ-ONLY): a keyset page of ledger legs across ALL accounts,
   * filtered by an optional accountType and/or currency, newest-first by
   * (postedAt desc, id desc). The per-account `sequence` cannot order across
   * accounts, so `id` (a time-ordered uuid7) is the stable global tiebreaker.
   *
   * Fetches `limit + 1` rows to derive `nextCursor` without a count query. The
   * cursor is the last-seen entry id; its postedAt is resolved so the keyset seek
   * compares on (postedAt, id). A malformed/unknown cursor yields the first page.
   */
  async listGlobal(
    filter: LedgerGlobalFilter,
    page: { cursor?: string; limit: number },
  ): Promise<LedgerGlobalPage> {
    const where: Prisma.LedgerEntryWhereInput = {
      ...(filter.accountType !== undefined
        ? { accountType: filter.accountType as LedgerAccountType }
        : {}),
      ...(filter.currency !== undefined ? { currency: filter.currency } : {}),
    };

    // Resolve the cursor row's postedAt so the keyset compares on (postedAt, id).
    // A non-UUID or unknown cursor yields no anchor → return the first page.
    const cursorAnchor =
      page.cursor !== undefined && isValidUuid(page.cursor)
        ? await this.prisma.ledgerEntry.findUnique({
            where: { id: page.cursor },
            select: { postedAt: true, id: true },
          })
        : null;

    const keysetWhere: Prisma.LedgerEntryWhereInput =
      cursorAnchor !== null
        ? {
            OR: [
              { postedAt: { lt: cursorAnchor.postedAt } },
              {
                postedAt: cursorAnchor.postedAt,
                id: { lt: cursorAnchor.id },
              },
            ],
          }
        : {};

    const rows = await this.prisma.ledgerEntry.findMany({
      where: { AND: [where, keysetWhere] },
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
      select: LEDGER_FIELDS,
    });

    // A full +1 page means there is at least one more row → emit a cursor.
    const hasMore = rows.length > page.limit;
    const items = hasMore ? rows.slice(0, page.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items: items.map(toLedgerRecord), nextCursor };
  }

  /**
   * Admin oversight (READ-ONLY): walks every (accountType, accountId, currency)
   * sub-ledger and asserts its `sequence` column is a gapless, correctly-ordered
   * 1..N run. The unique constraint (accountType, accountId, currency, sequence)
   * guarantees no duplicates, so continuity is proven by: min sequence === 1,
   * max sequence === count, and count === distinct-count (always true given the
   * constraint). Reports the first offending sub-ledger key; NEVER mutates.
   */
  async verifyGlobalSequenceIntegrity(): Promise<LedgerSequenceIntegrityResult> {
    // One grouped aggregate per sub-ledger: the row count plus the min/max
    // sequence. A continuous 1..N run has min=1 and max=count.
    const groups = await this.prisma.ledgerEntry.groupBy({
      by: ['accountType', 'accountId', 'currency'],
      _count: { _all: true },
      _min: { sequence: true },
      _max: { sequence: true },
    });

    let brokenAccount: string | null = null;
    for (const g of groups) {
      const count = g._count._all;
      const min = g._min.sequence;
      const max = g._max.sequence;
      if (min !== 1 || max !== count) {
        brokenAccount = `${g.accountType}:${g.accountId}:${g.currency}`;
        break;
      }
    }

    return {
      ok: brokenAccount === null,
      accountsChecked: groups.length,
      brokenAccount,
    };
  }
}
