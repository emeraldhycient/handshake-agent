import { AdminNotFoundError } from '../domain/admin-errors';
import { AdminTreasuryService } from './admin-treasury.service';
import type {
  AuditService,
  RecordAuditInput,
} from '../../../core/audit/application/audit.service';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type {
  ITreasuryReadRepository,
  TreasuryAlertRecord,
  TreasuryBalanceRecord,
  TreasuryExposureRecord,
  TreasuryFiatFloatRecord,
  TreasuryFxPositionRecord,
  TreasuryPayoutQueueRecord,
  TreasurySweepFeed,
  WithdrawalPolicyRecord,
} from '../../treasury/application/ports/treasury-read.repository.port';

const ALERT_ID = '11111111-1111-1111-1111-111111111111';
const EXPOSURE_ID = '22222222-2222-2222-2222-222222222222';
const WALLET_ID = '33333333-3333-3333-3333-333333333333';
const POLICY_ID = '44444444-4444-4444-4444-444444444444';
const ADMIN_ID = '99999999-9999-9999-9999-999999999999';
const OUTBOX_ID = '55555555-5555-5555-5555-555555555555';
const TXN_ID = '66666666-6666-6666-6666-666666666666';

function makeBalance(
  over?: Partial<TreasuryBalanceRecord>,
): TreasuryBalanceRecord {
  return {
    network: 'TRON',
    asset: 'USDT',
    totalAmount: '12345.678901',
    walletCount: 7,
    ...over,
  };
}

function makeExposure(
  over?: Partial<TreasuryExposureRecord>,
): TreasuryExposureRecord {
  return {
    id: EXPOSURE_ID,
    asset: 'USDT',
    fiatCurrency: 'NGN',
    cryptoHeld: '1000',
    fiatEquivalent: '1600000.00',
    netExposure: '1600000.00',
    exposureLimitBps: 500,
    status: 'warning',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

function makeAlert(over?: Partial<TreasuryAlertRecord>): TreasuryAlertRecord {
  return {
    id: ALERT_ID,
    asset: 'USDT',
    severity: 'critical',
    message: 'Exposure breached the critical threshold',
    netExposure: '1600000.00',
    triggeredAt: new Date('2026-01-01T00:00:00.000Z'),
    acknowledgedAt: null,
    ...over,
  };
}

function makePolicy(
  over?: Partial<WithdrawalPolicyRecord>,
): WithdrawalPolicyRecord {
  return {
    id: POLICY_ID,
    walletId: WALLET_ID,
    maxWithdrawalPerTx: null,
    maxWithdrawalPerDay: '5000',
    requiresApproval: true,
    allowListMode: 'allow_list_only',
    enabledAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

function makeSweepFeed(over?: Partial<TreasurySweepFeed>): TreasurySweepFeed {
  return {
    rows: [
      {
        id: WALLET_ID,
        address: 'TXchildAddr00000000000000000000001',
        network: 'TRON',
        asset: 'TRX',
        balance: '18.400000',
        status: 'below_threshold',
        lastSweptAt: null,
      },
    ],
    sweepThreshold: '25',
    thresholdAsset: 'TRX',
    ...over,
  };
}

function makePayout(
  over?: Partial<TreasuryPayoutQueueRecord>,
): TreasuryPayoutQueueRecord {
  return {
    id: OUTBOX_ID,
    transactionId: TXN_ID,
    beneficiaryLabel: 'Kelechi Chukwu · GTBank',
    reference: 'wd_44219',
    method: 'NGN payout · Flutterwave',
    asset: 'NGN',
    amount: '4820000.00',
    fiatAmount: null,
    requiresApproval: true,
    submittedAt: new Date('2026-06-30T00:00:00.000Z'),
    ...over,
  };
}

function makeFloat(
  over?: Partial<TreasuryFiatFloatRecord>,
): TreasuryFiatFloatRecord {
  return { currency: 'NGN', balance: '42180500.00', ...over };
}

function makeFxRecord(
  over?: Partial<TreasuryFxPositionRecord>,
): TreasuryFxPositionRecord {
  return {
    asset: 'USDT',
    fiatCurrency: 'NGN',
    netPositionFiat: '13200000.00',
    netExposure: '13200000.00',
    fiatEquivalent: '13200000.00',
    exposureLimitBps: 500,
    status: 'safe',
    ...over,
  };
}

describe('AdminTreasuryService', () => {
  let repo: jest.Mocked<ITreasuryReadRepository>;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let config: { get: jest.Mock };
  let configValues: Record<string, unknown>;
  let auditCalls: RecordAuditInput[];
  let service: AdminTreasuryService;

  beforeEach(() => {
    repo = {
      aggregateBalances: jest.fn(),
      listExposures: jest.fn(),
      listAlerts: jest.fn(),
      acknowledgeAlert: jest.fn(),
      listWithdrawalPolicies: jest.fn(),
      listSweeps: jest.fn(),
      listPayoutQueue: jest.fn(),
      findPayoutQueueItem: jest.fn(),
      listFiatFloat: jest.fn(),
      listFxPositions: jest.fn(),
    };
    auditCalls = [];
    audit = {
      record: jest.fn((input: RecordAuditInput) => {
        auditCalls.push(input);
        return Promise.resolve();
      }),
    };
    // Config defaults: NGN target float 234,000,000; low-float floor 2500 bps.
    configValues = {
      'treasury.fiatFloatTargets': { NGN: 234000000 },
      'treasury.lowFloatThresholdBps': 2500,
    };
    config = {
      get: jest.fn((key: string) => configValues[key]),
    };
    service = new AdminTreasuryService(
      repo,
      audit as unknown as AuditService,
      config as unknown as EffectiveConfigService,
    );
  });

  describe('getBalances', () => {
    it('wraps aggregated rows in { balances } (amount stays a string)', async () => {
      repo.aggregateBalances.mockResolvedValue([makeBalance()]);
      const res = await service.getBalances();
      expect(res.balances).toEqual([
        {
          network: 'TRON',
          asset: 'USDT',
          totalAmount: '12345.678901',
          walletCount: 7,
        },
      ]);
    });
  });

  describe('listExposures', () => {
    it('maps records into { items } and serializes createdAt to ISO', async () => {
      repo.listExposures.mockResolvedValue([makeExposure()]);
      const res = await service.listExposures();
      expect(res.items[0]).toEqual({
        id: EXPOSURE_ID,
        asset: 'USDT',
        fiatCurrency: 'NGN',
        cryptoHeld: '1000',
        fiatEquivalent: '1600000.00',
        netExposure: '1600000.00',
        exposureLimitBps: 500,
        status: 'warning',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });
  });

  describe('listAlerts', () => {
    it('maps records into { items } with a nullable acknowledgedAt and forwards the filter', async () => {
      repo.listAlerts.mockResolvedValue([makeAlert()]);
      const res = await service.listAlerts({ acknowledged: false });
      expect(repo.listAlerts).toHaveBeenCalledWith({ acknowledged: false });
      expect(res.items[0]).toEqual({
        id: ALERT_ID,
        asset: 'USDT',
        severity: 'critical',
        message: 'Exposure breached the critical threshold',
        netExposure: '1600000.00',
        triggeredAt: '2026-01-01T00:00:00.000Z',
        acknowledgedAt: null,
      });
    });

    it('serializes an acknowledged alert timestamp', async () => {
      repo.listAlerts.mockResolvedValue([
        makeAlert({ acknowledgedAt: new Date('2026-01-02T00:00:00.000Z') }),
      ]);
      const res = await service.listAlerts({});
      expect(res.items[0].acknowledgedAt).toBe('2026-01-02T00:00:00.000Z');
    });
  });

  describe('acknowledgeAlert', () => {
    it('throws AdminNotFoundError when the alert is missing', async () => {
      repo.listAlerts.mockResolvedValue([]);
      await expect(
        service.acknowledgeAlert(ALERT_ID, ADMIN_ID, 'reviewed'),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(repo.acknowledgeAlert).not.toHaveBeenCalled();
    });

    it('acknowledges the alert and records an admin_override audit', async () => {
      repo.listAlerts
        .mockResolvedValueOnce([makeAlert({ acknowledgedAt: null })])
        .mockResolvedValueOnce([
          makeAlert({ acknowledgedAt: new Date('2026-01-03T00:00:00.000Z') }),
        ]);

      const res = await service.acknowledgeAlert(
        ALERT_ID,
        ADMIN_ID,
        'reviewed',
      );

      expect(repo.acknowledgeAlert).toHaveBeenCalledWith(
        ALERT_ID,
        ADMIN_ID,
        'reviewed',
        expect.any(Date),
      );
      expect(res.acknowledgedAt).toBe('2026-01-03T00:00:00.000Z');
      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0]).toMatchObject({
        actorAdminId: ADMIN_ID,
        subject: `TreasuryAlert:${ALERT_ID}`,
        action: 'admin_override',
      });
    });
  });

  describe('listWithdrawalPolicies', () => {
    it('maps records into { items } (nullable caps + ISO enabledAt)', async () => {
      repo.listWithdrawalPolicies.mockResolvedValue([makePolicy()]);
      const res = await service.listWithdrawalPolicies();
      expect(res.items[0]).toEqual({
        id: POLICY_ID,
        walletId: WALLET_ID,
        maxWithdrawalPerTx: null,
        maxWithdrawalPerDay: '5000',
        requiresApproval: true,
        allowListMode: 'allow_list_only',
        enabledAt: '2026-01-01T00:00:00.000Z',
      });
    });
  });

  describe('listSweeps', () => {
    it('maps rows into { items } + carries the threshold, ISO-serializing lastSweptAt', async () => {
      repo.listSweeps.mockResolvedValue(
        makeSweepFeed({
          rows: [
            {
              id: WALLET_ID,
              address: 'TXchildAddr00000000000000000000001',
              network: 'TRON',
              asset: 'TRX',
              balance: '30.000000',
              status: 'swept',
              lastSweptAt: new Date('2026-06-30T00:00:00.000Z'),
            },
          ],
        }),
      );
      const res = await service.listSweeps();
      expect(res.sweepThreshold).toBe('25');
      expect(res.thresholdAsset).toBe('TRX');
      expect(res.items[0]).toEqual({
        id: WALLET_ID,
        address: 'TXchildAddr00000000000000000000001',
        network: 'TRON',
        asset: 'TRX',
        balance: '30.000000',
        status: 'swept',
        lastSweptAt: '2026-06-30T00:00:00.000Z',
      });
    });

    it('keeps a never-swept address lastSweptAt null', async () => {
      repo.listSweeps.mockResolvedValue(makeSweepFeed());
      const res = await service.listSweeps();
      expect(res.items[0].lastSweptAt).toBeNull();
    });
  });

  describe('listPayoutQueue', () => {
    it('maps pending payouts into { items }, ISO-serializing submittedAt', async () => {
      repo.listPayoutQueue.mockResolvedValue([makePayout()]);
      const res = await service.listPayoutQueue();
      expect(res.items[0]).toEqual({
        id: OUTBOX_ID,
        transactionId: TXN_ID,
        beneficiaryLabel: 'Kelechi Chukwu · GTBank',
        reference: 'wd_44219',
        method: 'NGN payout · Flutterwave',
        asset: 'NGN',
        amount: '4820000.00',
        fiatAmount: null,
        requiresApproval: true,
        submittedAt: '2026-06-30T00:00:00.000Z',
      });
    });
  });

  describe('listFiatFloat', () => {
    it('derives utilizationBps + a healthy/low status against the configured target', async () => {
      // balance 42,180,500 / target 234,000,000 = 0.18026 → 1803 bps < 2500 → low.
      repo.listFiatFloat.mockResolvedValue([makeFloat()]);
      const res = await service.listFiatFloat();
      expect(res.items[0]).toEqual({
        currency: 'NGN',
        balance: '42180500.00',
        targetFloat: '234000000',
        utilizationBps: 1803,
        status: 'low',
        lowFloatThresholdBps: 2500,
      });
    });

    it('marks a well-funded float healthy', async () => {
      // 200,000,000 / 234,000,000 = 0.8547 → 8547 bps ≥ 2500 → healthy.
      repo.listFiatFloat.mockResolvedValue([
        makeFloat({ balance: '200000000.00' }),
      ]);
      const res = await service.listFiatFloat();
      expect(res.items[0].status).toBe('healthy');
      expect(res.items[0].utilizationBps).toBe(8547);
    });

    it('reports 0 utilization + a "—" target when no target is configured', async () => {
      configValues = {};
      config.get.mockImplementation((key: string) => configValues[key]);
      repo.listFiatFloat.mockResolvedValue([makeFloat()]);
      const res = await service.listFiatFloat();
      expect(res.items[0].targetFloat).toBe('0');
      expect(res.items[0].utilizationBps).toBe(0);
      // Zero target → cannot be under-target → healthy (no divide-by-zero).
      expect(res.items[0].status).toBe('healthy');
    });
  });

  describe('listFxPositions', () => {
    it('derives direction (long) + clamped headroom from the exposure fields', async () => {
      // netExposure 13,200,000 / fiatEquivalent... limit 500 bps → headroom:
      // exposure ratio = net/fiatEquivalent = 1.0 (10000 bps); limit 500 bps →
      // over-limit → headroom clamped to 0. Positive net → long.
      repo.listFxPositions.mockResolvedValue([makeFxRecord()]);
      const res = await service.listFxPositions();
      expect(res.items[0].direction).toBe('long');
      expect(res.items[0].headroomBps).toBe(0);
      expect(res.items[0].exposureStatus).toBe('safe');
      expect(res.items[0].netPositionFiat).toBe('13200000.00');
    });

    it('reports headroom when exposure is within the limit', async () => {
      // net 100 / fiatEquivalent 10000 = 0.01 (100 bps) vs limit 500 bps →
      // headroom = (500 - 100)/500 = 8000 bps.
      repo.listFxPositions.mockResolvedValue([
        makeFxRecord({
          netExposure: '100',
          netPositionFiat: '100',
          fiatEquivalent: '10000',
          exposureLimitBps: 500,
        }),
      ]);
      const res = await service.listFxPositions();
      expect(res.items[0].headroomBps).toBe(8000);
    });

    it('maps a negative net position to short and zero to flat', async () => {
      repo.listFxPositions.mockResolvedValue([
        makeFxRecord({ netPositionFiat: '-5000' }),
        makeFxRecord({ asset: 'BTC', netPositionFiat: '0' }),
      ]);
      const res = await service.listFxPositions();
      expect(res.items[0].direction).toBe('short');
      expect(res.items[1].direction).toBe('flat');
    });
  });
});
