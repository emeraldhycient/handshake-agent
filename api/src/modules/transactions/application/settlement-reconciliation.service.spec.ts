/**
 * Unit tests for SettlementReconciliationService (Fix F — webhook-miss recovery).
 *
 * TDD: these tests were written before the service implementation.
 *
 * Verifies:
 *   - pending processor_payout row → executionService.settleSellPayout called
 *   - pending onchain_send row → executionService.settleSendOnChain called
 *   - pending processor_collection row → executionService.settleBuyPayment called
 *   - already-completed row (no pending rows returned) → no settle call made
 *   - one failing row does NOT abort the batch (remaining rows still processed)
 *   - markAttempt is called before settlement, complete after success
 *   - batch is bounded to batchSize
 */

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../../core/config/configuration';
import { SettlementReconciliationService } from './settlement-reconciliation.service';
import type {
  ISettlementOutboxRepository,
  SettlementOutboxRecord,
} from './ports/settlement-outbox.repository.port';
import type { ExecutionService } from './execution.service';

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

function makeRecord(
  overrides: Partial<SettlementOutboxRecord> = {},
): SettlementOutboxRecord {
  return {
    id: 'row-1',
    transactionId: 'txn-1',
    settlementType: 'processor_payout',
    payload: { reference: 'idem-key-1' },
    idempotencyKey: 'idem-key-1',
    status: 'pending',
    processorRef: null,
    attempt: 1,
    lastAttemptAt: null,
    createdAt: new Date(Date.now() - 300_000), // 5 minutes ago
    ...overrides,
  };
}

function buildStubConfigService(
  overrides: {
    gracePeriodSec?: number;
    batchSize?: number;
  } = {},
): ConfigService<AppConfig, true> {
  const cfg = {
    gracePeriodSec: overrides.gracePeriodSec ?? 120,
    batchSize: overrides.batchSize ?? 20,
  };

  return {
    get: jest.fn().mockImplementation((key: string) => {
      // The service reads 'reconciliation' as a sub-config object.
      if (key === 'reconciliation') return cfg;
      return undefined;
    }),
  } as unknown as ConfigService<AppConfig, true>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettlementReconciliationService', () => {
  let outboxRepo: jest.Mocked<ISettlementOutboxRepository>;
  let executionService: jest.Mocked<ExecutionService>;
  let service: SettlementReconciliationService;

  beforeEach(() => {
    // Silence logger output in unit tests.
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    outboxRepo = {
      create: jest.fn(),
      findPending: jest.fn().mockResolvedValue([]),
      markAttempt: jest.fn().mockResolvedValue(undefined),
      complete: jest.fn().mockResolvedValue(undefined),
    };

    executionService = {
      settleSellPayout: jest.fn().mockResolvedValue({
        transactionId: 'txn-1',
        status: 'completed',
      }),
      settleSendOnChain: jest.fn().mockResolvedValue({
        transactionId: 'txn-1',
        status: 'completed',
      }),
      settleBuyPayment: jest.fn().mockResolvedValue({
        transactionId: 'txn-1',
        status: 'completed',
      }),
      // querySendWithdrawalStatus: default pending (safe).
      querySendWithdrawalStatus: jest
        .fn()
        .mockResolvedValue({ status: 'pending' }),
      settleSwap: jest.fn().mockResolvedValue({
        transactionId: 'txn-1',
        status: 'completed',
      }),
      // querySwapStatus: default pending (fail-safe — no provider status query).
      querySwapStatus: jest.fn().mockReturnValue({ status: 'pending' }),
    } as unknown as jest.Mocked<ExecutionService>;

    service = new SettlementReconciliationService(
      outboxRepo,
      executionService,
      buildStubConfigService(),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── No rows ──────────────────────────────────────────────────────────────

  it('does nothing when findPending returns an empty array', async () => {
    outboxRepo.findPending.mockResolvedValue([]);

    await service.tick();

    expect(executionService.settleSellPayout).not.toHaveBeenCalled();
    expect(executionService.settleSendOnChain).not.toHaveBeenCalled();
    expect(executionService.settleBuyPayment).not.toHaveBeenCalled();
    expect(outboxRepo.complete).not.toHaveBeenCalled();
  });

  // ── processor_payout → settleSellPayout ──────────────────────────────────

  it('calls settleSellPayout for a pending processor_payout row', async () => {
    const row = makeRecord({
      settlementType: 'processor_payout',
      payload: { reference: 'ref-sell-1' },
      idempotencyKey: 'ref-sell-1',
    });
    outboxRepo.findPending.mockResolvedValue([row]);

    await service.tick();

    expect(outboxRepo.markAttempt).toHaveBeenCalledWith(row.id);
    expect(executionService.settleSellPayout).toHaveBeenCalledWith({
      reference: 'ref-sell-1',
    });
    expect(outboxRepo.complete).toHaveBeenCalledWith(row.id);
  });

  // ── onchain_send → querySendWithdrawalStatus + settleSendOnChain ──────────

  it('queries provider status when no onChainTxHash in payload', async () => {
    const row = makeRecord({
      settlementType: 'onchain_send',
      payload: { reference: 'ref-send-1' },
      idempotencyKey: 'ref-send-1',
    });
    outboxRepo.findPending.mockResolvedValue([row]);
    executionService.querySendWithdrawalStatus.mockResolvedValue({
      status: 'pending',
    });

    await service.tick();

    expect(outboxRepo.markAttempt).toHaveBeenCalledWith(row.id);
    expect(executionService.querySendWithdrawalStatus).toHaveBeenCalledWith(
      'ref-send-1',
    );
    // Provider pending → no settle call, row stays open.
    expect(executionService.settleSendOnChain).not.toHaveBeenCalled();
    expect(outboxRepo.complete).not.toHaveBeenCalled();
  });

  it('calls settleSendOnChain(success=true) when provider returns success', async () => {
    const row = makeRecord({
      settlementType: 'onchain_send',
      payload: { reference: 'ref-send-2' },
      idempotencyKey: 'ref-send-2',
    });
    outboxRepo.findPending.mockResolvedValue([row]);
    executionService.querySendWithdrawalStatus.mockResolvedValue({
      status: 'success',
      onChainTxHash: 'tron_tx_hash_abc',
    });
    executionService.settleSendOnChain.mockResolvedValue({
      transactionId: 'txn-2',
      status: 'completed',
    });

    await service.tick();

    expect(executionService.querySendWithdrawalStatus).toHaveBeenCalledWith(
      'ref-send-2',
    );
    expect(executionService.settleSendOnChain).toHaveBeenCalledWith({
      reference: 'ref-send-2',
      success: true,
      onChainTxHash: 'tron_tx_hash_abc',
    });
    expect(outboxRepo.complete).toHaveBeenCalledWith(row.id);
  });

  it('calls settleSendOnChain(success=false) when provider returns failed — triggering refund', async () => {
    const row = makeRecord({
      settlementType: 'onchain_send',
      payload: { reference: 'ref-send-3' },
      idempotencyKey: 'ref-send-3',
    });
    outboxRepo.findPending.mockResolvedValue([row]);
    executionService.querySendWithdrawalStatus.mockResolvedValue({
      status: 'failed',
    });
    executionService.settleSendOnChain.mockResolvedValue({
      transactionId: 'txn-3',
      status: 'failed',
    });

    await service.tick();

    expect(executionService.querySendWithdrawalStatus).toHaveBeenCalledWith(
      'ref-send-3',
    );
    expect(executionService.settleSendOnChain).toHaveBeenCalledWith({
      reference: 'ref-send-3',
      success: false,
    });
    expect(outboxRepo.complete).toHaveBeenCalledWith(row.id);
  });

  it('skips settle and does NOT complete row when provider returns pending', async () => {
    const row = makeRecord({
      settlementType: 'onchain_send',
      payload: { reference: 'ref-send-pend' },
      idempotencyKey: 'ref-send-pend',
    });
    outboxRepo.findPending.mockResolvedValue([row]);
    executionService.querySendWithdrawalStatus.mockResolvedValue({
      status: 'pending',
    });

    await service.tick();

    expect(executionService.querySendWithdrawalStatus).toHaveBeenCalledWith(
      'ref-send-pend',
    );
    // No refund or finalize — row stays open for webhook / later tick.
    expect(executionService.settleSendOnChain).not.toHaveBeenCalled();
    expect(outboxRepo.complete).not.toHaveBeenCalled();
  });

  it('calls settleSendOnChain with success=true when payload already contains onChainTxHash (webhook-updated)', async () => {
    const row = makeRecord({
      settlementType: 'onchain_send',
      payload: {
        reference: 'ref-send-hash',
        onChainTxHash: 'tron_tx_hash_abc',
      },
      idempotencyKey: 'ref-send-hash',
    });
    outboxRepo.findPending.mockResolvedValue([row]);
    executionService.settleSendOnChain.mockResolvedValue({
      transactionId: 'txn-hash',
      status: 'completed',
    });

    await service.tick();

    // Hash already in payload → no provider query needed.
    expect(executionService.querySendWithdrawalStatus).not.toHaveBeenCalled();
    expect(executionService.settleSendOnChain).toHaveBeenCalledWith({
      reference: 'ref-send-hash',
      success: true,
      onChainTxHash: 'tron_tx_hash_abc',
    });
    expect(outboxRepo.complete).toHaveBeenCalledWith(row.id);
  });

  // ── processor_collection → settleBuyPayment ───────────────────────────────

  it('calls settleBuyPayment for a pending processor_collection row', async () => {
    const row = makeRecord({
      settlementType: 'processor_collection',
      payload: { reference: 'ref-buy-1' },
      idempotencyKey: 'ref-buy-1',
    });
    outboxRepo.findPending.mockResolvedValue([row]);

    executionService.settleBuyPayment.mockResolvedValue({
      transactionId: 'txn-1',
      status: 'completed',
    });

    await service.tick();

    expect(outboxRepo.markAttempt).toHaveBeenCalledWith(row.id);
    expect(executionService.settleBuyPayment).toHaveBeenCalledWith({
      reference: 'ref-buy-1',
    });
    expect(outboxRepo.complete).toHaveBeenCalledWith(row.id);
  });

  // ── swap → querySwapStatus + settleSwap (#8/#11) ──────────────────────────

  it('handles a pending swap row — markAttempt is called, the row is NOT skipped as unknown', async () => {
    const row = makeRecord({
      settlementType: 'swap',
      payload: { reference: 'ref-swap-1' },
      idempotencyKey: 'ref-swap-1',
    });
    outboxRepo.findPending.mockResolvedValue([row]);

    await service.tick();

    // The swap type must be HANDLED (markAttempt) — not skipped as unknown.
    expect(outboxRepo.markAttempt).toHaveBeenCalledWith(row.id);
    // Fail-safe pending (no confirmed toAmount) → no settle, row stays open.
    expect(executionService.settleSwap).not.toHaveBeenCalled();
    expect(outboxRepo.complete).not.toHaveBeenCalled();
  });

  it('finalizes a swap row when querySwapStatus returns success (webhook-confirmed toAmount/hash in payload)', async () => {
    const row = makeRecord({
      settlementType: 'swap',
      payload: {
        reference: 'ref-swap-2',
        toAmount: '62500',
        hash: 'tron_swap_hash_xyz',
      },
      idempotencyKey: 'ref-swap-2',
    });
    outboxRepo.findPending.mockResolvedValue([row]);
    (executionService.querySwapStatus as unknown as jest.Mock).mockReturnValue({
      status: 'success',
      toAmount: '62500',
      hash: 'tron_swap_hash_xyz',
    });
    executionService.settleSwap.mockResolvedValue({
      transactionId: 'txn-swap-2',
      status: 'completed',
    });

    await service.tick();

    expect(executionService.settleSwap).toHaveBeenCalledWith({
      reference: 'ref-swap-2',
      success: true,
      toAmount: '62500',
      hash: 'tron_swap_hash_xyz',
    });
    expect(outboxRepo.complete).toHaveBeenCalledWith(row.id);
  });

  it('refunds a swap row when querySwapStatus returns failed', async () => {
    const row = makeRecord({
      settlementType: 'swap',
      payload: { reference: 'ref-swap-3' },
      idempotencyKey: 'ref-swap-3',
    });
    outboxRepo.findPending.mockResolvedValue([row]);
    (executionService.querySwapStatus as unknown as jest.Mock).mockReturnValue({
      status: 'failed',
    });
    executionService.settleSwap.mockResolvedValue({
      transactionId: 'txn-swap-3',
      status: 'failed',
    });

    await service.tick();

    expect(executionService.settleSwap).toHaveBeenCalledWith({
      reference: 'ref-swap-3',
      success: false,
    });
    expect(outboxRepo.complete).toHaveBeenCalledWith(row.id);
  });

  // ── Status = pending (not yet terminal) → skip complete ──────────────────

  it('does not call complete when settlement returns pending status', async () => {
    const row = makeRecord({
      settlementType: 'processor_payout',
      payload: { reference: 'ref-pend-1' },
      idempotencyKey: 'ref-pend-1',
    });
    outboxRepo.findPending.mockResolvedValue([row]);

    executionService.settleSellPayout.mockResolvedValue({
      transactionId: 'txn-1',
      status: 'pending',
    });

    await service.tick();

    expect(outboxRepo.markAttempt).toHaveBeenCalledWith(row.id);
    expect(executionService.settleSellPayout).toHaveBeenCalledWith({
      reference: 'ref-pend-1',
    });
    // Row is not completed — webhook may still arrive.
    expect(outboxRepo.complete).not.toHaveBeenCalled();
  });

  // ── One failing row does NOT abort the batch ──────────────────────────────

  it('processes remaining rows when one row throws', async () => {
    const failingRow = makeRecord({
      id: 'row-fail',
      settlementType: 'processor_payout',
      payload: { reference: 'ref-fail' },
      idempotencyKey: 'ref-fail',
    });
    const goodRow = makeRecord({
      id: 'row-good',
      settlementType: 'processor_payout',
      payload: { reference: 'ref-good' },
      idempotencyKey: 'ref-good',
    });
    outboxRepo.findPending.mockResolvedValue([failingRow, goodRow]);

    executionService.settleSellPayout
      .mockRejectedValueOnce(new Error('provider timeout'))
      .mockResolvedValueOnce({ transactionId: 'txn-2', status: 'completed' });

    await service.tick();

    // Both rows had markAttempt called.
    expect(outboxRepo.markAttempt).toHaveBeenCalledWith('row-fail');
    expect(outboxRepo.markAttempt).toHaveBeenCalledWith('row-good');
    // Only the good row reached complete.
    expect(outboxRepo.complete).toHaveBeenCalledTimes(1);
    expect(outboxRepo.complete).toHaveBeenCalledWith('row-good');
  });

  // ── findPending is called with the configured batch size ─────────────────

  it('passes batchSize and gracePeriodSec to findPending', async () => {
    service = new SettlementReconciliationService(
      outboxRepo,
      executionService,
      buildStubConfigService({ gracePeriodSec: 60, batchSize: 5 }),
    );

    await service.tick();

    expect(outboxRepo.findPending).toHaveBeenCalledWith(
      expect.objectContaining({
        olderThanSec: 60,
        limit: 5,
      }),
    );
  });

  // ── Unknown settlement type: log warn + skip ──────────────────────────────

  it('skips a row with an unknown settlementType without throwing', async () => {
    const row = makeRecord({
      settlementType: 'compensation', // not handled by reconciler
    });
    outboxRepo.findPending.mockResolvedValue([row]);

    await service.tick();

    // markAttempt is NOT called for unknown types — we skip them entirely.
    expect(outboxRepo.markAttempt).not.toHaveBeenCalled();
    expect(outboxRepo.complete).not.toHaveBeenCalled();
  });
});
