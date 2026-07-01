import { AdminReconciliationActionService } from './admin-reconciliation-action.service';
import { AdminNotFoundError } from '../domain/admin-errors';
import type {
  IReconciliationReadRepository,
  ReconBreakRecord,
} from './ports/reconciliation-read.repository.port';
import type { AdminTxnTriageService } from './admin-txn-triage.service';
import type { AuditService } from '../../../core/audit/application/audit.service';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';

const ADMIN_ID = 'admin-uuid-1';

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
  let service: AdminReconciliationActionService;

  beforeEach(() => {
    repo = makeReconRepo();
    triage = makeTriage();
    audit = makeAudit();
    config = makeConfig();
    service = new AdminReconciliationActionService(
      repo,
      triage as unknown as AdminTxnTriageService,
      audit,
      config as unknown as EffectiveConfigService,
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
});
