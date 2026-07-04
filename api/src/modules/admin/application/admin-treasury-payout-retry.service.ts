import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { TreasuryPayoutRetryResponse } from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import { KycGateService } from '../../identity/application/kyc-gate.service';
import { ComplianceService } from '../../compliance/application/compliance.service';
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

/**
 * The outbox settlement type each retryable payout type is drained through. A
 * transaction type not in this map is not a retryable payout (buy/swap/etc.).
 */
const EXPECTED_OUTBOX_BY_TYPE: Readonly<Record<string, string>> = {
  sell: 'processor_payout',
  send: 'onchain_send',
};

/**
 * Go-readiness #2 — retry a STUCK settling payout (sell fiat payout OR on-chain
 * send), engine-brokered and re-checked. FUNDS-SAFETY-CRITICAL (§3.1): it NEVER
 * builds a ledger entry and NEVER re-sends a payout. It re-arms the EXISTING
 * settlement outbox row (original idempotency key) so the reconciler's settle path
 * re-verifies the outcome with the provider and finalises/refunds atomically. It
 * hard-rejects a completed payout (would double-pay) and a terminal-failed one
 * (already refunded). It re-checks the owning user server-side at retry (§3.3) —
 * KYC/status/tier/cooling-off + open-compliance-block, and for a SEND additionally
 * re-screens the destination address; a since-flagged user is rejected + escalated,
 * never pushed through. Holds no Prisma import (§3.2); every attempt is audited.
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
    private readonly complianceEvents: IComplianceEventRepository,
    private readonly complianceService: ComplianceService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Re-drive a stuck settling sell or send payout. Resolves the transaction
   * server-side (never a client-supplied id), gates it, re-checks the user, then
   * re-arms the existing settlement outbox row for the reconciliation worker.
   */
  async retryPayout(
    payoutId: string,
    reason: string,
    adminId: string,
  ): Promise<TreasuryPayoutRetryResponse> {
    // 1. Resolve server-side — the payout carries the REAL offending transactionId.
    const payout = await this.treasury.findPayoutQueueItem(payoutId);
    if (payout === null) throw new AdminNotFoundError('Payout');

    const txn = await this.transactions.findById(payout.transactionId);
    if (txn === null) throw new AdminNotFoundError('Transaction');

    // 2. Hard status/type gate (Gap A). Only a settling sell/send with the matching
    //    non-terminal outbox row is retryable; reject completed (double-pay) /
    //    terminal-failed (already refunded) / other types — all fail closed (§3.6).
    const expectedOutbox = EXPECTED_OUTBOX_BY_TYPE[txn.type];
    if (expectedOutbox === undefined) {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} is a '${txn.type}' — not a retryable payout (sell/send only).`,
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
    if (row === null || row.settlementType !== expectedOutbox) {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} has no ${expectedOutbox} settlement to retry.`,
      );
    }

    // 3. Re-check the user server-side (Gap B, §3.3) — reject + escalate on failure.
    await this.reCheckOrEscalate(txn, reason, adminId);

    // 4. Re-drive via the engine: re-arm the EXISTING row (original idempotency
    //    key). The reconciler's settle path verifies + finalises/refunds
    //    atomically — no money moves here, no fresh payout is sent (§3.1).
    await this.outbox.resetToPending(row.id);

    // 5. Immutable audit of the operator decision.
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `Transaction:${txn.id}`,
      action: 'admin_override',
      before: { status: txn.status, outboxStatus: row.status },
      after: {
        action: 'payout_retry_enqueued',
        type: txn.type,
        payoutId,
        reason,
      },
    });

    return {
      payoutId,
      transactionId: txn.id,
      status: 'retry_enqueued',
      reChecked: true,
    };
  }

  /**
   * Re-check via the velocity-free payout gate (uniform `velocityFiatAmount` — the
   * exact fiat value that hit the money gate at execute, present on both sell + send
   * metadata) + an open-compliance-block check, and for a SEND additionally
   * re-screen the destination address. On ANY failure: open a compliance escalation
   * + audit, then throw a single 403 PayoutRetryBlockedError. Never re-arms, never
   * moves money (the payout may be in flight — auto-refunding a flagged user would
   * risk a double-credit, §3.1).
   */
  private async reCheckOrEscalate(
    txn: TransactionRecord,
    reason: string,
    adminId: string,
  ): Promise<void> {
    const meta = txn.metadata as Record<string, string | undefined>;
    const fiatAmount = meta.velocityFiatAmount;
    const fiatCurrency = meta.velocityFiatCurrency;
    const asset = meta.asset;
    if (!fiatAmount || !fiatCurrency || !asset) {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} metadata is missing velocityFiatAmount/velocityFiatCurrency/asset — cannot re-check.`,
      );
    }

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

    // SEND: re-screen the on-chain destination against sanctions (the meaningful
    // re-check for an irreversible send). Fail closed on missing address/network.
    if (failure === null && txn.type === 'send') {
      const toAddress = meta.toAddress;
      const network = meta.network;
      if (!toAddress || !network) {
        throw new TxnNotTriageableError(
          `Transaction ${txn.id} send metadata is missing toAddress/network — cannot re-screen.`,
        );
      }
      const screening = await this.complianceService.screenSendDestination({
        userId: txn.userId,
        address: toAddress,
        network,
        transactionId: txn.id,
      });
      if (!screening.passed) {
        failure = `destination address failed sanctions re-screen: ${screening.reason ?? 'flagged'}`;
      }
    }

    if (failure === null) {
      const blocked = await this.complianceEvents.listByStatus(
        { userId: txn.userId, status: 'blocked' },
        { limit: 1 },
      );
      if (blocked.items.length > 0) {
        failure = 'user has an open compliance block';
      }
    }

    if (failure === null) return;

    await this.complianceEvents.create({
      userId: txn.userId,
      transactionId: txn.id,
      eventType: 'kyc_escalation',
      severity: 'high',
      screeningProvider: 'payout_retry_gate',
      ruleOrHit: failure,
      details: { reason, adminId, payoutRetry: true, type: txn.type },
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
