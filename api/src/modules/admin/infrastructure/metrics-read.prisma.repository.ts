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
  BackfillRunStatus,
  KycTier,
  QuoteType,
  SettlementOutboxStatus,
  TransactionStatus,
  TransactionType,
} from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { computeTxProfit } from '../domain/tx-profit';
import type {
  ActiveUsersResult,
  CurrencyAmount,
  GmvResult,
  IMetricsReadRepository,
  KycFunnelResult,
  MetricsFilter,
  MoneySeriesBucketRow,
  MoneySeriesResult,
  PlatformKpisResult,
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

/** Valid enum values, used to reject stale/unknown FE filter selections (no-op). */
const TXN_TYPE_VALUES = new Set<string>(Object.values(TransactionType));
const KYC_TIER_VALUES = new Set<string>(Object.values(KycTier));

/** A KYC tier the FE actually selected (validated against the enum), else null. */
function validTier(filter?: MetricsFilter): KycTier | null {
  return filter?.tier && KYC_TIER_VALUES.has(filter.tier)
    ? (filter.tier as KycTier)
    : null;
}

/** A Transaction type the FE actually selected (validated), else null. */
function validCapability(filter?: MetricsFilter): TransactionType | null {
  return filter?.capability && TXN_TYPE_VALUES.has(filter.capability)
    ? (filter.capability as TransactionType)
    : null;
}

/**
 * Shared Transaction where-fragment for the optional metrics filters: `capability`
 * → `type`, `tier` → the owning user's `kycTier` (Prisma relation filter). Unknown
 * enum values are ignored so a stale FE selection never throws. Currency is applied
 * per-metric (JSON metadata vs quote field), not here.
 */
function txnFilterWhere(filter?: MetricsFilter): {
  type?: TransactionType;
  user?: { kycTier: KycTier };
} {
  const where: { type?: TransactionType; user?: { kycTier: KycTier } } = {};
  const capability = validCapability(filter);
  const tier = validTier(filter);
  if (capability) where.type = capability;
  if (tier) where.user = { kycTier: tier };
  return where;
}

@Injectable()
export class MetricsReadPrismaRepository implements IMetricsReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async transactionVolume(
    from: Date,
    to: Date,
    filter?: MetricsFilter,
  ): Promise<TransactionVolumeResult> {
    const where = {
      createdAt: { gte: from, lte: to },
      ...txnFilterWhere(filter),
    };
    // One scan: group by (type, status) for the per-type breakdown + success rate.
    const grouped = await this.prisma.transaction.groupBy({
      by: ['type', 'status'],
      where,
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
      where,
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

  async gmv(from: Date, to: Date, filter?: MetricsFilter): Promise<GmvResult> {
    // GMV = summed fiat notional of COMPLETED, money-moving txns in range. The
    // notional lives in Transaction.metadata as { fiatAmount, fiatCurrency } (set
    // by the execution engine at settle) — there is no first-class column. We sum
    // per currency with EXACT scaled-integer (×10^18) arithmetic; a txn without a
    // fiat notional (e.g. a pure on-chain send with no fiat leg) is skipped and
    // does NOT count toward txnCount. A `currency` filter is applied IN-MEMORY
    // (metadata is JSON — not a queryable column); capability/tier filter in-DB.
    const rows = await this.prisma.transaction.findMany({
      where: {
        status: TransactionStatus.completed,
        createdAt: { gte: from, lte: to },
        ...txnFilterWhere(filter),
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
      if (filter?.currency && fiatCurrency !== filter.currency) {
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

  async revenue(
    from: Date,
    to: Date,
    filter?: MetricsFilter,
  ): Promise<RevenueResult> {
    // Platform profit DERIVED from the authoritative Quote of each COMPLETED
    // buy/sell in range (docs/go-readiness-program.md §5). Both the fee AND the
    // realized spread are recoverable from the Quote (baseRate vs effective fxRate,
    // cryptoAmount, fiatAmount), whereas the double-entry ledger only carries BUY
    // fees — so this correctly counts sell fees + all spread the ledger misses,
    // WITHOUT restructuring the settlement path. Exact BigInt (scale-18), no floats.
    // capability/tier filter in-DB; `currency` filters the quote's fiatCurrency
    // IN-MEMORY (keeps the enum-cast off the query — a stale code never throws).
    const priced = await this.prisma.transaction.findMany({
      where: {
        status: TransactionStatus.completed,
        createdAt: { gte: from, lte: to },
        ...txnFilterWhere(filter),
        proposal: { quote: { type: { in: [QuoteType.buy, QuoteType.sell] } } },
      },
      select: {
        proposal: {
          select: {
            quote: {
              select: {
                type: true,
                fiatCurrency: true,
                fiatAmount: true,
                cryptoAmount: true,
                baseRate: true,
                processingFeeAmount: true,
              },
            },
          },
        },
      },
    });

    const feeSums = new Map<string, bigint>();
    const spreadSums = new Map<string, bigint>();
    const order: string[] = [];
    for (const t of priced) {
      const q = t.proposal?.quote;
      if (!q) continue;
      if (filter?.currency && q.fiatCurrency !== filter.currency) continue;
      const { fee, spread } = computeTxProfit({
        type: q.type === QuoteType.sell ? 'sell' : 'buy',
        fiatAmount: (q.fiatAmount as { toString(): string }).toString(),
        cryptoAmount: q.cryptoAmount,
        baseRate: q.baseRate,
        processingFeeAmount: (
          q.processingFeeAmount as { toString(): string }
        ).toString(),
      });
      const currency = q.fiatCurrency;
      if (!feeSums.has(currency)) {
        order.push(currency);
        feeSums.set(currency, 0n);
        spreadSums.set(currency, 0n);
      }
      feeSums.set(currency, feeSums.get(currency)! + toScaledBigInt(fee));
      spreadSums.set(
        currency,
        spreadSums.get(currency)! + toScaledBigInt(spread),
      );
    }

    const project = (m: Map<string, bigint>): CurrencyAmount[] =>
      order
        .map((currency) => ({
          currency,
          amount: fromScaledBigInt(m.get(currency)!),
        }))
        .sort((a, b) => a.currency.localeCompare(b.currency));

    const totalProfitByCurrency: CurrencyAmount[] = order
      .map((currency) => ({
        currency,
        amount: fromScaledBigInt(
          feeSums.get(currency)! + spreadSums.get(currency)!,
        ),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

    const txnCount = await this.prisma.transaction.count({
      where: {
        status: TransactionStatus.completed,
        createdAt: { gte: from, lte: to },
        ...txnFilterWhere(filter),
      },
    });

    return {
      totalFeesByCurrency: project(feeSums),
      totalSpreadByCurrency: project(spreadSums),
      totalProfitByCurrency,
      txnCount,
    };
  }

  async moneySeries(
    from: Date,
    to: Date,
    filter?: MetricsFilter,
  ): Promise<MoneySeriesResult> {
    // One scan of every COMPLETED txn in range, pulling BOTH the fiat notional
    // (metadata → GMV, ALL money-moving types, consistent with `gmv()`) and the
    // buy/sell Quote (→ fee + spread via `computeTxProfit`, consistent with
    // `revenue()`). Bucket per UTC day and currency with EXACT scaled-integer math.
    // A txn may contribute to GMV, to fee/profit, or to both; the GMV currency
    // (metadata.fiatCurrency) and the fee currency (quote.fiatCurrency) are tracked
    // independently. capability/tier filter in-DB; `currency` filters each leg
    // IN-MEMORY (metadata JSON + quote code), consistent with gmv()/revenue().
    const rows = await this.prisma.transaction.findMany({
      where: {
        status: TransactionStatus.completed,
        createdAt: { gte: from, lte: to },
        ...txnFilterWhere(filter),
      },
      select: {
        createdAt: true,
        metadata: true,
        proposal: {
          select: {
            quote: {
              select: {
                type: true,
                fiatCurrency: true,
                fiatAmount: true,
                cryptoAmount: true,
                baseRate: true,
                processingFeeAmount: true,
              },
            },
          },
        },
      },
    });

    interface Cell {
      gmv: bigint;
      fee: bigint;
      profit: bigint;
    }
    // day (YYYY-MM-DD) → currency → accumulated scaled amounts.
    const days = new Map<string, Map<string, Cell>>();
    const currencySet = new Set<string>();

    const cellFor = (day: string, currency: string): Cell => {
      let byCurrency = days.get(day);
      if (!byCurrency) {
        byCurrency = new Map<string, Cell>();
        days.set(day, byCurrency);
      }
      let cell = byCurrency.get(currency);
      if (!cell) {
        cell = { gmv: 0n, fee: 0n, profit: 0n };
        byCurrency.set(currency, cell);
      }
      currencySet.add(currency);
      return cell;
    };

    for (const row of rows) {
      const day = dateKey(row.createdAt);

      // GMV leg — fiat notional the engine stamped at settle.
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const fiatAmount = meta.fiatAmount;
      const fiatCurrency = meta.fiatCurrency;
      if (
        typeof fiatAmount === 'string' &&
        typeof fiatCurrency === 'string' &&
        (!filter?.currency || fiatCurrency === filter.currency)
      ) {
        cellFor(day, fiatCurrency).gmv += toScaledBigInt(fiatAmount);
      }

      // Fee + profit leg — derived from the buy/sell Quote snapshot.
      const q = row.proposal?.quote;
      if (
        q &&
        (q.type === QuoteType.buy || q.type === QuoteType.sell) &&
        (!filter?.currency || q.fiatCurrency === filter.currency)
      ) {
        const { fee, spread } = computeTxProfit({
          type: q.type === QuoteType.sell ? 'sell' : 'buy',
          fiatAmount: (q.fiatAmount as { toString(): string }).toString(),
          cryptoAmount: q.cryptoAmount,
          baseRate: q.baseRate,
          processingFeeAmount: (
            q.processingFeeAmount as { toString(): string }
          ).toString(),
        });
        const cell = cellFor(day, q.fiatCurrency);
        const scaledFee = toScaledBigInt(fee);
        cell.fee += scaledFee;
        cell.profit += scaledFee + toScaledBigInt(spread);
      }
    }

    const project = (
      byCurrency: Map<string, Cell>,
      pick: keyof Cell,
    ): CurrencyAmount[] =>
      [...byCurrency.entries()]
        .map(([currency, cell]) => ({
          currency,
          amount: fromScaledBigInt(cell[pick]),
        }))
        .sort((a, b) => a.currency.localeCompare(b.currency));

    const buckets: MoneySeriesBucketRow[] = [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, byCurrency]) => ({
        date,
        gmv: project(byCurrency, 'gmv'),
        revenue: project(byCurrency, 'fee'),
        profit: project(byCurrency, 'profit'),
      }));

    const currencies = [...currencySet].sort((a, b) => a.localeCompare(b));

    return { buckets, currencies };
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

  async activeUsers(
    from: Date,
    to: Date,
    filter?: MetricsFilter,
  ): Promise<ActiveUsersResult> {
    // `active` is txn-based → full filter (capability + tier). `new`/`total` are
    // user-population counts → only the tier filter is meaningful (capability is a
    // txn dimension), so the baselines stay tier-scoped when a tier is selected.
    const tier = validTier(filter);
    const tierWhere = tier ? { kycTier: tier } : {};
    const [activeGroups, newInRange, totalUsers] = await Promise.all([
      // Distinct users with a Transaction whose createdAt is in range.
      this.prisma.transaction.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: from, lte: to }, ...txnFilterWhere(filter) },
      }),
      this.prisma.user.count({
        where: {
          deletedAt: null,
          createdAt: { gte: from, lte: to },
          ...tierWhere,
        },
      }),
      this.prisma.user.count({ where: { deletedAt: null, ...tierWhere } }),
    ]);

    return {
      activeInRange: activeGroups.length,
      newInRange,
      totalUsers,
    };
  }

  async serviceHealth(
    from: Date,
    to: Date,
    filter?: MetricsFilter,
  ): Promise<ServiceHealthResult> {
    // This card is the cross-service health OVERVIEW, so the `capability` filter is
    // intentionally NOT applied (it would collapse the card to one service). The
    // `tier` filter IS applied (health for a given user segment); currency is n/a.
    const tier = validTier(filter);
    const grouped = await this.prisma.transaction.groupBy({
      by: ['type', 'status'],
      where: {
        createdAt: { gte: from, lte: to },
        type: {
          in: SERVICE_TYPES.map((t) => t as TransactionType),
        },
        ...(tier ? { user: { kycTier: tier } } : {}),
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

  async platformKpis(from: Date, to: Date): Promise<PlatformKpisResult> {
    // Compare the window against the immediately preceding equal-length window.
    const windowMs = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - windowMs);

    const [
      newCurrent,
      newPrevious,
      activeCurrentGroups,
      activePreviousGroups,
      outboxFailed,
      backfillFailed,
    ] = await Promise.all([
      this.prisma.user.count({
        where: { deletedAt: null, createdAt: { gte: from, lte: to } },
      }),
      this.prisma.user.count({
        where: { deletedAt: null, createdAt: { gte: prevFrom, lt: from } },
      }),
      // Distinct users active this window vs the previous window (set difference
      // gives churn). `lt: from` keeps the two windows disjoint.
      this.prisma.transaction.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: from, lte: to } },
      }),
      this.prisma.transaction.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: prevFrom, lt: from } },
      }),
      this.prisma.settlementOutbox.count({
        where: {
          status: SettlementOutboxStatus.failed,
          createdAt: { gte: from, lte: to },
        },
      }),
      this.prisma.backfillRun.count({
        where: {
          status: BackfillRunStatus.failed,
          createdAt: { gte: from, lte: to },
        },
      }),
    ]);

    const currentUserIds = new Set(activeCurrentGroups.map((g) => g.userId));
    const activePrevious = activePreviousGroups.length;
    const churned = activePreviousGroups.filter(
      (g) => !currentUserIds.has(g.userId),
    ).length;
    const churnRate = activePrevious === 0 ? 0 : churned / activePrevious;

    // Signed growth ratio. With no prior baseline, treat any new users as +100%.
    const growthRate =
      newPrevious === 0
        ? newCurrent > 0
          ? 1
          : 0
        : (newCurrent - newPrevious) / newPrevious;

    return {
      newUsers: { current: newCurrent, previous: newPrevious, growthRate },
      churn: { activePrevious, churned, churnRate },
      failedJobs: outboxFailed + backfillFailed,
    };
  }
}
