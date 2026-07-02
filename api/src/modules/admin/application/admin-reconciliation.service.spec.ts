import { AdminReconciliationService } from './admin-reconciliation.service';
import type {
  IReconciliationReadRepository,
  ReconBreakRecord,
} from './ports/reconciliation-read.repository.port';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';

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
    service = new AdminReconciliationService(
      repo,
      config as unknown as EffectiveConfigService,
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
});
