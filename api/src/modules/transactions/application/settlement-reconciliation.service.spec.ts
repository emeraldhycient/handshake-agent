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

import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
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
): EffectiveConfigService {
  const cfg = {
    gracePeriodSec: overrides.gracePeriodSec ?? 120,
    batchSize: overrides.batchSize ?? 20,
  };

  return {
    get: jest.fn().mockImplementation((key: string) => {
      // The service reads 'reconciliation' as a sub-config object; a DB
      // AppSetting override would change the values returned here.
      if (key === 'reconciliation') return cfg;
      return undefined;
    }),
  } as unknown as EffectiveConfigService;
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

  it('honors a DB AppSetting override of reconciliation.batchSize/gracePeriodSec (EffectiveConfigService flows through)', async () => {
    // Simulate an admin override of the reconciliation knobs; the overridden
    // values must reach findPending via get('reconciliation').
    service = new SettlementReconciliationService(
      outboxRepo,
      executionService,
      buildStubConfigService({ gracePeriodSec: 999, batchSize: 3 }),
    );

    await service.tick();

    expect(outboxRepo.findPending).toHaveBeenCalledWith(
      expect.objectContaining({ olderThanSec: 999, limit: 3 }),
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
