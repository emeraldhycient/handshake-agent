import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { TreasuryPayoutRetryResponse } from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import { KycGateService } from '../../identity/application/kyc-gate.service';
import {
  COMPLIANCE_EVENT_REPOSITORY,
  type IComplianceEventRepository,
} from '../../compliance/application/ports/compliance-event.repository.port';
import {
  TREASURY_READ_REPOSITORY,
  type ITreasuryReadRepository,
} from '../../treasury/application/ports/treasury-read.repository.port';
import {
  TRANSACTION_REPOSITORY,
  type ITransactionRepository,
  type TransactionRecord,
} from '../../transactions/application/ports/transaction.repository.port';
import {
  SETTLEMENT_OUTBOX_REPOSITORY,
  type ISettlementOutboxRepository,
} from '../../transactions/application/ports/settlement-outbox.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';
import { TxnNotTriageableError } from '../domain/txn-triage-errors';
import { PayoutRetryBlockedError } from '../domain/treasury-operator-errors';

/** The outbox settlement type a sell payout is drained through. */
const PROCESSOR_PAYOUT = 'processor_payout';

/**
 * Go-readiness #2 — retry a STUCK settling sell payout, engine-brokered and
 * re-checked. FUNDS-SAFETY-CRITICAL (§3.1): it NEVER builds a ledger entry and
 * NEVER re-sends a payout. It re-arms the EXISTING settlement outbox row (the
 * original idempotency key) so the reconciler's `settleSellPayout` re-verifies the
 * payout with the provider and finalises/refunds atomically. It hard-rejects a
 * completed payout (would double-pay) and a terminal-failed one (already refunded).
 * It re-checks the owning user server-side at retry (§3.3); a since-flagged /
 * downgraded user is rejected + escalated, never pushed through. It holds no Prisma
 * import — it reaches data only through injected ports (§3.2). Every attempt is
 * immutably audited (§3.6).
 */
@Injectable()
export class AdminTreasuryPayoutRetryService {
  constructor(
    @Inject(TREASURY_READ_REPOSITORY)
    private readonly treasury: ITreasuryReadRepository,
    @Inject(TRANSACTION_REPOSITORY)
    private readonly transactions: ITransactionRepository,
    @Inject(SETTLEMENT_OUTBOX_REPOSITORY)
    private readonly outbox: ISettlementOutboxRepository,
    private readonly kycGate: KycGateService,
    @Inject(COMPLIANCE_EVENT_REPOSITORY)
    private readonly compliance: IComplianceEventRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Re-drive a stuck settling sell payout. Resolves the transaction server-side
   * (never a client-supplied id), gates it, re-checks the user, then re-arms the
   * existing settlement outbox row for the reconciliation worker.
   */
  async retrySellPayout(
    payoutId: string,
    reason: string,
    adminId: string,
  ): Promise<TreasuryPayoutRetryResponse> {
    // 1. Resolve server-side — the payout carries the REAL offending transactionId.
    const payout = await this.treasury.findPayoutQueueItem(payoutId);
    if (payout === null) throw new AdminNotFoundError('Payout');

    const txn = await this.transactions.findById(payout.transactionId);
    if (txn === null) throw new AdminNotFoundError('Transaction');

    // 2. Hard status gate (Gap A). Reject completed (double-pay) / terminal-failed
    //    (already refunded) / non-settling / non-sell — all fail closed (§3.6).
    if (txn.type !== 'sell') {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} is a '${txn.type}', not a sell payout.`,
      );
    }
    if (txn.status === 'completed') {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} is already completed — retrying would double-pay.`,
      );
    }
    if (txn.status !== 'settling') {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} is '${txn.status}', not 'settling' — nothing to retry.`,
      );
    }
    const row = await this.outbox.findByTransactionId(txn.id);
    if (row === null || row.settlementType !== PROCESSOR_PAYOUT) {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} has no payout settlement to retry.`,
      );
    }

    // 3. Re-check the user server-side (Gap B, §3.3) — reject + escalate on failure.
    const { fiatAmount, fiatCurrency, asset } = this.reserveFields(txn);
    await this.reCheckOrEscalate(
      txn,
      fiatAmount,
      fiatCurrency,
      asset,
      reason,
      adminId,
    );

    // 4. Re-drive via the engine: re-arm the EXISTING row (original idempotency
    //    key). The reconciler's settleSellPayout verifies + finalises/refunds
    //    atomically — no money moves here, no fresh payout is sent (§3.1).
    await this.outbox.resetToPending(row.id);

    // 5. Immutable audit of the operator decision.
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `Transaction:${txn.id}`,
      action: 'admin_override',
      before: { status: txn.status, outboxStatus: row.status },
      after: { action: 'payout_retry_enqueued', payoutId, reason },
    });

    return {
      payoutId,
      transactionId: txn.id,
      status: 'retry_enqueued',
      reChecked: true,
    };
  }

  /**
   * netFiatAmount + fiatCurrency + asset from the sell metadata (written at
   * executeSell). Fail closed if any is missing — corrupt metadata must never
   * pass the re-check with a guessed amount (§3.6).
   */
  private reserveFields(txn: TransactionRecord): {
    fiatAmount: string;
    fiatCurrency: string;
    asset: string;
  } {
    const meta = txn.metadata as Record<string, string | undefined>;
    const fiatAmount = meta.netFiatAmount;
    const fiatCurrency = meta.fiatCurrency;
    const asset = meta.asset;
    if (!fiatAmount || !fiatCurrency || !asset) {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} metadata is missing netFiatAmount/fiatCurrency/asset — cannot re-check.`,
      );
    }
    return { fiatAmount, fiatCurrency, asset };
  }

  /**
   * Re-check via the velocity-free payout gate + an open-compliance-block check.
   * On ANY failure: open a compliance escalation + audit, then throw a single 403
   * PayoutRetryBlockedError. Never re-arms, never moves money (the payout may be in
   * flight — auto-refunding a flagged user would risk a double-credit, §3.1).
   */
  private async reCheckOrEscalate(
    txn: TransactionRecord,
    fiatAmount: string,
    fiatCurrency: string,
    asset: string,
    reason: string,
    adminId: string,
  ): Promise<void> {
    let failure: string | null = null;
    try {
      await this.kycGate.assertCanReleasePayout({
        userId: txn.userId,
        fiatAmount,
        fiatCurrency,
        asset,
      });
    } catch (err: unknown) {
      failure = err instanceof Error ? err.message : 'kyc re-check failed';
    }

    if (failure === null) {
      const blocked = await this.compliance.listByStatus(
        { userId: txn.userId, status: 'blocked' },
        { limit: 1 },
      );
      if (blocked.items.length > 0) {
        failure = 'user has an open compliance block';
      }
    }

    if (failure === null) return;

    await this.compliance.create({
      userId: txn.userId,
      transactionId: txn.id,
      eventType: 'kyc_escalation',
      severity: 'high',
      screeningProvider: 'payout_retry_gate',
      ruleOrHit: failure,
      details: { reason, adminId, payoutRetry: true },
      status: 'flagged',
    });
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `Transaction:${txn.id}`,
      action: 'admin_review',
      before: { status: txn.status },
      after: { action: 'payout_retry_blocked', failure, reason },
    });
    throw new PayoutRetryBlockedError();
  }
}
