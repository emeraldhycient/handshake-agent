import { AdminReconciliationService } from './admin-reconciliation.service';
import { AdminNotFoundError } from '../domain/admin-errors';
import type {
  IReconciliationReadRepository,
  ReconBreakRecord,
} from './ports/reconciliation-read.repository.port';
import type {
  IReconciliationRepository,
  ReconBreakRecord as PersistedBreakRecord,
  ReconRunRecord,
} from '../../transactions/application/ports/reconciliation.repository.port';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';

function makeRunRecord(
  overrides: Partial<ReconRunRecord> = {},
): ReconRunRecord {
  return {
    id: 'run-1',
    runType: 'settlement_outbox',
    status: 'completed',
    totalChecked: 3,
    breaksDetected: 1,
    startedAt: new Date('2026-07-04T04:00:00.000Z'),
    completedAt: new Date('2026-07-04T04:00:03.000Z'),
    createdAt: new Date('2026-07-04T04:00:00.000Z'),
    ...overrides,
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

function makeRunsRepo(): jest.Mocked<IReconciliationRepository> {
  return {
    createRun: jest.fn(),
    recordBreak: jest.fn(),
    completeRun: jest.fn(),
    listRuns: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    findRun: jest.fn().mockResolvedValue(null),
    listBreaksByRun: jest.fn().mockResolvedValue([]),
    findBreak: jest.fn().mockResolvedValue(null),
    findBreaksByUser: jest.fn(),
    updateBreakStatus: jest.fn(),
  };
}

function makeBreaks(): ReconBreakRecord[] {
  return [
    {
      id: 'comp_1',
      kind: 'over_credit',
      transactionId: 'tx_9f2a41c7',
      asset: 'USDT',
      delta: '+50.00',
      detail: 'Ledger credited more than the provider confirmed.',
      detectedAt: new Date('2026-07-01T04:00:00.000Z'),
    },
    {
      id: 'outbox_2',
      kind: 'missing_settlement',
      transactionId: 'tx_3b81e0d4',
      asset: 'NGN',
      delta: '-185000.00',
      detail: 'Provider settled; the matching ledger entry has not posted.',
      detectedAt: new Date('2026-07-01T03:14:00.000Z'),
    },
    {
      id: 'comp_3',
      kind: 'duplicate_credit',
      transactionId: 'tx_a5518f62',
      asset: 'USDT',
      delta: '+120.00',
      detail: 'Two credits posted for a single on-chain deposit.',
      detectedAt: new Date('2026-07-01T02:00:00.000Z'),
    },
    {
      id: 'comp_4',
      kind: 'amount_mismatch',
      transactionId: 'tx_7c04aa19',
      asset: 'USDT',
      delta: '+0.10',
      detail: 'Provider payout amount differs from the ledger debit.',
      detectedAt: new Date('2026-07-01T01:00:00.000Z'),
    },
  ];
}

describe('AdminReconciliationService', () => {
  let repo: jest.Mocked<IReconciliationReadRepository>;
  let config: jest.Mocked<Pick<EffectiveConfigService, 'get'>>;
  let runs: jest.Mocked<IReconciliationRepository>;
  let service: AdminReconciliationService;

  beforeEach(() => {
    repo = {
      listBreaks: jest.fn().mockResolvedValue(makeBreaks()),
      findBreak: jest.fn().mockResolvedValue(null),
      findBreaksByTransactionId: jest.fn().mockResolvedValue([]),
      cronStatus: jest.fn().mockResolvedValue({
        lastRunAt: new Date('2026-07-01T04:00:00.000Z'),
        nextRunAt: new Date('2026-07-01T04:02:00.000Z'),
      }),
    };
    config = {
      get: jest.fn().mockReturnValue({ gracePeriodSec: 300, batchSize: 20 }),
    };
    runs = makeRunsRepo();
    service = new AdminReconciliationService(
      repo,
      config as unknown as EffectiveConfigService,
      runs,
    );
  });

  describe('listBreaks', () => {
    it('projects each break record with a derived severity + open status', async () => {
      const { items } = await service.listBreaks();

      expect(items).toHaveLength(4);
      expect(items[0]).toEqual({
        id: 'comp_1',
        kind: 'over_credit',
        severity: 'high',
        transactionId: 'tx_9f2a41c7',
        asset: 'USDT',
        delta: '+50.00',
        detail: 'Ledger credited more than the provider confirmed.',
        status: 'open',
        detectedAt: '2026-07-01T04:00:00.000Z',
      });
    });

    it('maps over/duplicate credits to high and mismatch/missing to medium severity', async () => {
      const { items } = await service.listBreaks();
      const severityByKind = Object.fromEntries(
        items.map((b) => [b.kind, b.severity]),
      );

      expect(severityByKind.over_credit).toBe('high');
      expect(severityByKind.duplicate_credit).toBe('high');
      expect(severityByKind.amount_mismatch).toBe('medium');
      expect(severityByKind.missing_settlement).toBe('medium');
    });

    it('passes the configured grace window as the stale-after threshold', async () => {
      await service.listBreaks();
      expect(repo.listBreaks).toHaveBeenCalledWith(300);
    });

    it('falls back to a default stale window when the config is absent', async () => {
      config.get.mockReturnValue(undefined);
      await service.listBreaks();
      expect(repo.listBreaks).toHaveBeenCalledWith(120);
    });

    it('returns an empty list when there are no breaks', async () => {
      repo.listBreaks.mockResolvedValue([]);
      const { items } = await service.listBreaks();
      expect(items).toEqual([]);
    });
  });

  describe('status', () => {
    it('reports the reconciler enabled with an ISO last/next run + tick interval', async () => {
      const status = await service.status();

      expect(status.enabled).toBe(true);
      expect(status.lastRunAt).toBe('2026-07-01T04:00:00.000Z');
      expect(status.nextRunAt).toBe('2026-07-01T04:02:00.000Z');
      expect(status.intervalSeconds).toBe(120);
    });

    it('derives the open-break count from the same break projection', async () => {
      const status = await service.status();
      expect(status.openBreakCount).toBe(4);
    });

    it('allows a null last/next run (reconciler has never run)', async () => {
      repo.cronStatus.mockResolvedValue({ lastRunAt: null, nextRunAt: null });
      const status = await service.status();
      expect(status.lastRunAt).toBeNull();
      expect(status.nextRunAt).toBeNull();
    });

    it('asks the repo to project the next run at the tick cadence', async () => {
      await service.status();
      expect(repo.cronStatus).toHaveBeenCalledWith(120);
    });
  });

  describe('listRuns (durable history)', () => {
    it('maps run records to ISO-dated contract shapes with the page cursor', async () => {
      runs.listRuns.mockResolvedValue({
        items: [makeRunRecord()],
        nextCursor: 'run-1',
      });

      const page = await service.listRuns({ limit: 10 });

      expect(runs.listRuns).toHaveBeenCalledWith({
        cursor: undefined,
        limit: 10,
      });
      expect(page.nextCursor).toBe('run-1');
      expect(page.items[0]).toEqual({
        id: 'run-1',
        runType: 'settlement_outbox',
        status: 'completed',
        totalChecked: 3,
        breaksDetected: 1,
        startedAt: '2026-07-04T04:00:00.000Z',
        completedAt: '2026-07-04T04:00:03.000Z',
        createdAt: '2026-07-04T04:00:00.000Z',
      });
    });

    it('defaults the page size when omitted and caps an oversized request', async () => {
      await service.listRuns({});
      expect(runs.listRuns).toHaveBeenCalledWith({
        cursor: undefined,
        limit: 20,
      });

      await service.listRuns({ limit: 5000, cursor: 'abc' });
      expect(runs.listRuns).toHaveBeenLastCalledWith({
        cursor: 'abc',
        limit: 100,
      });
    });
  });

  describe('getRun (run + breaks)', () => {
    it('returns the run with its breaks', async () => {
      runs.findRun.mockResolvedValue(makeRunRecord());
      runs.listBreaksByRun.mockResolvedValue([makePersistedBreak()]);

      const detail = await service.getRun('run-1');

      expect(detail.run.id).toBe('run-1');
      expect(detail.breaks).toHaveLength(1);
      expect(detail.breaks[0].breakType).toBe('over_credit');
      expect(detail.breaks[0].delta).toBe('-50');
    });

    it('fails closed on an unknown run id', async () => {
      runs.findRun.mockResolvedValue(null);
      await expect(service.getRun('nope')).rejects.toBeInstanceOf(
        AdminNotFoundError,
      );
    });
  });

  describe('getBreak (break detail)', () => {
    it('returns a single persisted break', async () => {
      runs.findBreak.mockResolvedValue(
        makePersistedBreak({ status: 'resolved' }),
      );
      const brk = await service.getBreak('brk-1');
      expect(brk.id).toBe('brk-1');
      expect(brk.status).toBe('resolved');
    });

    it('fails closed on an unknown break id', async () => {
      runs.findBreak.mockResolvedValue(null);
      await expect(service.getBreak('nope')).rejects.toBeInstanceOf(
        AdminNotFoundError,
      );
    });
  });
});
