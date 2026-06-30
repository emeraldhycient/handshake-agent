import { AdminNotFoundError } from '../domain/admin-errors';
import { AdminTreasuryService } from './admin-treasury.service';
import type {
  AuditService,
  RecordAuditInput,
} from '../../../core/audit/application/audit.service';
import type {
  ITreasuryReadRepository,
  TreasuryAlertRecord,
  TreasuryBalanceRecord,
  TreasuryExposureRecord,
  WithdrawalPolicyRecord,
} from '../../treasury/application/ports/treasury-read.repository.port';

const ALERT_ID = '11111111-1111-1111-1111-111111111111';
const EXPOSURE_ID = '22222222-2222-2222-2222-222222222222';
const WALLET_ID = '33333333-3333-3333-3333-333333333333';
const POLICY_ID = '44444444-4444-4444-4444-444444444444';
const ADMIN_ID = '99999999-9999-9999-9999-999999999999';

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

describe('AdminTreasuryService', () => {
  let repo: jest.Mocked<ITreasuryReadRepository>;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let auditCalls: RecordAuditInput[];
  let service: AdminTreasuryService;

  beforeEach(() => {
    repo = {
      aggregateBalances: jest.fn(),
      listExposures: jest.fn(),
      listAlerts: jest.fn(),
      acknowledgeAlert: jest.fn(),
      listWithdrawalPolicies: jest.fn(),
    };
    auditCalls = [];
    audit = {
      record: jest.fn((input: RecordAuditInput) => {
        auditCalls.push(input);
        return Promise.resolve();
      }),
    };
    service = new AdminTreasuryService(repo, audit as unknown as AuditService);
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
});
