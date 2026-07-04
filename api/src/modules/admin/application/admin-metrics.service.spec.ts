import { AdminMetricsService } from './admin-metrics.service';
import type {
  IMetricsReadRepository,
  TransactionVolumeResult,
  GmvResult,
  RevenueResult,
  MoneySeriesResult,
  PlatformKpisResult,
  KycFunnelResult,
  ActiveUsersResult,
  ServiceHealthResult,
} from './ports/metrics-read.repository.port';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeVolume(): TransactionVolumeResult {
  return {
    byType: [{ type: 'buy', count: 6, completed: 2, failed: 1, stuck: 3 }],
    series: [{ date: '2026-06-01', count: 3 }],
    stackedSeries: [
      {
        date: '2026-06-01',
        buy: 3,
        sell: 0,
        send: 0,
        swap: 0,
        ticket: 0,
        total: 3,
      },
    ],
    successRate: 0.6667,
  };
}
function makeGmv(): GmvResult {
  return {
    totalByCurrency: [{ currency: 'NGN', amount: '1250000' }],
    txnCount: 2,
  };
}
function makeRevenue(): RevenueResult {
  return {
    totalFeesByCurrency: [{ currency: 'NGN', amount: '150' }],
    totalSpreadByCurrency: [{ currency: 'NGN', amount: '90' }],
    totalProfitByCurrency: [{ currency: 'NGN', amount: '240' }],
    txnCount: 2,
  };
}
function makeMoneySeries(): MoneySeriesResult {
  return {
    buckets: [
      {
        date: '2026-06-01',
        gmv: [{ currency: 'NGN', amount: '50000' }],
        revenue: [{ currency: 'NGN', amount: '150' }],
        profit: [{ currency: 'NGN', amount: '240' }],
      },
    ],
    currencies: ['NGN'],
  };
}
function makePlatformKpis(): PlatformKpisResult {
  return {
    newUsers: { current: 12, previous: 8, growthRate: 0.5 },
    churn: { activePrevious: 10, churned: 3, churnRate: 0.3 },
    failedJobs: 2,
  };
}
function makeFunnel(): KycFunnelResult {
  return {
    byStatus: [{ key: 'verified', count: 5 }],
    byTier: [{ key: 'tier_1', count: 3 }],
  };
}
function makeActive(): ActiveUsersResult {
  return { activeInRange: 4, newInRange: 2, totalUsers: 10 };
}
function makeHealth(): ServiceHealthResult {
  return {
    services: [
      {
        service: 'buy',
        total: 3,
        completed: 2,
        failed: 1,
        successRate: 0.6667,
      },
    ],
  };
}

describe('AdminMetricsService', () => {
  let repo: jest.Mocked<IMetricsReadRepository>;
  let service: AdminMetricsService;

  beforeEach(() => {
    repo = {
      transactionVolume: jest.fn().mockResolvedValue(makeVolume()),
      gmv: jest.fn().mockResolvedValue(makeGmv()),
      revenue: jest.fn().mockResolvedValue(makeRevenue()),
      moneySeries: jest.fn().mockResolvedValue(makeMoneySeries()),
      platformKpis: jest.fn().mockResolvedValue(makePlatformKpis()),
      kycFunnel: jest.fn().mockResolvedValue(makeFunnel()),
      activeUsers: jest.fn().mockResolvedValue(makeActive()),
      serviceHealth: jest.fn().mockResolvedValue(makeHealth()),
    };
    service = new AdminMetricsService(repo);
  });

  describe('range resolution', () => {
    it('defaults to the last 30 days when from/to are omitted', async () => {
      const before = Date.now();
      await service.transactions({});
      const after = Date.now();

      const [from, to] = repo.transactionVolume.mock.calls[0];
      // `to` is ~now.
      expect(to.getTime()).toBeGreaterThanOrEqual(before);
      expect(to.getTime()).toBeLessThanOrEqual(after);
      // `from` is ~30 days before `to`.
      const spanDays = (to.getTime() - from.getTime()) / DAY_MS;
      expect(spanDays).toBeCloseTo(30, 1);
    });

    it('uses explicit from/to when supplied', async () => {
      await service.transactions({ from: '2026-06-01', to: '2026-06-15' });
      const [from, to] = repo.transactionVolume.mock.calls[0];
      expect(from.toISOString().slice(0, 10)).toBe('2026-06-01');
      expect(to.toISOString().slice(0, 10)).toBe('2026-06-15');
    });

    it('clamps the window to 366 days when from is older than that', async () => {
      // from is 2 years before to → must be clamped to to-366d.
      await service.transactions({ from: '2024-01-01', to: '2026-06-30' });
      const [from, to] = repo.transactionVolume.mock.calls[0];
      const spanDays = (to.getTime() - from.getTime()) / DAY_MS;
      expect(spanDays).toBeLessThanOrEqual(366);
      expect(spanDays).toBeCloseTo(366, 1);
    });
  });

  describe('transactions', () => {
    it('maps the volume result to the contract shape', async () => {
      const result = await service.transactions({
        from: '2026-06-01',
        to: '2026-06-30',
      });
      expect(result).toEqual(makeVolume());
    });

    it('surfaces per-type stuck (in-flight) counts alongside failed', async () => {
      const result = await service.transactions({
        from: '2026-06-01',
        to: '2026-06-30',
      });
      const buy = result.byType.find((t) => t.type === 'buy')!;
      // The dashboard "Failed / stuck tx" card reads both — stuck is the sibling
      // of failed, matching the sidebar stuck-badge slice.
      expect(buy.failed).toBe(1);
      expect(buy.stuck).toBe(3);
    });
  });

  describe('gmv', () => {
    it('maps the GMV result to the contract shape', async () => {
      const result = await service.gmv({
        from: '2026-06-01',
        to: '2026-06-30',
      });
      expect(repo.gmv).toHaveBeenCalled();
      expect(result).toEqual(makeGmv());
    });
  });

  describe('moneySeries', () => {
    it('maps the daily money-series result to the contract shape over the resolved range', async () => {
      const result = await service.moneySeries({
        from: '2026-06-01',
        to: '2026-06-30',
      });
      const [from, to] = repo.moneySeries.mock.calls[0];
      expect(from.toISOString().slice(0, 10)).toBe('2026-06-01');
      expect(to.toISOString().slice(0, 10)).toBe('2026-06-30');
      expect(result).toEqual(makeMoneySeries());
    });
  });

  describe('platformKpis', () => {
    it('maps the KPI result over the resolved range', async () => {
      const result = await service.platformKpis({
        from: '2026-06-01',
        to: '2026-06-30',
      });
      const [from, to] = repo.platformKpis.mock.calls[0];
      expect(from.toISOString().slice(0, 10)).toBe('2026-06-01');
      expect(to.toISOString().slice(0, 10)).toBe('2026-06-30');
      expect(result).toEqual(makePlatformKpis());
    });
  });

  describe('filters', () => {
    it('threads currency/capability/tier into the repo as the filter argument', async () => {
      await service.dashboard({
        from: '2026-06-01',
        to: '2026-06-30',
        currency: 'NGN',
        capability: 'buy',
        tier: 'tier_2',
      });
      const [, , filter] = repo.transactionVolume.mock.calls[0];
      expect(filter).toEqual({
        currency: 'NGN',
        capability: 'buy',
        tier: 'tier_2',
      });
      // gmv/revenue/activeUsers/serviceHealth get the same filter object.
      expect(repo.gmv.mock.calls[0][2]).toEqual(filter);
      expect(repo.revenue.mock.calls[0][2]).toEqual(filter);
    });

    it('maps empty-string filters to undefined (treated as no selection)', async () => {
      await service.transactions({
        from: '2026-06-01',
        to: '2026-06-30',
        currency: '',
        capability: '',
        tier: '',
      });
      const [, , filter] = repo.transactionVolume.mock.calls[0];
      expect(filter).toEqual({
        currency: undefined,
        capability: undefined,
        tier: undefined,
      });
    });
  });

  describe('revenue', () => {
    it('maps the revenue result to the contract shape', async () => {
      const result = await service.revenue({
        from: '2026-06-01',
        to: '2026-06-30',
      });
      expect(result).toEqual(makeRevenue());
    });
  });

  describe('kycFunnel', () => {
    it('maps repo {key,count} rows to {status/tier,count} contract rows', async () => {
      const result = await service.kycFunnel();
      expect(repo.kycFunnel).toHaveBeenCalled();
      expect(result).toEqual({
        byStatus: [{ status: 'verified', count: 5 }],
        byTier: [{ tier: 'tier_1', count: 3 }],
      });
    });
  });

  describe('dashboard', () => {
    it('composes every metric block into the dashboard payload', async () => {
      const result = await service.dashboard({
        from: '2026-06-01',
        to: '2026-06-30',
      });
      expect(result).toEqual({
        txnVolume: makeVolume(),
        gmv: makeGmv(),
        revenue: makeRevenue(),
        kycFunnel: {
          byStatus: [{ status: 'verified', count: 5 }],
          byTier: [{ tier: 'tier_1', count: 3 }],
        },
        activeUsers: makeActive(),
        serviceHealth: makeHealth(),
      });
      // All six aggregations were consulted with the same resolved range.
      const [vFrom, vTo] = repo.transactionVolume.mock.calls[0];
      const [gFrom, gTo] = repo.gmv.mock.calls[0];
      const [rFrom, rTo] = repo.revenue.mock.calls[0];
      expect(gFrom.getTime()).toBe(vFrom.getTime());
      expect(gTo.getTime()).toBe(vTo.getTime());
      expect(rFrom.getTime()).toBe(vFrom.getTime());
      expect(rTo.getTime()).toBe(vTo.getTime());
      expect(repo.kycFunnel).toHaveBeenCalled();
      expect(repo.activeUsers).toHaveBeenCalled();
      expect(repo.serviceHealth).toHaveBeenCalled();
    });

    it('carries per-type stuck counts through into txnVolume.byType', async () => {
      const result = await service.dashboard({
        from: '2026-06-01',
        to: '2026-06-30',
      });
      const buy = result.txnVolume.byType.find((t) => t.type === 'buy')!;
      expect(buy.stuck).toBe(3);
      expect(buy.failed).toBe(1);
    });
  });
});
