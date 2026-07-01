/**
 * Prisma adapter for IReconciliationReadRepository (admin RECONCILIATION, Phase 6b).
 *
 * READ-ONLY provider-vs-ledger break detection. Infrastructure layer only — the
 * only place in this feature that imports the generated Prisma client /
 * PrismaService (dependency-cruiser rule §3.2). Maps Prisma rows →
 * application-layer records; the service never sees Prisma types. Nothing here
 * mutates anything (§3.1).
 *
 * There is no persisted break entity — breaks are PROJECTED from two real sources:
 *
 *   1. Unresolved CompensationRecord rows (pending/approved, not yet issued). A
 *      compensation exists precisely because the engine detected a settlement drift
 *      that owes the user a reversal/refund — the canonical provider-vs-ledger break
 *      signal. Its `reason` selects the break kind:
 *        duplicate_debit   → duplicate_credit
 *        processor_error   → amount_mismatch
 *        settlement_failed → over_credit
 *        (operator_adjustment / promotion_reward are NOT breaks — excluded.)
 *      The signed `delta` is the compensation amount (a credit owed back → positive).
 *
 *   2. Stuck SettlementOutbox rows (pending/enqueued/in_progress) older than the
 *      grace window: the provider was asked to settle but the row never reached a
 *      terminal state and its webhook was missed → missing_settlement. The `delta`
 *      is the outbound leg from the joined transaction metadata (negative — the
 *      ledger debited but the settlement never confirmed).
 *
 * CRON STATUS: the reconciler runs on a hard-coded 2-min `@Cron`; the last observed
 * run is the most-recent SettlementOutbox attempt/completion timestamp, and the next
 * run is that + the tick interval (a projection, since the schedule is fixed).
 */

import { Injectable } from '@nestjs/common';

import {
  CompensationReason,
  CompensationStatus,
  SettlementOutboxStatus,
} from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  IReconciliationReadRepository,
  ReconBreakKind,
  ReconBreakRecord,
  ReconCronStatusRecord,
} from '../application/ports/reconciliation-read.repository.port';

/** Cap on each projected feed (newest-first). */
const FEED_LIMIT = 100;

/** CompensationRecord statuses that are still unresolved (an open break). */
const OPEN_COMPENSATION_STATUSES: CompensationStatus[] = [
  CompensationStatus.pending,
  CompensationStatus.approved,
];

/** SettlementOutbox statuses that mean "not yet settled" (a stuck settlement). */
const STUCK_OUTBOX_STATUSES: SettlementOutboxStatus[] = [
  SettlementOutboxStatus.pending,
  SettlementOutboxStatus.enqueued,
  SettlementOutboxStatus.in_progress,
];

/** Compensation reasons that represent a provider-vs-ledger break → break kind. */
const BREAK_KIND_BY_REASON: Partial<
  Record<CompensationReason, ReconBreakKind>
> = {
  [CompensationReason.duplicate_debit]: 'duplicate_credit',
  [CompensationReason.processor_error]: 'amount_mismatch',
  [CompensationReason.settlement_failed]: 'over_credit',
};

@Injectable()
export class ReconciliationReadPrismaRepository implements IReconciliationReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listBreaks(staleAfterSec: number): Promise<ReconBreakRecord[]> {
    const [compensations, stuckSettlements] = await Promise.all([
      this.compensationBreaks(),
      this.missingSettlementBreaks(staleAfterSec),
    ]);

    return [...compensations, ...stuckSettlements].sort(
      (a, b) => b.detectedAt.getTime() - a.detectedAt.getTime(),
    );
  }

  /** Unresolved compensation drifts → duplicate / mismatch / over-credit breaks. */
  private async compensationBreaks(): Promise<ReconBreakRecord[]> {
    const rows = await this.prisma.compensationRecord.findMany({
      where: {
        status: { in: OPEN_COMPENSATION_STATUSES },
        reason: {
          in: Object.keys(BREAK_KIND_BY_REASON) as CompensationReason[],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: FEED_LIMIT,
      select: {
        id: true,
        reason: true,
        amount: true,
        currency: true,
        originatingTransactionId: true,
        createdAt: true,
      },
    });

    return rows.flatMap((row) => {
      const kind = BREAK_KIND_BY_REASON[row.reason];
      if (kind === undefined) return [];
      return [
        {
          id: row.id,
          kind,
          transactionId: row.originatingTransactionId,
          asset: row.currency,
          // A compensation owes the user a credit back → positive provider-minus-ledger.
          delta: `+${row.amount.toString()}`,
          detail: detailFor(kind, row.amount.toString(), row.currency),
          detectedAt: row.createdAt,
        },
      ];
    });
  }

  /** Stuck outbox rows past the grace window → missing-settlement breaks. */
  private async missingSettlementBreaks(
    staleAfterSec: number,
  ): Promise<ReconBreakRecord[]> {
    const cutoff = new Date(Date.now() - staleAfterSec * 1000);
    const rows = await this.prisma.settlementOutbox.findMany({
      where: {
        status: { in: STUCK_OUTBOX_STATUSES },
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'desc' },
      take: FEED_LIMIT,
      select: {
        id: true,
        transactionId: true,
        createdAt: true,
        transaction: { select: { metadata: true } },
      },
    });

    return rows.map((row) => {
      const meta = asRecord(row.transaction?.metadata);
      const asset = str(meta.asset) ?? 'NGN';
      const amount = str(meta.amount) ?? str(meta.fiatAmount) ?? '0';
      return {
        id: row.id,
        kind: 'missing_settlement' as const,
        transactionId: row.transactionId,
        asset,
        // The ledger debited but the settlement never confirmed → negative.
        delta: `-${amount}`,
        detail: detailFor('missing_settlement', amount, asset),
        detectedAt: row.createdAt,
      };
    });
  }

  async cronStatus(intervalSec: number): Promise<ReconCronStatusRecord> {
    // The most-recent observed reconciler touch: the latest attempt/completion
    // across the outbox. The reconciler re-drives outbox rows, so their attempt
    // timestamps are the closest observable proxy for "last run".
    const latest = await this.prisma.settlementOutbox.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { lastAttemptAt: true, completedAt: true, createdAt: true },
    });

    const lastRunAt =
      latest?.completedAt ?? latest?.lastAttemptAt ?? latest?.createdAt ?? null;
    const nextRunAt =
      lastRunAt !== null
        ? new Date(lastRunAt.getTime() + intervalSec * 1000)
        : null;

    return { lastRunAt, nextRunAt };
  }
}

// ── module-private derivations (infra-only presentation of operational state) ────────

/** A PII-free, operator-desk explanation per break kind. */
function detailFor(
  kind: ReconBreakKind,
  amount: string,
  asset: string,
): string {
  switch (kind) {
    case 'over_credit':
      return `Ledger credited ${amount} ${asset} more than the provider confirmed. Excess is flagged for human action — never auto-debited.`;
    case 'duplicate_credit':
      return `A duplicate credit of ${amount} ${asset} posted for a single provider settlement. Flagged for engine-brokered reversal.`;
    case 'amount_mismatch':
      return `Provider and ledger amounts diverge by ${amount} ${asset} after processing. Reconcile the drift.`;
    case 'missing_settlement':
      return `The provider settled ${amount} ${asset} but the matching ledger entry has not posted. Awaiting webhook replay or manual settlement.`;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
