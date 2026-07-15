import { AdminTxnTriageService } from './admin-txn-triage.service';
import { AdminNotFoundError } from '../domain/admin-errors';
import { TxnNotTriageableError } from '../domain/txn-triage-errors';
import type { ISettlementRepository } from '../../transactions/application/ports/settlement.repository.port';
import type { ITransactionRepository } from '../../transactions/application/ports/transaction.repository.port';
import type { ISettlementOutboxRepository } from '../../transactions/application/ports/settlement-outbox.repository.port';
import type { AuditService } from '../../../core/audit/application/audit.service';
import type {
  IReconciliationReadRepository,
  ReconBreakRecord,
} from './ports/reconciliation-read.repository.port';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const ADMIN_ID = 'admin-uuid-1';

function makeSettlementRepo(): jest.Mocked<ISettlementRepository> {
  // Only the three refund methods + their siblings matter; the rest are present
  // so the mock satisfies the port. Every method is a jest.fn so the spec can
  // assert that the service ONLY ever calls a refund method (never a raw write).
  return {
    settleBuyAtomic: jest.fn(),
    createSellSettlingWithReserveAtomic: jest.fn(),
    findReceiptNumber: jest.fn(),
    postSellReserveAtomic: jest.fn(),
    settleSellFinalizeAtomic: jest.fn(),
    settleSellRefundAtomic: jest.fn().mockResolvedValue(undefined),
    createSendSettlingWithReserveAtomic: jest.fn(),
    settleSendFinalizeAtomic: jest.fn(),
    settleSendRefundAtomic: jest.fn().mockResolvedValue(undefined),
    createSwapSettlingWithReserveAtomic: jest.fn(),
    settleSwapFinalizeAtomic: jest.fn(),
    settleSwapRefundAtomic: jest.fn().mockResolvedValue(undefined),
    settleManualCreditAtomic: jest.fn(),
    settleInternalTransferAtomic: jest.fn(),
  };
}

function makeTxnRepo(): jest.Mocked<ITransactionRepository> {
  return {
    findById: jest.fn(),
    findByIdempotencyKey: jest.fn(),
    create: jest.fn(),
    createSettlingWithProposal: jest.fn(),
    updateStatus: jest.fn(),
    mergeMetadata: jest.fn(),
    listByUserInRange: jest.fn(),
    findByUserId: jest.fn(),
    listAll: jest.fn(),
    listByStatus: jest.fn(),
  };
}

function makeOutboxRepo(): jest.Mocked<ISettlementOutboxRepository> {
  return {
    create: jest.fn(),
    findPending: jest.fn(),
    markAttempt: jest.fn(),
    complete: jest.fn(),
    findByTransactionId: jest.fn(),
    resetToPending: jest.fn().mockResolvedValue(undefined),
  };
}

function makeAudit(): jest.Mocked<AuditService> {
  return {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;
}

function makeReconRepo(): jest.Mocked<IReconciliationReadRepository> {
  return {
    listBreaks: jest.fn(),
    findBreak: jest.fn(),
    findBreaksByTransactionId: jest.fn().mockResolvedValue([]),
    cronStatus: jest.fn(),
  };
}

function makeConfig(): jest.Mocked<Pick<EffectiveConfigService, 'get'>> {
  // The stale window drives the missing-settlement projection; the repo is mocked,
  // so the value is irrelevant to these unit tests — return undefined.
  return { get: jest.fn().mockReturnValue(undefined) };
}

function makeBreak(
  overrides: Partial<ReconBreakRecord> = {},
): ReconBreakRecord {
  return {
    id: 'cmp-1',
    kind: 'missing_settlement',
    transactionId: 'txn-1',
    asset: 'NGN',
    delta: '-185000.00',
    detail: 'The provider settled but the ledger entry has not posted.',
    detectedAt: new Date('2026-06-30T11:30:00.000Z'),
    ...overrides,
  };
}

const NOW = new Date('2026-06-30T12:00:00.000Z');

function makeTxn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'txn-1',
    proposalId: 'prop-1',
    userId: 'user-1',
    type: 'sell',
    status: 'settling',
    idempotencyKey: 'idem-1',
    requestChecksum: 'sum',
    fxRateSnapshot: '1600',
    metadata: {
      asset: 'USDT',
      walletId: 'wallet-1',
      cryptoAmount: '16.000000',
    },
    processorTxRef: null,
    onChainTxHash: null,
    failureReason: null,
    pinVerifiedAt: NOW,
    createdAt: NOW,
    executedAt: NOW,
    completedAt: null,
    failedAt: null,
    ...overrides,
  };
}

describe('AdminTxnTriageService', () => {
  let settlement: jest.Mocked<ISettlementRepository>;
  let txns: jest.Mocked<ITransactionRepository>;
  let outbox: jest.Mocked<ISettlementOutboxRepository>;
  let audit: jest.Mocked<AuditService>;
  let recon: ReturnType<typeof makeReconRepo>;
  let config: ReturnType<typeof makeConfig>;
  let service: AdminTxnTriageService;

  beforeEach(() => {
    settlement = makeSettlementRepo();
    txns = makeTxnRepo();
    outbox = makeOutboxRepo();
    audit = makeAudit();
    recon = makeReconRepo();
    config = makeConfig();
    service = new AdminTxnTriageService(
      settlement,
      txns,
      outbox,
      audit,
      { now: () => NOW },
      recon,
      config as unknown as EffectiveConfigService,
    );
  });

  /** Asserts the service NEVER reached past the injected refund methods into a
   *  raw ledger/transaction write. The mocked settlement repo has no ledger/txn
   *  write methods at all — the only money-moving surface is the refund trio. */
  function expectNoRawWrites() {
    expect(settlement.settleBuyAtomic).not.toHaveBeenCalled();
    expect(settlement.settleSellFinalizeAtomic).not.toHaveBeenCalled();
    expect(settlement.settleSendFinalizeAtomic).not.toHaveBeenCalled();
    expect(settlement.settleSwapFinalizeAtomic).not.toHaveBeenCalled();
    expect(settlement.postSellReserveAtomic).not.toHaveBeenCalled();
    expect(
      settlement.createSellSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
    expect(
      settlement.createSendSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
    expect(
      settlement.createSwapSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
    expect(txns.updateStatus).not.toHaveBeenCalled();
    expect(txns.create).not.toHaveBeenCalled();
  }

  // ── markFailedAndRefund ──────────────────────────────────────────────────────

  describe('markFailedAndRefund', () => {
    it('throws AdminNotFoundError when the transaction does not exist', async () => {
      txns.findById.mockResolvedValue(null);
      await expect(
        service.markFailedAndRefund('missing', 'reason', ADMIN_ID),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(settlement.settleSellRefundAtomic).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('refunds a SETTLING sell via settleSellRefundAtomic with the metadata args + audits', async () => {
      txns.findById.mockResolvedValue(makeTxn());

      const result = await service.markFailedAndRefund(
        'txn-1',
        'payout provider confirmed cancelled',
        ADMIN_ID,
      );

      expect(settlement.settleSellRefundAtomic).toHaveBeenCalledTimes(1);
      expect(settlement.settleSellRefundAtomic).toHaveBeenCalledWith({
        transactionId: 'txn-1',
        userId: 'user-1',
        walletId: 'wallet-1',
        cryptoAmount: '16.000000',
        asset: 'USDT',
        failureReason: 'payout provider confirmed cancelled',
        now: NOW,
      });
      expect(settlement.settleSendRefundAtomic).not.toHaveBeenCalled();
      expect(settlement.settleSwapRefundAtomic).not.toHaveBeenCalled();

      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAdminId: ADMIN_ID,
          subject: 'Transaction:txn-1',
          action: 'admin_override',
          before: { status: 'settling' },
          after: {
            status: 'failed',
            reason: 'payout provider confirmed cancelled',
          },
        }),
      );

      expect(result).toEqual({
        transactionId: 'txn-1',
        status: 'failed',
        refunded: true,
      });
      expectNoRawWrites();
    });

    it('refunds a SETTLING send via settleSendRefundAtomic with the metadata args', async () => {
      txns.findById.mockResolvedValue(
        makeTxn({
          id: 'txn-send',
          type: 'send',
          metadata: {
            asset: 'USDT',
            walletId: 'wallet-9',
            totalDebit: '20.500000',
          },
        }),
      );

      const result = await service.markFailedAndRefund(
        'txn-send',
        'on-chain stuck',
        ADMIN_ID,
      );

      expect(settlement.settleSendRefundAtomic).toHaveBeenCalledWith({
        transactionId: 'txn-send',
        userId: 'user-1',
        walletId: 'wallet-9',
        totalDebit: '20.500000',
        asset: 'USDT',
        failureReason: 'on-chain stuck',
        now: NOW,
      });
      expect(settlement.settleSellRefundAtomic).not.toHaveBeenCalled();
      expect(result.refunded).toBe(true);
      expect(result.status).toBe('failed');
      expectNoRawWrites();
    });

    it('refunds a SETTLING swap via settleSwapRefundAtomic with the metadata args', async () => {
      txns.findById.mockResolvedValue(
        makeTxn({
          id: 'txn-swap',
          type: 'swap',
          metadata: {
            walletId: 'wallet-7',
            fromAmount: '100',
            fromAsset: 'USDT',
            toAsset: 'TRX',
          },
        }),
      );

      const result = await service.markFailedAndRefund(
        'txn-swap',
        'provider failed',
        ADMIN_ID,
      );

      expect(settlement.settleSwapRefundAtomic).toHaveBeenCalledWith({
        transactionId: 'txn-swap',
        userId: 'user-1',
        walletId: 'wallet-7',
        fromAmount: '100',
        fromAsset: 'USDT',
        failureReason: 'provider failed',
        now: NOW,
      });
      expect(result.refunded).toBe(true);
      expectNoRawWrites();
    });

    it('is an idempotent no-op when the transaction is already failed (refund NOT called again)', async () => {
      txns.findById.mockResolvedValue(
        makeTxn({ status: 'failed', failedAt: NOW }),
      );

      const result = await service.markFailedAndRefund(
        'txn-1',
        'reason',
        ADMIN_ID,
      );

      expect(result).toEqual({
        transactionId: 'txn-1',
        status: 'failed',
        refunded: true,
      });
      expect(settlement.settleSellRefundAtomic).not.toHaveBeenCalled();
      expect(settlement.settleSendRefundAtomic).not.toHaveBeenCalled();
      expect(settlement.settleSwapRefundAtomic).not.toHaveBeenCalled();
      // No new refund, no double-credit, and no audit row for a no-op.
      expect(audit.record).not.toHaveBeenCalled();
      expectNoRawWrites();
    });

    it('throws TxnNotTriageableError for a non-settling (e.g. completed) transaction', async () => {
      txns.findById.mockResolvedValue(
        makeTxn({ status: 'completed', completedAt: NOW }),
      );

      await expect(
        service.markFailedAndRefund('txn-1', 'reason', ADMIN_ID),
      ).rejects.toBeInstanceOf(TxnNotTriageableError);
      expect(settlement.settleSellRefundAtomic).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('throws TxnNotTriageableError for a pending transaction (not yet settling)', async () => {
      txns.findById.mockResolvedValue(makeTxn({ status: 'pending' }));
      await expect(
        service.markFailedAndRefund('txn-1', 'reason', ADMIN_ID),
      ).rejects.toBeInstanceOf(TxnNotTriageableError);
      expect(settlement.settleSellRefundAtomic).not.toHaveBeenCalled();
    });

    it('throws TxnNotTriageableError for a buy txn (no user reserve to refund)', async () => {
      txns.findById.mockResolvedValue(makeTxn({ type: 'buy' }));

      await expect(
        service.markFailedAndRefund('txn-1', 'reason', ADMIN_ID),
      ).rejects.toBeInstanceOf(TxnNotTriageableError);
      expect(settlement.settleSellRefundAtomic).not.toHaveBeenCalled();
      expect(settlement.settleSendRefundAtomic).not.toHaveBeenCalled();
      expect(settlement.settleSwapRefundAtomic).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('throws TxnNotTriageableError when sell metadata is missing the asset (corrupt — refuse to refund)', async () => {
      txns.findById.mockResolvedValue(
        makeTxn({
          metadata: { walletId: 'wallet-1', cryptoAmount: '16' },
        }),
      );
      await expect(
        service.markFailedAndRefund('txn-1', 'reason', ADMIN_ID),
      ).rejects.toBeInstanceOf(TxnNotTriageableError);
      expect(settlement.settleSellRefundAtomic).not.toHaveBeenCalled();
    });
  });

  // ── retrySettlement ──────────────────────────────────────────────────────────

  describe('retrySettlement', () => {
    it('throws AdminNotFoundError when the transaction does not exist', async () => {
      txns.findById.mockResolvedValue(null);
      await expect(
        service.retrySettlement('missing', ADMIN_ID),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(outbox.resetToPending).not.toHaveBeenCalled();
    });

    it('resets the outbox to pending and audits a retry_enqueued override', async () => {
      txns.findById.mockResolvedValue(makeTxn());
      outbox.findByTransactionId.mockResolvedValue({
        id: 'outbox-1',
        transactionId: 'txn-1',
        settlementType: 'processor_payout',
        payload: {},
        idempotencyKey: null,
        status: 'failed',
        processorRef: null,
        attempt: 3,
        lastAttemptAt: NOW,
        createdAt: NOW,
      });

      const result = await service.retrySettlement('txn-1', ADMIN_ID);

      expect(outbox.findByTransactionId).toHaveBeenCalledWith('txn-1');
      expect(outbox.resetToPending).toHaveBeenCalledWith('outbox-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAdminId: ADMIN_ID,
          subject: 'Transaction:txn-1',
          action: 'admin_override',
          after: { action: 'retry_enqueued' },
        }),
      );

      expect(result).toEqual({
        transactionId: 'txn-1',
        status: 'settling',
        refunded: false,
      });
      // Retry NEVER moves money and NEVER re-executes settlement inline.
      expect(settlement.settleSellRefundAtomic).not.toHaveBeenCalled();
      expect(settlement.settleSellFinalizeAtomic).not.toHaveBeenCalled();
      expectNoRawWrites();
    });

    it('throws TxnNotTriageableError when there is no outbox row to retry', async () => {
      txns.findById.mockResolvedValue(makeTxn());
      outbox.findByTransactionId.mockResolvedValue(null);

      await expect(
        service.retrySettlement('txn-1', ADMIN_ID),
      ).rejects.toBeInstanceOf(TxnNotTriageableError);
      expect(outbox.resetToPending).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  // ── rerunReconciliation (READ-ONLY per-tx detection) ─────────────────────────────

  describe('rerunReconciliation', () => {
    it('throws AdminNotFoundError when the transaction does not exist', async () => {
      txns.findById.mockResolvedValue(null);

      await expect(
        service.rerunReconciliation('missing', ADMIN_ID),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(recon.findBreaksByTransactionId).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('returns an empty break list for a cleanly-reconciled transaction', async () => {
      txns.findById.mockResolvedValue(makeTxn());
      recon.findBreaksByTransactionId.mockResolvedValue([]);

      const result = await service.rerunReconciliation('txn-1', ADMIN_ID);

      expect(recon.findBreaksByTransactionId).toHaveBeenCalledWith(
        'txn-1',
        expect.any(Number),
      );
      expect(result).toEqual({ items: [] });
      // Detection is read-only — it NEVER moves money or re-drives settlement (§3.1).
      expect(outbox.resetToPending).not.toHaveBeenCalled();
      expectNoRawWrites();
    });

    it('surfaces a detected break in the contract shape (severity derived)', async () => {
      txns.findById.mockResolvedValue(makeTxn());
      recon.findBreaksByTransactionId.mockResolvedValue([
        makeBreak({ kind: 'over_credit', transactionId: 'txn-1' }),
      ]);

      const result = await service.rerunReconciliation('txn-1', ADMIN_ID);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: 'cmp-1',
        kind: 'over_credit',
        // over_credit → high severity (mirrors the read-surface mapping).
        severity: 'high',
        transactionId: 'txn-1',
        asset: 'NGN',
        delta: '-185000.00',
        status: 'open',
      });
      expect(typeof result.items[0].detectedAt).toBe('string');
      expectNoRawWrites();
    });

    it('audits the re-run as an admin_review carrying the break count + optional reason', async () => {
      txns.findById.mockResolvedValue(makeTxn());
      recon.findBreaksByTransactionId.mockResolvedValue([
        makeBreak({ transactionId: 'txn-1' }),
      ]);

      await service.rerunReconciliation(
        'txn-1',
        ADMIN_ID,
        'post-webhook replay',
      );

      expect(audit.record).toHaveBeenCalledTimes(1);
      const arg = audit.record.mock.calls[0][0];
      expect(arg.action).toBe('admin_review');
      expect(arg.subject).toBe('Transaction:txn-1');
      expect(arg.actorAdminId).toBe(ADMIN_ID);
      expect(arg.after).toMatchObject({
        action: 'reconciliation_rerun',
        breakCount: 1,
        reason: 'post-webhook replay',
      });
    });
  });
});
