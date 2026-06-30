import { Inject, Injectable } from '@nestjs/common';

import type {
  AdminTxnDetail,
  AdminTxnListItem,
  AdminTxnLedgerLeg,
  AdminTxnStatus,
  AdminTxnTimelineEntry,
} from '@handshake-agent/contracts';

import {
  LEDGER_REPOSITORY,
  type ILedgerRepository,
  type LedgerEntryRecord,
} from '../../transactions/application/ports/ledger.repository.port';
import {
  TRANSACTION_REPOSITORY,
  type ITransactionRepository,
  type TransactionRecord,
} from '../../transactions/application/ports/transaction.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';

/** Default page size for the admin transactions list when the caller omits one. */
const DEFAULT_LIST_LIMIT = 20;

export interface AdminTxnListQuery {
  status?: string;
  type?: string;
  userId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

/**
 * Phase 3 (sub-area A) — READ-ONLY transactions oversight for the admin console.
 *
 * This service NEVER moves money (§3.1): it only projects existing Transaction
 * rows and their double-entry ledger legs. It holds no Prisma import — it reaches
 * data exclusively through the injected repository ports (§3.2).
 */
@Injectable()
export class AdminTxnOversightService {
  constructor(
    @Inject(TRANSACTION_REPOSITORY)
    private readonly txns: ITransactionRepository,
    @Inject(LEDGER_REPOSITORY)
    private readonly ledger: ILedgerRepository,
  ) {}

  // ── list ───────────────────────────────────────────────────────────────────

  async list(
    query: AdminTxnListQuery,
  ): Promise<{ items: AdminTxnListItem[]; nextCursor: string | null }> {
    const result = await this.txns.listAll(
      {
        status: query.status,
        type: query.type,
        userId: query.userId,
        from: query.from !== undefined ? new Date(query.from) : undefined,
        to: query.to !== undefined ? new Date(query.to) : undefined,
      },
      { cursor: query.cursor, limit: query.limit ?? DEFAULT_LIST_LIMIT },
    );

    return {
      items: result.items.map((t) => this.toListItem(t)),
      nextCursor: result.nextCursor,
    };
  }

  // ── getDetail ──────────────────────────────────────────────────────────────

  async getDetail(id: string): Promise<AdminTxnDetail> {
    const txn = await this.txns.findById(id);
    if (txn === null) throw new AdminNotFoundError('Transaction');

    const legs = await this.ledger.listByTransaction(id);

    return {
      id: txn.id,
      userId: txn.userId,
      type: txn.type,
      status: txn.status as AdminTxnStatus,
      idempotencyKey: txn.idempotencyKey,
      processorTxRef: txn.processorTxRef,
      onChainTxHash: txn.onChainTxHash,
      failureReason: txn.failureReason,
      createdAt: txn.createdAt.toISOString(),
      executedAt: toIso(txn.executedAt),
      completedAt: toIso(txn.completedAt),
      failedAt: toIso(txn.failedAt),
      ledgerLegs: legs.map((l) => this.toLeg(l)),
      timeline: this.deriveTimeline(txn),
    };
  }

  // ── private mappers ──────────────────────────────────────────────────────────

  private toListItem(t: TransactionRecord): AdminTxnListItem {
    return {
      id: t.id,
      userId: t.userId,
      type: t.type,
      status: t.status as AdminTxnStatus,
      createdAt: t.createdAt.toISOString(),
    };
  }

  private toLeg(l: LedgerEntryRecord): AdminTxnLedgerLeg {
    return {
      accountType: l.accountType,
      accountId: l.accountId,
      currency: l.currency,
      amount: l.amount,
      direction: l.direction as 'debit' | 'credit',
      balanceAfter: l.balanceAfter,
      postedAt: l.postedAt.toISOString(),
    };
  }

  /**
   * Derives a chronological lifecycle timeline from the transaction's non-null
   * timestamps (createdAt→created, executedAt→settling, completedAt→completed,
   * failedAt→failed). Only present timestamps are included; sorted ascending.
   */
  private deriveTimeline(t: TransactionRecord): AdminTxnTimelineEntry[] {
    const candidates: { status: string; at: Date | null }[] = [
      { status: 'created', at: t.createdAt },
      { status: 'settling', at: t.executedAt },
      { status: 'completed', at: t.completedAt },
      { status: 'failed', at: t.failedAt },
    ];

    return candidates
      .filter((c): c is { status: string; at: Date } => c.at !== null)
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((c) => ({ status: c.status, at: c.at.toISOString() }));
  }
}

function toIso(value: Date | null): string | null {
  return value !== null ? value.toISOString() : null;
}
