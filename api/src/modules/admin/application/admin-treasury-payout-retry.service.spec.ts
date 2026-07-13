import { AdminTreasuryPayoutRetryService } from './admin-treasury-payout-retry.service';
import { AdminNotFoundError } from '../domain/admin-errors';
import { TxnNotTriageableError } from '../domain/txn-triage-errors';
import { PayoutRetryBlockedError } from '../domain/treasury-operator-errors';
import { KycNotVerifiedError } from '../../identity/domain/gate-errors';
import type { ITreasuryReadRepository } from '../../treasury/application/ports/treasury-read.repository.port';
import type { ITransactionRepository } from '../../transactions/application/ports/transaction.repository.port';
import type { ISettlementOutboxRepository } from '../../transactions/application/ports/settlement-outbox.repository.port';
import type { IComplianceEventRepository } from '../../compliance/application/ports/compliance-event.repository.port';
import type { ComplianceService } from '../../compliance/application/compliance.service';
import type { KycGateService } from '../../identity/application/kyc-gate.service';
import type { AuditService } from '../../../core/audit/application/audit.service';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const ADMIN_ID = 'admin-uuid-1';
const PAYOUT_ID = 'po_1';

function makePayoutItem(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYOUT_ID,
    transactionId: 'txn_1',
    beneficiaryLabel: 'Jane • Access •••1234',
    reference: 'idem_1',
    method: 'bank_transfer',
    asset: 'USDT',
    amount: '6.25',
    fiatAmount: '10000',
    fiatCurrency: 'NGN',
    submittedAt: new Date('2026-07-04T10:00:00.000Z'),
    ...overrides,
  };
}

/** A settling SELL txn (processor_payout). velocityFiatAmount is the gate value. */
function makeSellTxn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'txn_1',
    proposalId: 'prop_1',
    userId: 'user_1',
    type: 'sell',
    status: 'settling',
    idempotencyKey: 'idem_1',
    requestChecksum: 'sum',
    fxRateSnapshot: '1600',
    metadata: {
      asset: 'USDT',
      netFiatAmount: '10000',
      fiatCurrency: 'NGN',
      velocityFiatAmount: '10000',
      velocityFiatCurrency: 'NGN',
      cryptoAmount: '6.25',
      walletId: 'wallet_1',
    },
    processorTxRef: null,
    onChainTxHash: null,
    failureReason: null,
    pinVerifiedAt: new Date(),
    createdAt: new Date(),
    executedAt: new Date(),
    completedAt: null,
    failedAt: null,
    ...overrides,
  };
}

/** A settling SEND txn (onchain_send). Carries toAddress/network for the re-screen. */
function makeSendTxn(overrides: Record<string, unknown> = {}) {
  return {
    ...makeSellTxn(),
    type: 'send',
    metadata: {
      asset: 'USDT',
      velocityFiatAmount: '10000',
      velocityFiatCurrency: 'NGN',
      totalDebit: '6.30',
      walletId: 'wallet_1',
      toAddress: 'TSendDestAddr123456789',
      network: 'TRON',
    },
    ...overrides,
  };
}

function makeOutboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ob_1',
    transactionId: 'txn_1',
    settlementType: 'processor_payout',
    payload: { reference: 'idem_1' },
    idempotencyKey: 'idem_1',
    status: 'in_progress',
    processorRef: 'flw_ref_1',
    attempt: 3,
    lastAttemptAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

function makeTreasury() {
  return {
    findPayoutQueueItem: jest.fn().mockResolvedValue(makePayoutItem()),
  } as unknown as jest.Mocked<ITreasuryReadRepository>;
}

function makeTxns() {
  return {
    findById: jest.fn().mockResolvedValue(makeSellTxn()),
  } as unknown as jest.Mocked<ITransactionRepository>;
}

function makeOutbox() {
  return {
    findByTransactionId: jest.fn().mockResolvedValue(makeOutboxRow()),
    resetToPending: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ISettlementOutboxRepository>;
}

function makeKycGate() {
  return {
    assertCanReleasePayout: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<KycGateService>;
}

function makeComplianceEvents() {
  return {
    listByStatus: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    create: jest.fn().mockResolvedValue({ id: 'ce_1' }),
  } as unknown as jest.Mocked<IComplianceEventRepository>;
}

function makeComplianceService() {
  return {
    screenSendDestination: jest
      .fn()
      .mockResolvedValue({ passed: true, complianceEventId: 'ce_screen' }),
  } as unknown as jest.Mocked<ComplianceService>;
}

function makeAudit() {
  return {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;
}

describe('AdminTreasuryPayoutRetryService', () => {
  let treasury: jest.Mocked<ITreasuryReadRepository>;
  let txns: jest.Mocked<ITransactionRepository>;
  let outbox: jest.Mocked<ISettlementOutboxRepository>;
  let kycGate: jest.Mocked<KycGateService>;
  let complianceEvents: jest.Mocked<IComplianceEventRepository>;
  let complianceService: jest.Mocked<ComplianceService>;
  let audit: jest.Mocked<AuditService>;
  let service: AdminTreasuryPayoutRetryService;

  beforeEach(() => {
    treasury = makeTreasury();
    txns = makeTxns();
    outbox = makeOutbox();
    kycGate = makeKycGate();
    complianceEvents = makeComplianceEvents();
    complianceService = makeComplianceService();
    audit = makeAudit();
    service = new AdminTreasuryPayoutRetryService(
      treasury,
      txns,
      outbox,
      kycGate,
      complianceEvents,
      complianceService,
      audit,
    );
  });

  // ── SELL ─────────────────────────────────────────────────────────────────────

  it('sell happy path: re-checks (no address screen), re-arms, audits, returns retry_enqueued', async () => {
    const res = await service.retryPayout(PAYOUT_ID, 'stuck payout', ADMIN_ID);

    expect(kycGate.assertCanReleasePayout).toHaveBeenCalledWith({
      userId: 'user_1',
      fiatAmount: '10000',
      fiatCurrency: 'NGN',
      asset: 'USDT',
      capability: 'crypto.sell',
    });
    expect(complianceService.screenSendDestination).not.toHaveBeenCalled();
    expect(outbox.resetToPending).toHaveBeenCalledWith('ob_1');
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(complianceEvents.create).not.toHaveBeenCalled();
    expect(res).toEqual({
      payoutId: PAYOUT_ID,
      transactionId: 'txn_1',
      status: 'retry_enqueued',
      reChecked: true,
    });
  });

  it('rejects an already-completed txn (no double-pay): 409, no re-arm, no re-check', async () => {
    txns.findById.mockResolvedValue(makeSellTxn({ status: 'completed' }));
    await expect(
      service.retryPayout(PAYOUT_ID, 'r', ADMIN_ID),
    ).rejects.toBeInstanceOf(TxnNotTriageableError);
    expect(outbox.resetToPending).not.toHaveBeenCalled();
    expect(kycGate.assertCanReleasePayout).not.toHaveBeenCalled();
  });

  it('rejects a terminal-failed (already-refunded) txn: 409, no re-arm', async () => {
    txns.findById.mockResolvedValue(makeSellTxn({ status: 'failed' }));
    await expect(
      service.retryPayout(PAYOUT_ID, 'r', ADMIN_ID),
    ).rejects.toBeInstanceOf(TxnNotTriageableError);
    expect(outbox.resetToPending).not.toHaveBeenCalled();
  });

  it('rejects a non-payout type (buy): 409', async () => {
    txns.findById.mockResolvedValue(makeSellTxn({ type: 'buy' }));
    await expect(
      service.retryPayout(PAYOUT_ID, 'r', ADMIN_ID),
    ).rejects.toBeInstanceOf(TxnNotTriageableError);
    expect(outbox.resetToPending).not.toHaveBeenCalled();
  });

  it('rejects when there is no outbox row: 409', async () => {
    outbox.findByTransactionId.mockResolvedValue(null);
    await expect(
      service.retryPayout(PAYOUT_ID, 'r', ADMIN_ID),
    ).rejects.toBeInstanceOf(TxnNotTriageableError);
    expect(outbox.resetToPending).not.toHaveBeenCalled();
  });

  it('rejects when the outbox settlementType does not match the txn type: 409', async () => {
    // sell txn but an onchain_send outbox row — inconsistent, fail closed.
    outbox.findByTransactionId.mockResolvedValue(
      makeOutboxRow({ settlementType: 'onchain_send' }),
    );
    await expect(
      service.retryPayout(PAYOUT_ID, 'r', ADMIN_ID),
    ).rejects.toBeInstanceOf(TxnNotTriageableError);
    expect(outbox.resetToPending).not.toHaveBeenCalled();
  });

  it('idempotent re-entrancy: two retries both re-arm the SAME row (original key reused)', async () => {
    await service.retryPayout(PAYOUT_ID, 'r', ADMIN_ID);
    await service.retryPayout(PAYOUT_ID, 'r', ADMIN_ID);
    expect(outbox.resetToPending).toHaveBeenNthCalledWith(1, 'ob_1');
    expect(outbox.resetToPending).toHaveBeenNthCalledWith(2, 'ob_1');
  });

  it('re-check failure (KYC): 403 PayoutRetryBlockedError, escalates, no re-arm', async () => {
    kycGate.assertCanReleasePayout.mockRejectedValue(
      new KycNotVerifiedError('status'),
    );
    await expect(
      service.retryPayout(PAYOUT_ID, 'r', ADMIN_ID),
    ).rejects.toBeInstanceOf(PayoutRetryBlockedError);
    expect(complianceEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        transactionId: 'txn_1',
        eventType: 'kyc_escalation',
        status: 'flagged',
      }),
    );
    expect(outbox.resetToPending).not.toHaveBeenCalled();
  });

  it('re-check failure (open compliance block): 403, escalates, no re-arm', async () => {
    complianceEvents.listByStatus.mockResolvedValue({
      items: [{ id: 'ce_open' }],
      nextCursor: null,
    } as never);
    await expect(
      service.retryPayout(PAYOUT_ID, 'r', ADMIN_ID),
    ).rejects.toBeInstanceOf(PayoutRetryBlockedError);
    expect(complianceEvents.create).toHaveBeenCalled();
    expect(outbox.resetToPending).not.toHaveBeenCalled();
  });

  it('unknown payout id: 404', async () => {
    treasury.findPayoutQueueItem.mockResolvedValue(null);
    await expect(
      service.retryPayout('nope', 'r', ADMIN_ID),
    ).rejects.toBeInstanceOf(AdminNotFoundError);
  });

  // ── SEND ─────────────────────────────────────────────────────────────────────

  it('send happy path: re-checks + re-screens the destination address, re-arms, retry_enqueued', async () => {
    txns.findById.mockResolvedValue(makeSendTxn());
    outbox.findByTransactionId.mockResolvedValue(
      makeOutboxRow({ settlementType: 'onchain_send' }),
    );

    const res = await service.retryPayout(PAYOUT_ID, 'stuck send', ADMIN_ID);

    expect(kycGate.assertCanReleasePayout).toHaveBeenCalledWith({
      userId: 'user_1',
      fiatAmount: '10000',
      fiatCurrency: 'NGN',
      asset: 'USDT',
      capability: 'crypto.send',
    });
    expect(complianceService.screenSendDestination).toHaveBeenCalledWith({
      userId: 'user_1',
      address: 'TSendDestAddr123456789',
      network: 'TRON',
      transactionId: 'txn_1',
    });
    expect(outbox.resetToPending).toHaveBeenCalledWith('ob_1');
    expect(res.status).toBe('retry_enqueued');
  });

  it('send with a now-sanctioned destination: 403 PayoutRetryBlockedError, escalates, no re-arm', async () => {
    txns.findById.mockResolvedValue(makeSendTxn());
    outbox.findByTransactionId.mockResolvedValue(
      makeOutboxRow({ settlementType: 'onchain_send' }),
    );
    complianceService.screenSendDestination.mockResolvedValue({
      passed: false,
      reason: 'OFAC match',
      complianceEventId: 'ce_hit',
    });

    await expect(
      service.retryPayout(PAYOUT_ID, 'r', ADMIN_ID),
    ).rejects.toBeInstanceOf(PayoutRetryBlockedError);
    expect(complianceEvents.create).toHaveBeenCalled();
    expect(outbox.resetToPending).not.toHaveBeenCalled();
  });

  it('send rejects when the outbox is not an onchain_send row: 409', async () => {
    txns.findById.mockResolvedValue(makeSendTxn());
    // default outbox row is processor_payout — mismatched for a send.
    await expect(
      service.retryPayout(PAYOUT_ID, 'r', ADMIN_ID),
    ).rejects.toBeInstanceOf(TxnNotTriageableError);
    expect(outbox.resetToPending).not.toHaveBeenCalled();
  });
});
