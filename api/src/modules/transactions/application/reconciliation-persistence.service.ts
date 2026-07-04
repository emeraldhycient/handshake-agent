/**
 * ReconciliationPersistenceService (Go-readiness #3) — turns the ephemeral
 * reconciler passes into a DURABLE run log + break lifecycle.
 *
 * It wraps the existing reconcilers rather than replacing them:
 *   • it OWNS the settlement-reconciliation @Cron — each scheduled pass creates a
 *     ReconRun (persist-first), re-drives SettlementReconciliationService.tick(),
 *     records a `settlement_failure` break per failed row, and closes the run.
 *   • `persistWalletRun` records a run + its breaks from the results the
 *     admin-triggered WalletReconciliationService already produced (that service
 *     lives in AdminModule, so the admin endpoint runs it then hands the results
 *     here).
 *
 * Read/annotate only — it moves no money (§3.1) and holds no Prisma import (§3.2):
 * it reaches the store through IReconciliationRepository and the reconciler through
 * the injected service.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import {
  RECONCILIATION_REPOSITORY,
  type IReconciliationRepository,
  type ReconBreakTypeValue,
  type ReconBreakStatusValue,
  type ReconRunRecord,
} from './ports/reconciliation.repository.port';
import {
  SettlementReconciliationService,
  type SettlementReconSummary,
} from './settlement-reconciliation.service';

/**
 * The subset of a wallet-reconciliation result this service persists. Structurally
 * satisfied by the wallets module's `AssetReconciliationResult` — declared locally
 * so the transactions layer does not import across the module boundary.
 */
export interface WalletReconOutcome {
  walletId: string;
  asset: string;
  /** Signed on-chain-minus-ledger delta as a decimal string. */
  delta: string;
  action: string;
}

// A settlement_failure break records a STUCK re-drive, not a balance discrepancy:
// there is no meaningful amount, and pinning a currency would violate the
// multi-currency principle — so delta is 0 and currency is a non-locale marker.
const SETTLEMENT_BREAK_DELTA = '0';
const SETTLEMENT_BREAK_CURRENCY = 'n/a';

/** Maps a wallet-recon action to a persisted break, or null when it is not a break. */
function walletBreakFor(
  action: string,
): { breakType: ReconBreakTypeValue; status: ReconBreakStatusValue } | null {
  // over-credit: ledger exceeds on-chain — flagged for review, NEVER auto-debited.
  if (action === 'over_credit_flagged') {
    return { breakType: 'over_credit', status: 'detected' };
  }
  // credited: a real on-chain-vs-ledger mismatch the engine already remediated
  // (idempotent settleDepositAtomic) — recorded resolved for the durable trail.
  if (action === 'credited') {
    return { breakType: 'balance_mismatch', status: 'resolved' };
  }
  // in_sync (no delta) + already_credited (idempotent replay, nothing new) → not a break.
  return null;
}

@Injectable()
export class ReconciliationPersistenceService {
  private readonly logger = new Logger(ReconciliationPersistenceService.name);

  /**
   * Re-entrancy guard for the settlement @Cron (mirrors the reconciler's own): a
   * slow pass must not overlap the next tick. Released in `finally` so a thrown
   * pass never wedges the scheduler.
   */
  private isRunning = false;

  constructor(
    @Inject(RECONCILIATION_REPOSITORY)
    private readonly repo: IReconciliationRepository,
    private readonly settlement: SettlementReconciliationService,
  ) {}

  /**
   * The scheduled settlement-reconciliation pass (every 2 minutes). Owns the cron
   * so every scheduled run is persisted. Errors are swallowed (logged) so a failed
   * pass never wedges the scheduler; the run itself is still closed as `failed`.
   */
  @Cron('*/2 * * * *', { name: 'settlement-reconciliation' })
  async settlementReconciliationTick(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'reconciliation-persistence: previous settlement pass still running — skipping',
      );
      return;
    }
    this.isRunning = true;
    try {
      await this.runSettlementReconciliation();
    } catch (err: unknown) {
      this.logger.error(
        { err },
        'reconciliation-persistence: settlement pass failed',
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Persist-first: open the run BEFORE the batch (so a crash mid-batch still leaves
   * a durable row), re-drive the reconciler, record a `settlement_failure` break per
   * failed row, then close the run with its tallies. Rethrows on a batch failure
   * (after marking the run `failed`) so the caller sees it.
   */
  async runSettlementReconciliation(): Promise<ReconRunRecord> {
    const run = await this.repo.createRun({ runType: 'settlement_outbox' });

    let summary: SettlementReconSummary;
    try {
      summary = await this.settlement.tick();
    } catch (err) {
      await this.repo.completeRun(run.id, {
        status: 'failed',
        totalChecked: 0,
        breaksDetected: 0,
      });
      throw err;
    }

    for (const failure of summary.failures) {
      await this.repo.recordBreak({
        reconRunId: run.id,
        breakType: 'settlement_failure',
        outboxId: failure.outboxId,
        currency: SETTLEMENT_BREAK_CURRENCY,
        delta: SETTLEMENT_BREAK_DELTA,
      });
    }

    await this.repo.completeRun(run.id, {
      status: 'completed',
      totalChecked: summary.totalChecked,
      breaksDetected: summary.failures.length,
    });
    return run;
  }

  /**
   * Record a durable run + its breaks from a wallet-deposit reconciliation the admin
   * endpoint already ran. Over-credits are recorded `detected` (await human review);
   * engine-remediated mismatches are recorded `resolved`; in-sync/idempotent-replay
   * outcomes are not breaks.
   */
  async persistWalletRun(
    userId: string,
    results: WalletReconOutcome[],
  ): Promise<ReconRunRecord> {
    const run = await this.repo.createRun({ runType: 'wallet_deposit' });

    let breaksDetected = 0;
    for (const result of results) {
      const mapped = walletBreakFor(result.action);
      if (mapped === null) continue;
      await this.repo.recordBreak({
        reconRunId: run.id,
        breakType: mapped.breakType,
        status: mapped.status,
        userId,
        walletId: result.walletId,
        currency: result.asset,
        delta: result.delta,
      });
      breaksDetected += 1;
    }

    await this.repo.completeRun(run.id, {
      status: 'completed',
      totalChecked: results.length,
      breaksDetected,
    });
    return run;
  }
}
