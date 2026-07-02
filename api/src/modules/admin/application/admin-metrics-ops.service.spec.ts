import { AdminMetricsOpsService } from './admin-metrics-ops.service';
import type {
  IMetricsOpsReadRepository,
  SystemHealthResult,
  ActivityEventRow,
} from './ports/metrics-ops-read.repository.port';

function makeHealth(): SystemHealthResult {
  return {
    providers: [
      {
        key: 'blockradar',
        name: 'Blockradar',
        note: 'Custodial WaaS · TRON',
        status: 'ok',
        lastLatencyMs: 120,
      },
      {
        key: 'flutterwave',
        name: 'Flutterwave',
        note: 'NGN rails',
        status: 'degraded',
        lastLatencyMs: null,
      },
    ],
    webhookQueueDepth: 3,
    reconDriftCount: 2,
  };
}

function makeActivity(): ActivityEventRow[] {
  return [
    {
      id: 'tx_1',
      kind: 'settled',
      title: 'Buy settled',
      meta: 'tx_1 · 120.00 USDT',
      at: new Date('2026-07-01T09:00:00.000Z'),
    },
    {
      id: 'audit_1',
      kind: 'config_change',
      title: 'Config change',
      meta: 'crypto.buy.spreadBps',
      at: new Date('2026-07-01T08:30:00.000Z'),
    },
  ];
}

describe('AdminMetricsOpsService', () => {
  let repo: jest.Mocked<IMetricsOpsReadRepository>;
  let service: AdminMetricsOpsService;

  beforeEach(() => {
    repo = {
      systemHealth: jest.fn().mockResolvedValue(makeHealth()),
      activityFeed: jest.fn().mockResolvedValue(makeActivity()),
      openComplianceCount: jest.fn().mockResolvedValue(4),
    };
    service = new AdminMetricsOpsService(repo);
  });

  describe('ops', () => {
    it('composes system health, the activity feed, and the open-compliance count', async () => {
      const result = await service.ops();

      expect(result.systemHealth).toEqual(makeHealth());
      expect(result.compliance).toEqual({ openCases: 4 });
      // Activity Date `at` is serialized to an ISO string for the contract.
      expect(result.activityFeed).toEqual([
        {
          id: 'tx_1',
          kind: 'settled',
          title: 'Buy settled',
          meta: 'tx_1 · 120.00 USDT',
          at: '2026-07-01T09:00:00.000Z',
        },
        {
          id: 'audit_1',
          kind: 'config_change',
          title: 'Config change',
          meta: 'crypto.buy.spreadBps',
          at: '2026-07-01T08:30:00.000Z',
        },
      ]);
    });

    it('requests a bounded activity-feed window', async () => {
      await service.ops();
      const [limit] = repo.activityFeed.mock.calls[0];
      expect(limit).toBeGreaterThan(0);
      expect(limit).toBeLessThanOrEqual(50);
    });

    it('consults all three read paths', async () => {
      await service.ops();
      expect(repo.systemHealth).toHaveBeenCalledTimes(1);
      expect(repo.activityFeed).toHaveBeenCalledTimes(1);
      expect(repo.openComplianceCount).toHaveBeenCalledTimes(1);
    });
  });
});
