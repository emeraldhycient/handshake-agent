/**
 * Prisma adapter for IMetricsOpsReadRepository (admin METRICS-OPS panels, Phase 6b).
 *
 * READ-ONLY operational-health signals for the operator dashboard's three
 * still-mock panels — System health, Live activity, and Open compliance cases.
 * Infrastructure layer only — imports the generated Prisma client / PrismaService
 * (dependency-cruiser rule §3.2). Maps Prisma rows → application-layer records; the
 * service never sees Prisma types. Nothing here mutates anything (§3.1).
 *
 * SYSTEM HEALTH (how it is derived) — two paths:
 *   SETTLING providers (Flutterwave = processor collection/payout; Blockradar =
 *   on-chain send/swap) are inferred from the recent SettlementOutbox dispatch
 *   history for the settlement types they serve: all-failed → `down`, some-failed →
 *   `degraded`, else `ok`; `lastLatencyMs` is the most recent observed dispatch
 *   (createdAt/lastAttemptAt → completedAt) duration.
 *   NON-SETTLING providers (Resend/WhatsApp/Anthropic) have no outbox source, so they
 *   derive from a short-TTL cached liveness probe (PROVIDER_CONNECTIVITY) — real
 *   reachability + latency. An unobserved result (mock / not-configured / no host)
 *   falls back to `ok` / latency null; we never fabricate a latency figure.
 *   `webhookQueueDepth` = SettlementOutbox rows still awaiting completion.
 *   `reconDriftCount`   = CompensationRecord rows not yet issued/declined/cancelled.
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  AuditAction,
  CompensationReason,
  CompensationStatus,
  ComplianceStatus,
  SettlementOutboxStatus,
  SettlementType,
  TransactionStatus,
} from '../../../../generated/prisma/client';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { PricingFeedConfig } from '../../../core/config/configuration';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { LiveRateStore } from '../../quotes/application/live-rate.store';
import type {
  ActivityEventRow,
  ActivityKind,
  IMetricsOpsReadRepository,
  ProviderHealthRow,
  SystemHealthResult,
} from '../application/ports/metrics-ops-read.repository.port';
import {
  PROVIDER_CONNECTIVITY,
  type IProviderConnectivity,
} from '../application/ports/provider-connectivity.port';

/** How many recent SettlementOutbox rows to sample per provider for health. */
const HEALTH_SAMPLE = 25;

/** Provider registry: display metadata + the settlement types each one dispatches. */
interface ProviderDef {
  key: string;
  name: string;
  note: string;
  /** Settlement types dispatched through this provider (empty = no outbox source). */
  settlementTypes: SettlementType[];
}

const PROVIDERS: readonly ProviderDef[] = [
  {
    key: 'blockradar',
    name: 'Blockradar',
    note: 'Custodial WaaS · TRON',
    settlementTypes: [SettlementType.onchain_send, SettlementType.swap],
  },
  {
    key: 'flutterwave',
    name: 'Flutterwave',
    note: 'NGN rails',
    settlementTypes: [
      SettlementType.processor_collection,
      SettlementType.processor_payout,
    ],
  },
  { key: 'resend', name: 'Resend', note: 'Email', settlementTypes: [] },
  {
    key: 'whatsapp',
    name: 'WhatsApp Cloud',
    note: 'Chat + Flows',
    settlementTypes: [],
  },
  {
    key: 'anthropic',
    name: 'Anthropic LLM',
    note: 'claude-opus-4-8',
    settlementTypes: [],
  },
];

/** SettlementOutbox statuses that count toward the pending webhook/dispatch queue. */
const QUEUE_STATUSES: SettlementOutboxStatus[] = [
  SettlementOutboxStatus.pending,
  SettlementOutboxStatus.enqueued,
  SettlementOutboxStatus.in_progress,
];

/** CompensationRecord statuses that are still unresolved (a reconciliation drift). */
const OPEN_COMPENSATION_STATUSES: CompensationStatus[] = [
  CompensationStatus.pending,
  CompensationStatus.approved,
];

/** ComplianceEvent statuses that count as an OPEN case. */
const OPEN_COMPLIANCE_STATUSES: ComplianceStatus[] = [
  ComplianceStatus.flagged,
  ComplianceStatus.under_review,
];

/** Fallback staleness window when `pricing.feed` is absent. */
const DEFAULT_FEED_STALENESS_SEC = 900;

@Injectable()
export class MetricsOpsReadPrismaRepository implements IMetricsOpsReadRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROVIDER_CONNECTIVITY)
    private readonly connectivity: IProviderConnectivity,
    // F1: the live-rate feed's in-memory health surfaces on the same card.
    private readonly liveRateStore: LiveRateStore,
    private readonly config: EffectiveConfigService,
  ) {}

  async systemHealth(): Promise<SystemHealthResult> {
    const [providers, webhookQueueDepth, reconDriftCount] = await Promise.all([
      this.providerHealth(),
      this.prisma.settlementOutbox.count({
        where: { status: { in: QUEUE_STATUSES } },
      }),
      this.prisma.compensationRecord.count({
        where: { status: { in: OPEN_COMPENSATION_STATUSES } },
      }),
    ]);

    return {
      // Append the pricing-feed row (F1) so operators see feed freshness /
      // degradation / which sources are down on the existing system-health card.
      providers: [...providers, this.pricingFeedHealth()],
      webhookQueueDepth,
      reconDriftCount,
    };
  }

  /**
   * Derive the live market-rate feed's health from the in-memory LiveRateStore.
   * `lastLatencyMs` carries the age (ms) since the last successful fetch — the
   * card's existing latency column, repurposed here as "last-fetch age". When the
   * admin kill-switch is off the feed reports `ok` (config rates are intended).
   */
  private pricingFeedHealth(): ProviderHealthRow {
    const feed = this.config.get<PricingFeedConfig | undefined>('pricing.feed');
    const base = { key: 'pricing-feed', name: 'Pricing feed' };

    if (!feed || feed.enabled === false) {
      return {
        ...base,
        note: 'Disabled (config rates)',
        status: 'ok',
        lastLatencyMs: null,
      };
    }

    const stalenessSec =
      typeof feed.stalenessSec === 'number'
        ? feed.stalenessSec
        : DEFAULT_FEED_STALENESS_SEC;
    const snap = this.liveRateStore.healthSnapshot(new Date(), stalenessSec);
    const note =
      snap.sourcesDown.length > 0
        ? `Sources down: ${snap.sourcesDown.join(', ')}`
        : `Fresh ${snap.freshCount}/${snap.totalCount} rates`;

    return {
      ...base,
      note,
      status: snap.status,
      lastLatencyMs: snap.lastFetchAgeMs,
    };
  }

  /** Derive each provider's status + last observed latency from recent dispatches. */
  private async providerHealth(): Promise<ProviderHealthRow[]> {
    return Promise.all(
      PROVIDERS.map(async (provider) => {
        if (provider.settlementTypes.length === 0) {
          // No settlement source — derive liveness from the cached connectivity
          // probe. An unobserved result (mock / not-configured / no host) keeps the
          // ok/null placeholder rather than surface a fabricated status.
          const c = await this.connectivity.statusFor(provider.key);
          if (c !== null && c.observed) {
            return {
              key: provider.key,
              name: provider.name,
              note: provider.note,
              status: c.status,
              lastLatencyMs: c.latencyMs,
            };
          }
          return {
            key: provider.key,
            name: provider.name,
            note: provider.note,
            status: 'ok' as const,
            lastLatencyMs: null,
          };
        }

        const rows = await this.prisma.settlementOutbox.findMany({
          where: { settlementType: { in: provider.settlementTypes } },
          orderBy: { createdAt: 'desc' },
          take: HEALTH_SAMPLE,
          select: {
            status: true,
            createdAt: true,
            lastAttemptAt: true,
            completedAt: true,
          },
        });

        return {
          key: provider.key,
          name: provider.name,
          note: provider.note,
          status: statusOf(rows),
          lastLatencyMs: latencyOf(rows),
        };
      }),
    );
  }

  async activityFeed(limit: number): Promise<ActivityEventRow[]> {
    // Union recent rows from each real source, then merge-sort newest-first and
    // slice to `limit`. Each source is over-fetched to `limit` so the merged head
    // is complete regardless of which sources dominate.
    const [txns, audits, comps] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          status: {
            in: [TransactionStatus.completed, TransactionStatus.failed],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          type: true,
          status: true,
          metadata: true,
          createdAt: true,
          completedAt: true,
          failedAt: true,
        },
      }),
      this.prisma.auditLog.findMany({
        where: {
          action: {
            in: [AuditAction.kyc_state_change, AuditAction.config_change],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, action: true, subject: true, createdAt: true },
      }),
      this.prisma.compensationRecord.findMany({
        where: {
          status: CompensationStatus.issued,
          issuedAt: { not: null },
        },
        orderBy: { issuedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          reason: true,
          amount: true,
          currency: true,
          issuedAt: true,
        },
      }),
    ]);

    const events: ActivityEventRow[] = [
      ...txns.map(txnEvent),
      ...audits.map(auditEvent),
      ...comps.map(compensationEvent),
    ];

    return events
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, limit);
  }

  async openComplianceCount(): Promise<number> {
    return this.prisma.complianceEvent.count({
      where: { status: { in: OPEN_COMPLIANCE_STATUSES } },
    });
  }
}

// ---------------------------------------------------------------------------
// Pure row mappers (no Prisma import needed at call site)
// ---------------------------------------------------------------------------

interface OutboxSample {
  status: SettlementOutboxStatus;
  createdAt: Date;
  lastAttemptAt: Date | null;
  completedAt: Date | null;
}

/** all-failed → down, any-failed → degraded, else ok (no rows → ok). */
function statusOf(rows: OutboxSample[]): 'ok' | 'degraded' | 'down' {
  if (rows.length === 0) return 'ok';
  const failed = rows.filter(
    (r) => r.status === SettlementOutboxStatus.failed,
  ).length;
  if (failed === 0) return 'ok';
  if (failed === rows.length) return 'down';
  return 'degraded';
}

/** Most recent observed dispatch→completion duration (ms), or null if unmeasurable. */
function latencyOf(rows: OutboxSample[]): number | null {
  for (const row of rows) {
    if (row.completedAt === null) continue;
    const start = row.lastAttemptAt ?? row.createdAt;
    const ms = row.completedAt.getTime() - start.getTime();
    if (ms >= 0) return ms;
  }
  return null;
}

interface TxnRow {
  id: string;
  type: string;
  status: TransactionStatus;
  metadata: unknown;
  createdAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
}

/** A completed txn → "settled"; a failed txn → "failed". */
function txnEvent(row: TxnRow): ActivityEventRow {
  const settled = row.status === TransactionStatus.completed;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const asset = typeof meta.asset === 'string' ? meta.asset : '';
  const amount = typeof meta.amount === 'string' ? meta.amount : '';
  const amountNote = amount && asset ? ` · ${amount} ${asset}` : '';
  return {
    id: row.id,
    kind: settled ? 'settled' : 'failed',
    title: settled
      ? `${capitalize(row.type)} settled`
      : `${capitalize(row.type)} failed`,
    meta: `${row.id}${amountNote}`,
    at: (settled ? row.completedAt : row.failedAt) ?? row.createdAt,
  };
}

interface AuditRow {
  id: string;
  action: AuditAction;
  subject: string;
  createdAt: Date;
}

/** A KYC state-change → "kyc_approved"; a config change → "config_change". */
function auditEvent(row: AuditRow): ActivityEventRow {
  const isKyc = row.action === AuditAction.kyc_state_change;
  const kind: ActivityKind = isKyc ? 'kyc_approved' : 'config_change';
  return {
    id: row.id,
    kind,
    title: isKyc ? 'KYC state change' : 'Config change',
    meta: row.subject,
    at: row.createdAt,
  };
}

interface CompRow {
  id: string;
  reason: CompensationReason;
  amount: { toString(): string };
  currency: string;
  issuedAt: Date | null;
}

/**
 * An issued compensation → "sweep" (operator adjustment/reward) or "refund" (a
 * failed-settlement/processor-error/duplicate-debit reversal).
 */
function compensationEvent(row: CompRow): ActivityEventRow {
  const isRefund =
    row.reason === CompensationReason.settlement_failed ||
    row.reason === CompensationReason.processor_error ||
    row.reason === CompensationReason.duplicate_debit;
  const kind: ActivityKind = isRefund ? 'refund' : 'sweep';
  return {
    id: row.id,
    kind,
    title: isRefund ? 'Refund executed by engine' : 'Compensation issued',
    meta: `${row.id} · ${row.amount.toString()} ${row.currency}`,
    at: row.issuedAt ?? new Date(0),
  };
}

/** Title-cases a transaction type token (buy → Buy). */
function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
