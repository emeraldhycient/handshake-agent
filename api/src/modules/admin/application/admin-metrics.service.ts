import { Inject, Injectable } from '@nestjs/common';

import type {
  DashboardSummary,
  GmvMetrics,
  KycFunnelMetrics,
  MetricsRangeQuery,
  MoneySeriesMetrics,
  RevenueMetrics,
  TxnVolumeMetrics,
} from '@handshake-agent/contracts';

import {
  METRICS_READ_REPOSITORY,
  type IMetricsReadRepository,
} from './ports/metrics-read.repository.port';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Default lookback when the caller omits the range. */
const DEFAULT_WINDOW_DAYS = 30;
/** Hard cap on the queried window — clamps `from` if it is older than this. */
const MAX_WINDOW_DAYS = 366;

/** A resolved, validated, bounded [from, to) range. */
interface ResolvedRange {
  from: Date;
  to: Date;
}

/**
 * Phase 5 (FINAL) — READ-ONLY operational metrics for the admin dashboard.
 *
 * Composes the date-ranged aggregations (transaction volume, revenue, KYC funnel,
 * active users, service health) into the contract shapes. NEVER moves money (§3.1)
 * and holds no Prisma import — it reaches data exclusively through the injected
 * METRICS_READ_REPOSITORY port (§3.2). Revenue (fees + spread) is surfaced only
 * here, to operators — never on an end-user surface.
 */
@Injectable()
export class AdminMetricsService {
  constructor(
    @Inject(METRICS_READ_REPOSITORY)
    private readonly metrics: IMetricsReadRepository,
  ) {}

  /**
   * Transaction-volume + success-rate metrics for the (defaulted/clamped) range.
   * Each `byType` row carries completed / failed / stuck breakdowns; `stuck`
   * counts the in-flight statuses (pending/validating/confirmed/settling) so the
   * dashboard "Failed / stuck tx" card can show BOTH, matching the sidebar badge.
   */
  async transactions(query: MetricsRangeQuery): Promise<TxnVolumeMetrics> {
    const { from, to } = this.resolveRange(query);
    return this.metrics.transactionVolume(from, to);
  }

  /** GMV (summed fiat notional of completed txns, per currency) for the range. */
  async gmv(query: MetricsRangeQuery): Promise<GmvMetrics> {
    const { from, to } = this.resolveRange(query);
    return this.metrics.gmv(from, to);
  }

  /** Revenue (fees by currency; spread folded into fx → empty) for the range. */
  async revenue(query: MetricsRangeQuery): Promise<RevenueMetrics> {
    const { from, to } = this.resolveRange(query);
    return this.metrics.revenue(from, to);
  }

  /**
   * Daily money time-series (per-currency GMV / revenue / profit) for the
   * (defaulted/clamped) range — feeds the operator "Revenue & profit trend" chart.
   */
  async moneySeries(query: MetricsRangeQuery): Promise<MoneySeriesMetrics> {
    const { from, to } = this.resolveRange(query);
    return this.metrics.moneySeries(from, to);
  }

  /** Point-in-time KYC funnel (counts by status + tier). */
  async kycFunnel(): Promise<KycFunnelMetrics> {
    const result = await this.metrics.kycFunnel();
    return {
      byStatus: result.byStatus.map((r) => ({ status: r.key, count: r.count })),
      byTier: result.byTier.map((r) => ({ tier: r.key, count: r.count })),
    };
  }

  /** The composite dashboard — every metric block for one resolved range. */
  async dashboard(query: MetricsRangeQuery): Promise<DashboardSummary> {
    const { from, to } = this.resolveRange(query);
    const [txnVolume, gmv, revenue, kycFunnel, activeUsers, serviceHealth] =
      await Promise.all([
        this.metrics.transactionVolume(from, to),
        this.metrics.gmv(from, to),
        this.metrics.revenue(from, to),
        this.metrics.kycFunnel(),
        this.metrics.activeUsers(from, to),
        this.metrics.serviceHealth(from, to),
      ]);

    return {
      txnVolume,
      gmv,
      revenue,
      kycFunnel: {
        byStatus: kycFunnel.byStatus.map((r) => ({
          status: r.key,
          count: r.count,
        })),
        byTier: kycFunnel.byTier.map((r) => ({ tier: r.key, count: r.count })),
      },
      activeUsers,
      serviceHealth,
    };
  }

  /**
   * Resolves the request range: defaults to the last {@link DEFAULT_WINDOW_DAYS}
   * days when omitted, and clamps `from` so the window never exceeds
   * {@link MAX_WINDOW_DAYS} days (bounding the aggregation cost). Invalid date
   * strings fall back to the defaults rather than throwing.
   */
  private resolveRange(query: MetricsRangeQuery): ResolvedRange {
    const to = this.parseDate(query.to) ?? new Date();
    const from =
      this.parseDate(query.from) ??
      new Date(to.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);

    const maxSpanMs = MAX_WINDOW_DAYS * DAY_MS;
    const clampedFrom =
      to.getTime() - from.getTime() > maxSpanMs
        ? new Date(to.getTime() - maxSpanMs)
        : from;

    return { from: clampedFrom, to };
  }

  /** Parses an ISO date string; returns null for missing/invalid input. */
  private parseDate(value: string | undefined): Date | null {
    if (value === undefined || value === '') {
      return null;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
