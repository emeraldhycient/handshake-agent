import { AdminReconciliationActionService } from './admin-reconciliation-action.service';
import { AdminNotFoundError } from '../domain/admin-errors';
import type {
  IReconciliationReadRepository,
  ReconBreakRecord,
} from './ports/reconciliation-read.repository.port';
import type { AdminTxnTriageService } from './admin-txn-triage.service';
import type { AuditService } from '../../../core/audit/application/audit.service';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type {
  ComplianceEventRecord,
  IComplianceEventRepository,
} from '../../compliance/application/ports/compliance-event.repository.port';
import type {
  ITransactionRepository,
  TransactionRecord,
} from '../../transactions/application/ports/transaction.repository.port';
import type {
  IReconciliationRepository,
  ReconBreakRecord as PersistedBreakRecord,
} from '../../transactions/application/ports/reconciliation.repository.port';

const ADMIN_ID = 'admin-uuid-1';

function makeRunsRepo(): jest.Mocked<IReconciliationRepository> {
  return {
    createRun: jest.fn(),
    recordBreak: jest.fn(),
    completeRun: jest.fn(),
    listRuns: jest.fn(),
    findRun: jest.fn(),
    listBreaksByRun: jest.fn(),
    findBreak: jest.fn().mockResolvedValue(null),
    findBreaksByUser: jest.fn(),
    updateBreakStatus: jest.fn(),
  };
}

function makePersistedBreak(
  overrides: Partial<PersistedBreakRecord> = {},
): PersistedBreakRecord {
  return {
    id: 'brk-1',
    reconRunId: 'run-1',
    breakType: 'over_credit',
    userId: 'user-1',
    walletId: 'wallet-1',
    outboxId: null,
    currency: 'USDT',
    delta: '-50',
    status: 'detected',
    approvedByAdminId: null,
    reason: null,
    actionAt: null,
    createdAt: new Date('2026-07-04T04:00:00.000Z'),
    updatedAt: new Date('2026-07-04T04:00:00.000Z'),
    ...overrides,
  };
}

function makeConfig(): jest.Mocked<Pick<EffectiveConfigService, 'get'>> {
  // The stale window drives the missing-settlement projection; the value itself
  // is irrelevant to these unit tests (the repo is mocked), so return undefined.
  return { get: jest.fn().mockReturnValue(undefined) };
}

function makeReconRepo(): jest.Mocked<IReconciliationReadRepository> {
  return {
    listBreaks: jest.fn(),
    cronStatus: jest.fn(),
    findBreak: jest.fn(),
    findBreaksByTransactionId: jest.fn(),
  };
}

function makeTriage(): jest.Mocked<
  Pick<AdminTxnTriageService, 'retrySettlement'>
> {
  return {
    retrySettlement: jest.fn().mockResolvedValue({
      transactionId: 'txn-1',
      status: 'settling',
      refunded: false,
    }),
  };
}

function makeAudit(): jest.Mocked<AuditService> {
  return {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;
}

function makeComplianceEventRepo(): jest.Mocked<IComplianceEventRepository> {
  return {
    create: jest.fn(),
    listByStatus: jest.fn(),
    findById: jest.fn(),
    findLatestOpenByUserAndType: jest.fn(),
    updateDisposition: jest.fn(),
  };
}

function makeTxnRepo(): jest.Mocked<Pick<ITransactionRepository, 'findById'>> {
  return { findById: jest.fn() };
}

function makeTxn(
  overrides: Partial<TransactionRecord> = {},
): TransactionRecord {
  return {
    id: 'txn-1',
    proposalId: null,
    userId: 'user-77',
    type: 'send',
    status: 'settling',
    idempotencyKey: 'idem-1',
    requestChecksum: 'sum',
    fxRateSnapshot: null,
    metadata: {},
    processorTxRef: null,
    onChainTxHash: null,
    failureReason: null,
    pinVerifiedAt: null,
    createdAt: new Date('2026-06-30T11:00:00.000Z'),
    executedAt: null,
    completedAt: null,
    failedAt: null,
    ...overrides,
  };
}

function makeEventRecord(
  overrides: Partial<ComplianceEventRecord> = {},
): ComplianceEventRecord {
  return {
    id: 'evt-1',
    userId: 'user-77',
    transactionId: 'txn-1',
    eventType: 'unusual_pattern',
    severity: 'high',
    screeningProvider: 'reconciliation',
    ruleOrHit: 'recon_break:over_credit',
    details: {},
    status: 'flagged',
    dispositionComment: null,
    dispositionAt: null,
    createdAt: new Date('2026-06-30T12:05:00.000Z'),
    ...overrides,
  };
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
    detectedAt: new Date('2026-06-30T12:00:00.000Z'),
    ...overrides,
  };
}

describe('AdminReconciliationActionService', () => {
  let repo: ReturnType<typeof makeReconRepo>;
  let triage: ReturnType<typeof makeTriage>;
  let audit: ReturnType<typeof makeAudit>;
  let config: ReturnType<typeof makeConfig>;
  let events: ReturnType<typeof makeComplianceEventRepo>;
  let txns: ReturnType<typeof makeTxnRepo>;
  let runs: jest.Mocked<IReconciliationRepository>;
  let service: AdminReconciliationActionService;

  beforeEach(() => {
    repo = makeReconRepo();
    triage = makeTriage();
    audit = makeAudit();
    config = makeConfig();
    events = makeComplianceEventRepo();
    txns = makeTxnRepo();
    runs = makeRunsRepo();
    service = new AdminReconciliationActionService(
      repo,
      triage as unknown as AdminTxnTriageService,
      audit,
      config as unknown as EffectiveConfigService,
      events,
      txns as unknown as ITransactionRepository,
      runs,
    );
  });

  describe('resolve', () => {
    it('re-drives settlement via the engine (retry), never a raw debit', async () => {
      repo.findBreak.mockResolvedValue(makeBreak());

      const result = await service.resolve(
        'cmp-1',
        'Webhook replayed.',
        ADMIN_ID,
      );

      // Engine-brokered: it re-enqueues the offending txn's settlement — the
      // transactionId comes from the SERVER's break lookup, never the client.
      expect(triage.retrySettlement).toHaveBeenCalledWith('txn-1', ADMIN_ID);
      expect(result).toEqual({
        breakId: 'cmp-1',
        disposition: 'resolved',
        moved: false,
      });
    });

    it('audits the resolve as an admin override', async () => {
      repo.findBreak.mockResolvedValue(makeBreak());

      await service.resolve('cmp-1', 'why', ADMIN_ID);

      expect(audit.record).toHaveBeenCalledTimes(1);
      const arg = audit.record.mock.calls[0][0];
      expect(arg.action).toBe('admin_override');
      expect(arg.subject).toBe('ReconBreak:cmp-1');
      expect(arg.actorAdminId).toBe(ADMIN_ID);
    });

    it('rejects an unknown break id (fail-closed, no engine call)', async () => {
      repo.findBreak.mockResolvedValue(null);

      await expect(
        service.resolve('nope', 'why', ADMIN_ID),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(triage.retrySettlement).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('accept', () => {
    it('records a no-debit disposition — never calls the engine', async () => {
      repo.findBreak.mockResolvedValue(makeBreak({ kind: 'amount_mismatch' }));

      const result = await service.accept(
        'cmp-1',
        'Sub-cent rounding drift within tolerance.',
        ADMIN_ID,
      );

      expect(triage.retrySettlement).not.toHaveBeenCalled();
      expect(result).toEqual({
        breakId: 'cmp-1',
        disposition: 'accepted',
        moved: false,
      });
    });

    it('audits the accept as an admin override with the reason', async () => {
      repo.findBreak.mockResolvedValue(makeBreak());

      await service.accept('cmp-1', 'tolerated', ADMIN_ID);

      const arg = audit.record.mock.calls[0][0];
      expect(arg.action).toBe('admin_override');
      expect(arg.subject).toBe('ReconBreak:cmp-1');
      expect(arg.after).toMatchObject({ disposition: 'accepted' });
    });

    it('rejects an unknown break id (fail-closed)', async () => {
      repo.findBreak.mockResolvedValue(null);

      await expect(
        service.accept('nope', 'why', ADMIN_ID),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('escalate', () => {
    it('opens a compliance case from the break and moves no money', async () => {
      repo.findBreak.mockResolvedValue(
        makeBreak({ kind: 'over_credit', transactionId: 'txn-1' }),
      );
      txns.findById.mockResolvedValue(
        makeTxn({ id: 'txn-1', userId: 'user-77' }),
      );
      events.create.mockResolvedValue(makeEventRecord());

      const result = await service.escalate(
        'cmp-1',
        'Persistent over-credit; escalating to compliance.',
        ADMIN_ID,
      );

      // The engine is NEVER called from an escalation — it moves no money (§3.1).
      expect(triage.retrySettlement).not.toHaveBeenCalled();

      // userId is derived SERVER-SIDE from the break's transaction, never trusted.
      expect(txns.findById).toHaveBeenCalledWith('txn-1');
      expect(events.create).toHaveBeenCalledTimes(1);
      const input = events.create.mock.calls[0][0];
      expect(input.userId).toBe('user-77');
      expect(input.transactionId).toBe('txn-1');
      expect(input.eventType).toBe('unusual_pattern');
      // over_credit is high-severity (mirrors the read severity mapping).
      expect(input.severity).toBe('high');
      expect(input.screeningProvider).toBe('reconciliation');
      expect(input.ruleOrHit).toBe('recon_break:over_credit');
      expect(input.status).toBe('flagged');
      expect(input.details).toMatchObject({
        breakId: 'cmp-1',
        kind: 'over_credit',
        delta: '-185000.00',
        asset: 'NGN',
        reason: 'Persistent over-credit; escalating to compliance.',
      });

      // The response echoes the created compliance event (ComplianceEventItem shape).
      expect(result).toMatchObject({
        id: 'evt-1',
        userId: 'user-77',
        transactionId: 'txn-1',
        eventType: 'unusual_pattern',
        severity: 'high',
        status: 'flagged',
        screeningProvider: 'reconciliation',
        ruleOrHit: 'recon_break:over_credit',
      });
      expect(typeof result.createdAt).toBe('string');
    });

    it('maps a medium-severity break kind to medium compliance severity', async () => {
      repo.findBreak.mockResolvedValue(
        makeBreak({ kind: 'amount_mismatch', transactionId: 'txn-2' }),
      );
      txns.findById.mockResolvedValue(
        makeTxn({ id: 'txn-2', userId: 'user-9' }),
      );
      events.create.mockResolvedValue(
        makeEventRecord({
          userId: 'user-9',
          transactionId: 'txn-2',
          severity: 'medium',
          ruleOrHit: 'recon_break:amount_mismatch',
        }),
      );

      await service.escalate('cmp-1', 'Investigate the drift.', ADMIN_ID);

      const input = events.create.mock.calls[0][0];
      expect(input.severity).toBe('medium');
      expect(input.ruleOrHit).toBe('recon_break:amount_mismatch');
    });

    it('audits the escalation as an admin_review with the reason', async () => {
      repo.findBreak.mockResolvedValue(makeBreak());
      txns.findById.mockResolvedValue(makeTxn());
      events.create.mockResolvedValue(makeEventRecord());

      await service.escalate('cmp-1', 'compliance please', ADMIN_ID);

      expect(audit.record).toHaveBeenCalledTimes(1);
      const arg = audit.record.mock.calls[0][0];
      expect(arg.action).toBe('admin_review');
      expect(arg.subject).toBe('ReconBreak:cmp-1');
      expect(arg.actorAdminId).toBe(ADMIN_ID);
      expect(arg.after).toMatchObject({
        disposition: 'escalated',
        complianceEventId: 'evt-1',
        reason: 'compliance please',
      });
    });

    it('rejects an unknown break id (fail-closed, no case created)', async () => {
      repo.findBreak.mockResolvedValue(null);

      await expect(
        service.escalate('nope', 'why here', ADMIN_ID),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(txns.findById).not.toHaveBeenCalled();
      expect(events.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('fails closed when the break references a missing transaction', async () => {
      repo.findBreak.mockResolvedValue(makeBreak({ transactionId: 'gone' }));
      txns.findById.mockResolvedValue(null);

      await expect(
        service.escalate('cmp-1', 'why here', ADMIN_ID),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(events.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  // ── persisted-break lifecycle (Go-readiness #3) ─────────────────────────────────

  describe('acknowledgeBreak', () => {
    it('transitions the break to acknowledged (annotation-only) + audits admin_review', async () => {
      runs.findBreak.mockResolvedValue(
        makePersistedBreak({ status: 'detected' }),
      );
      runs.updateBreakStatus.mockResolvedValue(
        makePersistedBreak({
          status: 'acknowledged',
          approvedByAdminId: ADMIN_ID,
          reason: 'Investigating.',
          actionAt: new Date('2026-07-04T05:00:00.000Z'),
        }),
      );

      const result = await service.acknowledgeBreak(
        'brk-1',
        'Investigating.',
        ADMIN_ID,
      );

      // Engine is never touched — annotation only, no money moves.
      expect(triage.retrySettlement).not.toHaveBeenCalled();
      expect(runs.updateBreakStatus).toHaveBeenCalledWith(
        'brk-1',
        expect.objectContaining({
          status: 'acknowledged',
          approvedByAdminId: ADMIN_ID,
          reason: 'Investigating.',
        }),
      );
      expect(result.status).toBe('acknowledged');
      expect(result.approvedByAdminId).toBe(ADMIN_ID);

      const arg = audit.record.mock.calls[0][0];
      expect(arg.action).toBe('admin_review');
      expect(arg.subject).toBe('ReconBreak:brk-1');
      expect(arg.before).toEqual({ status: 'detected' });
      expect(arg.after).toMatchObject({ status: 'acknowledged' });
    });

    it('fails closed on an unknown break id (no write, no audit)', async () => {
      runs.findBreak.mockResolvedValue(null);
      await expect(
        service.acknowledgeBreak('nope', 'why', ADMIN_ID),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(runs.updateBreakStatus).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('resolveBreak', () => {
    it('transitions the break to resolved (annotation-only) + audits admin_review', async () => {
      runs.findBreak.mockResolvedValue(
        makePersistedBreak({ status: 'acknowledged' }),
      );
      runs.updateBreakStatus.mockResolvedValue(
        makePersistedBreak({ status: 'resolved', approvedByAdminId: ADMIN_ID }),
      );

      const result = await service.resolveBreak(
        'brk-1',
        'Confirmed.',
        ADMIN_ID,
      );

      expect(triage.retrySettlement).not.toHaveBeenCalled();
      expect(runs.updateBreakStatus).toHaveBeenCalledWith(
        'brk-1',
        expect.objectContaining({ status: 'resolved' }),
      );
      expect(result.status).toBe('resolved');
      const arg = audit.record.mock.calls[0][0];
      expect(arg.action).toBe('admin_review');
      expect(arg.after).toMatchObject({ status: 'resolved' });
    });

    it('fails closed on an unknown break id', async () => {
      runs.findBreak.mockResolvedValue(null);
      await expect(
        service.resolveBreak('nope', 'why', ADMIN_ID),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(runs.updateBreakStatus).not.toHaveBeenCalled();
    });
  });
});
