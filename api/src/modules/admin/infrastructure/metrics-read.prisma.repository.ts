/**
 * Prisma adapter for IMetricsReadRepository (admin METRICS dashboard, Phase 5 —
 * FINAL). READ-ONLY date-ranged aggregations over Transaction / LedgerEntry /
 * User / KycProfile.
 *
 * Infrastructure layer only — the only place in this feature that imports the
 * generated Prisma client / PrismaService (dependency-cruiser rule §3.2). Maps
 * Prisma rows → application-layer records; the service never sees Prisma types.
 * Nothing here mutates anything (§3.1).
 *
 * REVENUE (how it is computed):
 *   Platform fee revenue is the `platform_float` ledger legs (e.g. account
 *   `ngn_fees`) credited at buy settlement by `buildBuyLedgerEntries`. We sum the
 *   signed `amount` of every `platform_float` leg whose transaction is COMPLETED
 *   and whose `createdAt` is in range, grouped by currency, using EXACT
 *   scaled-integer (×10^18) arithmetic — no float drift.
 *
 *   SPREAD is NOT separately ledgered: on sell, `buildSellFinalizeEntries` posts
 *   only the NET fiat payout (the spread is folded into the fx rate that derived
 *   `netFiatAmount`), so there is no discrete spread leg to recover from the
 *   ledger. We therefore report `totalSpreadByCurrency` as `[]` rather than
 *   guessing — fees are exact and spread is surfaced as not-separately-recoverable.
 */

import { Injectable } from '@nestjs/common';

import {
  LedgerAccountType,
  TransactionStatus,
  TransactionType,
} from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  ActiveUsersResult,
  CurrencyAmount,
  IMetricsReadRepository,
  KycFunnelResult,
  RevenueResult,
  ServiceHealthResult,
  ServiceHealthRow,
  TransactionVolumeResult,
  TxnDailyBucket,
  TxnTypeCount,
} from '../application/ports/metrics-read.repository.port';

/** Ledger amounts are Decimal(38,18); 18 fractional digits is the column scale. */
const LEDGER_SCALE = 18;
const SCALE_FACTOR = 10n ** BigInt(LEDGER_SCALE);

/** The transactable services surfaced on the dashboard, in display order. */
const SERVICE_TYPES = ['buy', 'sell', 'send', 'swap'] as const;

/**
 * Parses a signed decimal string into a scaled BigInt (×10^18) for exact integer
 * arithmetic — floats cannot represent 18-digit ledger amounts without drift.
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

/** Converts a scaled BigInt back to a canonical decimal string (no trailing zeros). */
function fromScaledBigInt(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / SCALE_FACTOR;
  const frac = abs % SCALE_FACTOR;
  if (frac === 0n) {
    return (negative ? '-' : '') + whole.toString();
  }
  const fracStr = frac
    .toString()
    .padStart(LEDGER_SCALE, '0')
    .replace(/0+$/, '');
  return (negative ? '-' : '') + whole.toString() + '.' + fracStr;
}

/** UTC YYYY-MM-DD key for a date (the daily-series bucket key). */
function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class MetricsReadPrismaRepository implements IMetricsReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async transactionVolume(
    from: Date,
    to: Date,
  ): Promise<TransactionVolumeResult> {
    // One scan: group by (type, status) for the per-type breakdown + success rate.
    const grouped = await this.prisma.transaction.groupBy({
      by: ['type', 'status'],
      where: { createdAt: { gte: from, lte: to } },
      _count: { _all: true },
    });

    const byTypeMap = new Map<string, TxnTypeCount>();
    let completedTotal = 0;
    let failedTotal = 0;

    for (const row of grouped) {
      const type = row.type as string;
      const status = row.status as string;
      const count = row._count._all;
      const entry =
        byTypeMap.get(type) ??
        ({ type, count: 0, completed: 0, failed: 0 } satisfies TxnTypeCount);
      entry.count += count;
      if (status === TransactionStatus.completed) {
        entry.completed += count;
        completedTotal += count;
      } else if (status === TransactionStatus.failed) {
        entry.failed += count;
        failedTotal += count;
      }
      byTypeMap.set(type, entry);
    }

    // Daily series: count transactions per UTC day (createdAt). Read the minimal
    // createdAt set and bucket in memory — exact, and avoids DB-specific date SQL.
    const rows = await this.prisma.transaction.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { createdAt: true },
    });
    const seriesMap = new Map<string, number>();
    for (const r of rows) {
      const key = dateKey(r.createdAt);
      seriesMap.set(key, (seriesMap.get(key) ?? 0) + 1);
    }
    const series: TxnDailyBucket[] = [...seriesMap.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const denom = completedTotal + failedTotal;
    const successRate = denom === 0 ? 0 : completedTotal / denom;

    return {
      byType: [...byTypeMap.values()].sort((a, b) =>
        a.type.localeCompare(b.type),
      ),
      series,
      successRate,
    };
  }

  async revenue(from: Date, to: Date): Promise<RevenueResult> {
    // Platform-fee legs of COMPLETED txns in range, grouped by currency. We join
    // through the transaction so only completed, in-range fees count. SUM cast to
    // text keeps engine-precision values byte-stable strings (never a JS float);
    // we re-sum with scaled BigInt to normalize to a canonical decimal string.
    const feeRows = await this.prisma.ledgerEntry.findMany({
      where: {
        accountType: LedgerAccountType.platform_float,
        transaction: {
          status: TransactionStatus.completed,
          createdAt: { gte: from, lte: to },
        },
      },
      select: { currency: true, amount: true },
    });

    const sums = new Map<string, bigint>();
    const order: string[] = [];
    for (const row of feeRows) {
      const currency = row.currency;
      if (!sums.has(currency)) {
        order.push(currency);
        sums.set(currency, 0n);
      }
      sums.set(
        currency,
        sums.get(currency)! +
          toScaledBigInt((row.amount as { toString(): string }).toString()),
      );
    }

    const totalFeesByCurrency: CurrencyAmount[] = order
      .map((currency) => ({
        currency,
        amount: fromScaledBigInt(sums.get(currency)!),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

    const txnCount = await this.prisma.transaction.count({
      where: {
        status: TransactionStatus.completed,
        createdAt: { gte: from, lte: to },
      },
    });

    // Spread is folded into the fx rate and not separately ledgered — see the
    // class-level comment. Report it as empty rather than guessing.
    return { totalFeesByCurrency, totalSpreadByCurrency: [], txnCount };
  }

  async kycFunnel(): Promise<KycFunnelResult> {
    const [byStatusRows, byTierRows] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['kycStatus'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.user.groupBy({
        by: ['kycTier'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
    ]);

    return {
      byStatus: byStatusRows
        .map((r) => ({ key: r.kycStatus, count: r._count._all }))
        .sort((a, b) => a.key.localeCompare(b.key)),
      byTier: byTierRows
        .map((r) => ({ key: r.kycTier, count: r._count._all }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    };
  }

  async activeUsers(from: Date, to: Date): Promise<ActiveUsersResult> {
    const [activeGroups, newInRange, totalUsers] = await Promise.all([
      // Distinct users with a Transaction whose createdAt is in range.
      this.prisma.transaction.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: from, lte: to } },
      }),
      this.prisma.user.count({
        where: { deletedAt: null, createdAt: { gte: from, lte: to } },
      }),
      this.prisma.user.count({ where: { deletedAt: null } }),
    ]);

    return {
      activeInRange: activeGroups.length,
      newInRange,
      totalUsers,
    };
  }

  async serviceHealth(from: Date, to: Date): Promise<ServiceHealthResult> {
    const grouped = await this.prisma.transaction.groupBy({
      by: ['type', 'status'],
      where: {
        createdAt: { gte: from, lte: to },
        type: {
          in: SERVICE_TYPES.map((t) => t as TransactionType),
        },
      },
      _count: { _all: true },
    });

    // Seed every transactable service at zero so absent services still appear.
    const rows = new Map<string, ServiceHealthRow>(
      SERVICE_TYPES.map((service) => [
        service,
        { service, total: 0, completed: 0, failed: 0, successRate: 0 },
      ]),
    );

    for (const g of grouped) {
      const row = rows.get(g.type);
      if (!row) continue;
      const count = g._count._all;
      row.total += count;
      if (g.status === TransactionStatus.completed) {
        row.completed += count;
      } else if (g.status === TransactionStatus.failed) {
        row.failed += count;
      }
    }

    for (const row of rows.values()) {
      const denom = row.completed + row.failed;
      row.successRate = denom === 0 ? 0 : row.completed / denom;
    }

    return { services: [...rows.values()] };
  }
}
