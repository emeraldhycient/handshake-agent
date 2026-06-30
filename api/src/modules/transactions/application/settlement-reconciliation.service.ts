/**
 * SettlementReconciliationService — Fix F (webhook-miss recovery).
 *
 * Runs on a configurable cron schedule (default: every 2 minutes).
 * Loads SettlementOutbox rows that are still 'pending' and whose createdAt
 * is older than a grace window (to avoid racing with in-flight webhooks), then
 * re-drives settlement through the deterministic execution engine.
 *
 * The settle methods (settleSellPayout, settleSendOnChain, settleBuyPayment)
 * are IDEMPOTENT — re-driving a row whose webhook already completed is safe:
 * the method returns 'completed' and the row is marked done (no double-settle).
 *
 * Invariants preserved:
 *   §3.1 — model proposes, engine disposes: this service only calls the engine.
 *   §3.2 — no DB credentials here: uses the ISettlementOutboxRepository port.
 *   §3.3 — no user-level KYC checks here; those live in the settle methods.
 *
 * Batch-safety:
 *   - One failing row does NOT abort the batch (per-row try/catch).
 *   - Batch is bounded by config.reconciliation.batchSize.
 *   - markAttempt is called BEFORE the settle call to prevent hot-looping
 *     if the settle call always throws (the attempt count provides back-off info).
 *   - complete is called only for terminal statuses (completed / failed / refunded).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { ReconciliationConfig } from '../../../core/config/configuration';
import {
  SETTLEMENT_OUTBOX_REPOSITORY,
  type ISettlementOutboxRepository,
  type SettlementOutboxRecord,
} from './ports/settlement-outbox.repository.port';
import { ExecutionService } from './execution.service';

// ---------------------------------------------------------------------------
// Settlement types handled by the reconciler (subset of SettlementType enum).
// 'compensation' is excluded — compensations are not re-drivable by this poller.
// ---------------------------------------------------------------------------
const HANDLED_TYPES = new Set([
  'processor_payout',
  'onchain_send',
  'processor_collection',
]);

// Statuses returned by settle methods that indicate the row is fully drained.
const TERMINAL_STATUSES = new Set(['completed', 'failed']);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SettlementReconciliationService {
  private readonly logger = new Logger(SettlementReconciliationService.name);
  private readonly reconciliationConfig: ReconciliationConfig;

  constructor(
    @Inject(SETTLEMENT_OUTBOX_REPOSITORY)
    private readonly outboxRepo: ISettlementOutboxRepository,
    private readonly executionService: ExecutionService,
    private readonly config: EffectiveConfigService,
  ) {
    this.reconciliationConfig =
      this.config.get<ReconciliationConfig>('reconciliation');
  }

  /**
   * Cron tick — loads pending outbox rows past the grace window and re-drives
   * settlement by type. Errors on individual rows are logged and do not abort
   * the batch (§3.1: engine disposes; a failing row is a concern, not a crash).
   *
   * The cron schedule is hard-coded to every 2 minutes (every-2-min literal).
   * NestJS @Cron decorators are evaluated at class-compile time and cannot
   * read runtime config values, so the expression cannot be driven from
   * config.reconciliation without rewriting to SchedulerRegistry —
   * a disproportionate complexity trade-off for an infra parameter that changes
   * rarely. Changing the tick frequency requires a code change + redeploy
   * (not admin-tunable at runtime per root CLAUDE.md §7).
   *
   * Tests call tick() directly to avoid the scheduler entirely.
   */
  @Cron('*/2 * * * *', { name: 'settlement-reconciliation' })
  async tick(): Promise<void> {
    const { gracePeriodSec, batchSize } = this.reconciliationConfig;

    const pending = await this.outboxRepo.findPending({
      olderThanSec: gracePeriodSec,
      limit: batchSize,
    });

    if (pending.length === 0) {
      this.logger.debug(
        'settlement-reconciliation: no pending rows past grace window',
      );
      return;
    }

    this.logger.log(
      `settlement-reconciliation: processing ${pending.length} pending outbox row(s)`,
    );

    let processed = 0;
    let skipped = 0;

    for (const row of pending) {
      if (!HANDLED_TYPES.has(row.settlementType)) {
        this.logger.warn(
          { outboxId: row.id, settlementType: row.settlementType },
          'settlement-reconciliation: unknown settlementType — skipped',
        );
        skipped++;
        continue;
      }

      try {
        await this.processRow(row);
        processed++;
      } catch (err: unknown) {
        this.logger.error(
          {
            outboxId: row.id,
            settlementType: row.settlementType,
            transactionId: row.transactionId,
            err,
          },
          'settlement-reconciliation: row failed — continuing batch',
        );
        // Do NOT rethrow — one failing row must not abort the rest of the batch.
      }
    }

    this.logger.log(
      `settlement-reconciliation: done — processed=${processed} skipped=${skipped} total=${pending.length}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async processRow(row: SettlementOutboxRecord): Promise<void> {
    const reference =
      (row.payload?.reference as string | undefined) ??
      row.idempotencyKey ??
      '';

    // markAttempt BEFORE the settle call so a crash mid-settle still increments
    // the counter (avoids silent hot-looping with zero back-off visibility).
    await this.outboxRepo.markAttempt(row.id);

    let terminalStatus: string | null = null;

    if (row.settlementType === 'processor_payout') {
      // Sell phase 2: verify NGN payout via Flutterwave and finalize/refund.
      const result = await this.executionService.settleSellPayout({
        reference,
      });
      this.logger.log(
        {
          outboxId: row.id,
          txnId: result.transactionId,
          status: result.status,
        },
        'settlement-reconciliation: settleSellPayout result',
      );
      if (TERMINAL_STATUSES.has(result.status)) {
        terminalStatus = result.status;
      }
    } else if (row.settlementType === 'onchain_send') {
      // Send phase 2: query the provider to learn the actual on-chain outcome
      // before deciding to finalize or refund. A missed webhook does NOT imply
      // the withdrawal failed — the USDT may already be on-chain. Refunding a
      // confirmed withdrawal = double-spend / platform loss.
      //
      // Decision tree:
      //   provider 'success'  → settleSendOnChain(success=true, onChainTxHash)
      //   provider 'failed'   → settleSendOnChain(success=false) — refund
      //   provider 'pending'  → leave row open (markAttempt only, no complete)
      //
      // Webhook path (payload already has onChainTxHash from a previously-processed
      // webhook that updated the outbox payload but not yet completed it) bypasses
      // the provider query — the hash is authoritative.
      const payloadHash = row.payload?.onChainTxHash as string | undefined;

      if (payloadHash) {
        // Webhook already confirmed success and wrote the hash into the payload;
        // reconciler just needs to finalize (idempotent settle call).
        const result = await this.executionService.settleSendOnChain({
          reference,
          success: true,
          onChainTxHash: payloadHash,
        });
        this.logger.log(
          {
            outboxId: row.id,
            txnId: result.transactionId,
            status: result.status,
          },
          'settlement-reconciliation: settleSendOnChain(hash-from-payload) result',
        );
        if (TERMINAL_STATUSES.has(result.status)) {
          terminalStatus = result.status;
        }
      } else {
        // No confirmed hash in payload: webhook was missed. Query the provider
        // for the actual withdrawal status before taking any action.
        const providerStatus =
          await this.executionService.querySendWithdrawalStatus(reference);

        this.logger.log(
          {
            outboxId: row.id,
            providerStatus: providerStatus.status,
          },
          'settlement-reconciliation: onchain_send provider status',
        );

        if (providerStatus.status === 'success') {
          const result = await this.executionService.settleSendOnChain({
            reference,
            success: true,
            onChainTxHash: providerStatus.onChainTxHash,
          });
          this.logger.log(
            {
              outboxId: row.id,
              txnId: result.transactionId,
              status: result.status,
            },
            'settlement-reconciliation: settleSendOnChain(provider-success) result',
          );
          if (TERMINAL_STATUSES.has(result.status)) {
            terminalStatus = result.status;
          }
        } else if (providerStatus.status === 'failed') {
          const result = await this.executionService.settleSendOnChain({
            reference,
            success: false,
          });
          this.logger.log(
            {
              outboxId: row.id,
              txnId: result.transactionId,
              status: result.status,
            },
            'settlement-reconciliation: settleSendOnChain(provider-failed) result',
          );
          if (TERMINAL_STATUSES.has(result.status)) {
            terminalStatus = result.status;
          }
        } else {
          // status === 'pending' (or unknown/error — provider returns pending on error).
          // Leave the outbox row open: markAttempt was already called above.
          // The webhook or a later reconciler tick will finalize.
          this.logger.log(
            { outboxId: row.id },
            'settlement-reconciliation: onchain_send still pending at provider — leaving row open',
          );
          // terminalStatus stays null → no complete() call.
        }
      }
    } else if (row.settlementType === 'processor_collection') {
      // Buy phase 2: verify NGN collection and credit USDT.
      const result = await this.executionService.settleBuyPayment({
        reference,
      });
      this.logger.log(
        {
          outboxId: row.id,
          txnId: result.transactionId,
          status: result.status,
        },
        'settlement-reconciliation: settleBuyPayment result',
      );
      if (TERMINAL_STATUSES.has(result.status)) {
        terminalStatus = result.status;
      }
    }

    if (terminalStatus !== null) {
      await this.outboxRepo.complete(row.id);
      this.logger.log(
        { outboxId: row.id, terminalStatus },
        'settlement-reconciliation: outbox row completed',
      );
    }
  }
}
