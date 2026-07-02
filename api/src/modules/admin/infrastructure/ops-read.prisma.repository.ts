/**
 * Prisma adapter for IOpsReadRepository (admin "System / ops" board, Phase 6b).
 *
 * READ-ONLY operational board — the provider status board, the webhook-ingest queue
 * depths + retries, and the background-jobs / cron registry. Infrastructure layer only —
 * imports the generated Prisma client / PrismaService (dependency-cruiser rule §3.2).
 * Maps Prisma rows → application-layer records; the service never sees Prisma types.
 * Nothing here mutates anything (§3.1); no PII crosses this boundary.
 *
 * DERIVATION (all from real rows — no synthetic probes, no fabricated figures §3.6):
 *   PROVIDER BOARD — each provider's status is inferred from the recent SettlementOutbox
 *     dispatch history for the settlement types it serves (all-failed → down, some-failed
 *     → warn, else ok). Providers with no settlement source (Resend/WhatsApp/Anthropic)
 *     report `ok` / latency null rather than fabricate a probe result.
 *   WEBHOOK QUEUES — each queue's depth is the count of still-pending SettlementOutbox
 *     rows for the settlement type its provider drains; `retries` is the sum of extra
 *     attempts (attempt − 1) across those pending rows. Queues with no outbox backing
 *     (on-chain deposit / WhatsApp inbound — credited/handled directly, not via outbox)
 *     report depth 0 / retries 0 / ok, never a fabricated backlog.
 *   CRON REGISTRY — the declared background jobs. `settlement-reconciliation` is a real
 *     @Cron (every 2 min) whose last observable run is the newest SettlementOutbox
 *     `lastAttemptAt` (the reconciler stamps markAttempt each tick); its status/health is
 *     derived from whether any pending row is currently failed. The remaining declared
 *     jobs have no observable run signal in this codebase yet, so they report
 *     `lastRunAt: null` / `status: idle` — declared, not fabricated as "ran 3m ago".
 */

import { Injectable } from '@nestjs/common';

import {
  SettlementOutboxStatus,
  SettlementType,
} from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  IOpsReadRepository,
  OpsBoardResult,
  OpsHealth,
  OpsJobRow,
  OpsProviderStatusRow,
  OpsWebhookQueueRow,
} from '../application/ports/ops-read.repository.port';

/** How many recent SettlementOutbox rows to sample per provider for health. */
const HEALTH_SAMPLE = 25;

/** SettlementOutbox statuses that count toward a pending webhook/dispatch queue. */
const QUEUE_STATUSES: SettlementOutboxStatus[] = [
  SettlementOutboxStatus.pending,
  SettlementOutboxStatus.enqueued,
  SettlementOutboxStatus.in_progress,
];

/** Provider registry: display metadata + the settlement types each one dispatches. */
interface ProviderDef {
  key: string;
  name: string;
  /** Settlement types dispatched through this provider (empty = no outbox source). */
  settlementTypes: SettlementType[];
}

const PROVIDERS: readonly ProviderDef[] = [
  {
    key: 'blockradar',
    name: 'Blockradar',
    settlementTypes: [SettlementType.onchain_send, SettlementType.swap],
  },
  {
    key: 'flutterwave',
    name: 'Flutterwave',
    settlementTypes: [
      SettlementType.processor_collection,
      SettlementType.processor_payout,
    ],
  },
  { key: 'resend', name: 'Resend', settlementTypes: [] },
  { key: 'whatsapp', name: 'WhatsApp Cloud', settlementTypes: [] },
  { key: 'anthropic', name: 'Anthropic', settlementTypes: [] },
];

/** Webhook-ingest queue registry: display key + the settlement type it drains (or null). */
interface QueueDef {
  key: string;
  /** Settlement type whose pending rows are this queue's depth; null = no outbox backing. */
  settlementType: SettlementType | null;
}

const WEBHOOK_QUEUES: readonly QueueDef[] = [
  // On-chain deposits are credited directly by the deposit webhook (no outbox row).
  { key: 'blockradar.deposit', settlementType: null },
  { key: 'blockradar.withdraw', settlementType: SettlementType.onchain_send },
  {
    key: 'flutterwave.collection',
    settlementType: SettlementType.processor_collection,
  },
  // Inbound chat is handled by the WhatsApp module directly (no settlement outbox).
  { key: 'whatsapp.inbound', settlementType: null },
];

/**
 * The declared background-jobs / cron registry. `hasOutboxSignal` marks the reconciler,
 * whose last observable run is derivable from SettlementOutbox `lastAttemptAt`; the rest
 * are declared-but-unobserved in this codebase (no run signal → idle / null).
 */
interface JobDef {
  id: string;
  name: string;
  schedule: string;
  hasReconcilerSignal: boolean;
}

const JOBS: readonly JobDef[] = [
  {
    id: 'settlement-reconciliation',
    name: 'Reconciliation sweep',
    // Matches the @Cron('*/2 * * * *') on SettlementReconciliationService.
    schedule: '*/2 * * * *',
    hasReconcilerSignal: true,
  },
  {
    id: 'child-address-sweep',
    name: 'Child-address sweep',
    schedule: '0 * * * *',
    hasReconcilerSignal: false,
  },
  {
    id: 'sanctions-refresh',
    name: 'Sanctions list refresh',
    schedule: '0 3 * * *',
    hasReconcilerSignal: false,
  },
  {
    id: 'statement-link-regen',
    name: 'Statement-link regen',
    schedule: '0 0 * * *',
    hasReconcilerSignal: false,
  },
];

@Injectable()
export class OpsReadPrismaRepository implements IOpsReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async board(): Promise<OpsBoardResult> {
    const [providers, webhookQueues, jobs] = await Promise.all([
      this.providerBoard(),
      this.webhookQueues(),
      this.jobs(),
    ]);

    return { providers, webhookQueues, jobs };
  }

  /** Derive each provider's status + last observed latency from recent dispatches. */
  private async providerBoard(): Promise<OpsProviderStatusRow[]> {
    return Promise.all(
      PROVIDERS.map(async (provider) => {
        if (provider.settlementTypes.length === 0) {
          return {
            key: provider.key,
            name: provider.name,
            health: 'ok' as const,
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
          health: healthOf(rows),
          lastLatencyMs: latencyOf(rows),
        };
      }),
    );
  }

  /** Per-queue pending depth + retry sum, from the pending outbox rows it drains. */
  private async webhookQueues(): Promise<OpsWebhookQueueRow[]> {
    return Promise.all(
      WEBHOOK_QUEUES.map(async (queue) => {
        if (queue.settlementType === null) {
          return {
            key: queue.key,
            depth: 0,
            retries: 0,
            health: 'ok' as const,
          };
        }

        const rows = await this.prisma.settlementOutbox.findMany({
          where: {
            settlementType: queue.settlementType,
            status: { in: QUEUE_STATUSES },
          },
          select: { attempt: true },
        });

        const depth = rows.length;
        // Extra attempts beyond the first = in-flight retries for this queue.
        const retries = rows.reduce(
          (sum, r) => sum + Math.max(0, r.attempt - 1),
          0,
        );
        return {
          key: queue.key,
          depth,
          retries,
          health: queueHealthOf(depth, retries),
        };
      }),
    );
  }

  /** The declared cron registry with the reconciler's last observable run. */
  private async jobs(): Promise<OpsJobRow[]> {
    const [lastReconcileAttempt, hasFailedRow] = await Promise.all([
      this.prisma.settlementOutbox.findFirst({
        where: { lastAttemptAt: { not: null } },
        orderBy: { lastAttemptAt: 'desc' },
        select: { lastAttemptAt: true },
      }),
      this.prisma.settlementOutbox.count({
        where: { status: SettlementOutboxStatus.failed },
      }),
    ]);

    return JOBS.map((job) => {
      if (!job.hasReconcilerSignal) {
        // Declared but no observable run signal in this codebase — never fabricate one.
        return {
          id: job.id,
          name: job.name,
          schedule: job.schedule,
          lastRunAt: null,
          status: 'idle' as const,
          health: 'ok' as const,
        };
      }

      const lastRunAt = lastReconcileAttempt?.lastAttemptAt ?? null;
      const failing = hasFailedRow > 0;
      return {
        id: job.id,
        name: job.name,
        schedule: job.schedule,
        lastRunAt,
        // No observed attempt yet → idle; a failed row it should be draining → failed; else ok.
        status: lastRunAt === null ? 'idle' : failing ? 'failed' : 'ok',
        health: failing ? 'down' : 'ok',
      };
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

/** all-failed → down, any-failed → warn, else ok (no rows → ok). */
function healthOf(rows: OutboxSample[]): OpsHealth {
  if (rows.length === 0) return 'ok';
  const failed = rows.filter(
    (r) => r.status === SettlementOutboxStatus.failed,
  ).length;
  if (failed === 0) return 'ok';
  if (failed === rows.length) return 'down';
  return 'warn';
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

/** A retry-bearing backlog → down; any depth/retries → warn; else ok. */
function queueHealthOf(depth: number, retries: number): OpsHealth {
  if (retries > 0 && depth > 0) return 'down';
  if (depth > 0 || retries > 0) return 'warn';
  return 'ok';
}
