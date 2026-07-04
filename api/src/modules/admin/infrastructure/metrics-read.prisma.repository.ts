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
  GmvResult,
  IMetricsReadRepository,
  KycFunnelResult,
  RevenueResult,
  ServiceHealthResult,
  ServiceHealthRow,
  TransactionVolumeResult,
  TxnCapabilityBucketRow,
  TxnDailyBucket,
  TxnTypeCount,
} from '../application/ports/metrics-read.repository.port';

/** Ledger amounts are Decimal(38,18); 18 fractional digits is the column scale. */
const LEDGER_SCALE = 18;
const SCALE_FACTOR = 10n ** BigInt(LEDGER_SCALE);

/** The transactable services surfaced on the dashboard, in display order. */
const SERVICE_TYPES = ['buy', 'sell', 'send', 'swap'] as const;

/**
 * In-flight (non-terminal) statuses folded into the per-type `stuck` count — the
 * same slice the admin txn-read repo counts for the sidebar "Stuck" badge, so the
 * dashboard "Failed / stuck tx" card and the badge agree.
 */
const STUCK_STATUSES: TransactionStatus[] = [
  TransactionStatus.pending,
  TransactionStatus.validating,
  TransactionStatus.confirmed,
  TransactionStatus.settling,
];

/** The five capability segments of the stacked volume chart, in stacking order. */
const CAPABILITIES = ['buy', 'sell', 'send', 'swap', 'ticket'] as const;
type Capability = (typeof CAPABILITIES)[number];

/**
 * Maps a Transaction.type onto a stacked-chart capability. `ticket_purchase`
 * collapses onto `ticket`; non-capability types (reward/refund/deposit) return
 * null and are excluded from the stacked series. Keeps the chart 1:1 with the
 * five design capabilities.
 */
function capabilityOf(type: string): Capability | null {
  if (type === 'ticket_purchase') return 'ticket';
  return (CAPABILITIES as readonly string[]).includes(type)
    ? (type as Capability)
    : null;
}

/** A fresh zeroed per-capability bucket for one day. */
function emptyStackedBucket(date: string): TxnCapabilityBucketRow {
  return { date, buy: 0, sell: 0, send: 0, swap: 0, ticket: 0, total: 0 };
}

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
        ({
          type,
          count: 0,
          completed: 0,
          failed: 0,
          stuck: 0,
        } satisfies TxnTypeCount);
      entry.count += count;
      if (status === TransactionStatus.completed) {
        entry.completed += count;
        completedTotal += count;
      } else if (status === TransactionStatus.failed) {
        entry.failed += count;
        failedTotal += count;
      } else if ((STUCK_STATUSES as readonly string[]).includes(status)) {
        // In-flight (non-terminal) — pending/validating/confirmed/settling. Does
        // NOT contribute to successRate (only completed/failed do); it is the
        // sibling of `failed` the dashboard card renders next to it.
        entry.stuck += count;
      }
      byTypeMap.set(type, entry);
    }

    // Daily series: count transactions per UTC day (createdAt). Read the minimal
    // (createdAt, type) set once and bucket in memory — exact, avoids DB-specific
    // date SQL, and lets us build both the flat total series and the per-capability
    // stacked series from a single scan. The stacked series drives the dashboard
    // chart (buy/sell/send/swap/ticket per day); non-capability types (reward/
    // refund/deposit) count toward the flat total but not the stacked segments.
    const rows = await this.prisma.transaction.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { createdAt: true, type: true },
    });
    const seriesMap = new Map<string, number>();
    const stackedMap = new Map<string, TxnCapabilityBucketRow>();
    for (const r of rows) {
      const key = dateKey(r.createdAt);
      seriesMap.set(key, (seriesMap.get(key) ?? 0) + 1);

      const capability = capabilityOf(r.type);
      if (capability !== null) {
        const bucket = stackedMap.get(key) ?? emptyStackedBucket(key);
        bucket[capability] += 1;
        bucket.total += 1;
        stackedMap.set(key, bucket);
      }
    }
    const series: TxnDailyBucket[] = [...seriesMap.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const stackedSeries: TxnCapabilityBucketRow[] = [
      ...stackedMap.values(),
    ].sort((a, b) => a.date.localeCompare(b.date));

    const denom = completedTotal + failedTotal;
    const successRate = denom === 0 ? 0 : completedTotal / denom;

    return {
      byType: [...byTypeMap.values()].sort((a, b) =>
        a.type.localeCompare(b.type),
      ),
      series,
      stackedSeries,
      successRate,
    };
  }

  async gmv(from: Date, to: Date): Promise<GmvResult> {
    // GMV = summed fiat notional of COMPLETED, money-moving txns in range. The
    // notional lives in Transaction.metadata as { fiatAmount, fiatCurrency } (set
    // by the execution engine at settle) — there is no first-class column. We sum
    // per currency with EXACT scaled-integer (×10^18) arithmetic; a txn without a
    // fiat notional (e.g. a pure on-chain send with no fiat leg) is skipped and
    // does NOT count toward txnCount.
    const rows = await this.prisma.transaction.findMany({
      where: {
        status: TransactionStatus.completed,
        createdAt: { gte: from, lte: to },
      },
      select: { metadata: true },
    });

    const sums = new Map<string, bigint>();
    const order: string[] = [];
    let txnCount = 0;
    for (const row of rows) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const fiatAmount = meta.fiatAmount;
      const fiatCurrency = meta.fiatCurrency;
      if (typeof fiatAmount !== 'string' || typeof fiatCurrency !== 'string') {
        continue;
      }
      if (!sums.has(fiatCurrency)) {
        order.push(fiatCurrency);
        sums.set(fiatCurrency, 0n);
      }
      sums.set(
        fiatCurrency,
        sums.get(fiatCurrency)! + toScaledBigInt(fiatAmount),
      );
      txnCount += 1;
    }

    const totalByCurrency: CurrencyAmount[] = order
      .map((currency) => ({
        currency,
        amount: fromScaledBigInt(sums.get(currency)!),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

    return { totalByCurrency, txnCount };
  }

  async revenue(from: Date, to: Date): Promise<RevenueResult> {
    // Platform-fee legs of COMPLETED txns in range, grouped by currency. We join
    // through the transaction so only completed, in-range fees count. SUM cast to
    // text keeps engine-precision values byte-stable strings (never a JS float);
    // we re-sum with scaled BigInt to normalize to a canonical decimal string.
    //
    // SIGN: fee-revenue legs are booked to `platform_float/${fc}_fees` as DEBITS
    // (negative amount) so each transaction's per-currency legs net to zero
    // (buildBuyLedgerEntries — `amount: fromScaled(-scaledFee)`). The raw signed sum
    // is therefore −(total fees); we NEGATE it so revenue is reported as a positive
    // magnitude (a full fee reversal on refund credits +fee, netting the revenue
    // back down correctly). Without this the dashboard card showed a negative value.
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
        // Negate: platform_float fee legs are debits (negative); revenue is the
        // positive magnitude of collected fees.
        amount: fromScaledBigInt(-sums.get(currency)!),
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
