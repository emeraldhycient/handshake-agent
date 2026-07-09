import { AdminNotFoundError } from '../domain/admin-errors';
import { AdminBeneficiaryService } from './admin-beneficiary.service';
import type {
  AuditService,
  RecordAuditInput,
} from '../../../core/audit/application/audit.service';
import type {
  IBeneficiaryRepository,
  BeneficiaryRecord,
} from '../../beneficiaries/application/ports/beneficiary.repository.port';

const BEN_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ID = '99999999-9999-9999-9999-999999999999';
const REASON = 'Fraudulent payout destination reported by the user.';

// A fixed "now" so coolingOffActive is deterministic regardless of wall-clock.
const NOW = new Date('2026-06-30T12:00:00.000Z');
const FUTURE = new Date('2026-07-01T12:00:00.000Z');
const PAST = new Date('2026-06-29T12:00:00.000Z');

function makeBeneficiary(over?: Partial<BeneficiaryRecord>): BeneficiaryRecord {
  return {
    id: BEN_ID,
    userId: USER_ID,
    type: 'crypto_address',
    label: 'Cold wallet',
    accountNumber: null,
    accountHolderName: null,
    bankCode: null,
    payoutCurrency: null,
    bankCountry: null,
    cryptoAddress: 'TXyz',
    cryptoAsset: 'USDT',
    cryptoNetwork: 'TRON',
    verificationStatus: 'pending',
    firstUseLockedUntil: FUTURE,
    verifiedAt: null,
    isDefault: true,
    createdAt: new Date('2026-06-28T00:00:00.000Z'),
    updatedAt: new Date('2026-06-28T00:00:00.000Z'),
    deletedAt: null,
    ...over,
  };
}

describe('AdminBeneficiaryService', () => {
  let repo: jest.Mocked<
    Pick<
      IBeneficiaryRepository,
      'listAll' | 'findById' | 'clearCoolingOff' | 'softDelete'
    >
  >;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let auditCalls: RecordAuditInput[];
  let service: AdminBeneficiaryService;

  beforeEach(() => {
    repo = {
      listAll: jest.fn(),
      findById: jest.fn(),
      clearCoolingOff: jest.fn(),
      softDelete: jest.fn(),
    };
    auditCalls = [];
    audit = {
      record: jest.fn((input: RecordAuditInput) => {
        auditCalls.push(input);
        return Promise.resolve();
      }),
    };
    service = new AdminBeneficiaryService(
      repo as unknown as IBeneficiaryRepository,
      audit as unknown as AuditService,
    );
  });

  describe('list', () => {
    it('maps a future-locked beneficiary with coolingOffActive=true', async () => {
      repo.listAll.mockResolvedValue([
        makeBeneficiary({ firstUseLockedUntil: FUTURE }),
      ]);
      const res = await service.list({ now: NOW });
      expect(res.items[0]).toEqual({
        id: BEN_ID,
        userId: USER_ID,
        type: 'crypto_address',
        label: 'Cold wallet',
        verificationStatus: 'pending',
        firstUseLockedUntil: FUTURE.toISOString(),
        coolingOffActive: true,
        createdAt: '2026-06-28T00:00:00.000Z',
      });
    });

    it('marks a past lock as coolingOffActive=false', async () => {
      repo.listAll.mockResolvedValue([
        makeBeneficiary({ firstUseLockedUntil: PAST }),
      ]);
      const res = await service.list({ now: NOW });
      expect(res.items[0].coolingOffActive).toBe(false);
    });

    it('marks a null lock (bank account) as coolingOffActive=false', async () => {
      repo.listAll.mockResolvedValue([
        makeBeneficiary({
          type: 'bank_account',
          firstUseLockedUntil: null,
        }),
      ]);
      const res = await service.list({ now: NOW });
      expect(res.items[0].firstUseLockedUntil).toBeNull();
      expect(res.items[0].coolingOffActive).toBe(false);
    });

    it('forwards a default limit to the repository', async () => {
      repo.listAll.mockResolvedValue([]);
      await service.list();
      const [page] = repo.listAll.mock.calls[0];
      expect(page.limit).toBeGreaterThan(0);
    });
  });

  describe('overrideCoolingOff', () => {
    it('throws AdminNotFoundError when the beneficiary is missing', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.overrideCoolingOff(BEN_ID, ADMIN_ID),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(repo.clearCoolingOff).not.toHaveBeenCalled();
    });

    it('clears the lock and records an admin_override audit (subject Beneficiary:<id>)', async () => {
      repo.findById.mockResolvedValue(
        makeBeneficiary({ firstUseLockedUntil: FUTURE }),
      );

      await service.overrideCoolingOff(BEN_ID, ADMIN_ID);

      expect(repo.clearCoolingOff).toHaveBeenCalledWith(BEN_ID);
      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0]).toMatchObject({
        actorAdminId: ADMIN_ID,
        subject: `Beneficiary:${BEN_ID}`,
        action: 'admin_override',
      });
    });
  });

  describe('remove', () => {
    it('throws AdminNotFoundError when the beneficiary is missing', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.remove(BEN_ID, REASON, ADMIN_ID),
      ).rejects.toBeInstanceOf(AdminNotFoundError);

      expect(repo.softDelete).not.toHaveBeenCalled();
      expect(auditCalls).toHaveLength(0);
    });

    it('soft-deletes via the OWNER-scoped path (resolves userId server-side) and never moves money', async () => {
      repo.findById.mockResolvedValue(makeBeneficiary());
      repo.softDelete.mockResolvedValue(true);

      await service.remove(BEN_ID, REASON, ADMIN_ID);

      // userId is resolved from the record (server-side), never trusted from the client.
      expect(repo.softDelete).toHaveBeenCalledWith(USER_ID, BEN_ID);
    });

    it('records a beneficiary_remove audit (subject Beneficiary:<id>) carrying the reason', async () => {
      repo.findById.mockResolvedValue(makeBeneficiary());
      repo.softDelete.mockResolvedValue(true);

      await service.remove(BEN_ID, REASON, ADMIN_ID);

      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0]).toMatchObject({
        actorAdminId: ADMIN_ID,
        subject: `Beneficiary:${BEN_ID}`,
        action: 'beneficiary_remove',
        after: { deleted: true, reason: REASON },
      });
    });

    it('does not audit when the row was already soft-deleted (idempotent no-op)', async () => {
      repo.findById.mockResolvedValue(makeBeneficiary());
      // findById excludes soft-deleted rows, but guard against a race: if the
      // owner-scoped softDelete finds no active row, treat it as not-found.
      repo.softDelete.mockResolvedValue(false);

      await expect(
        service.remove(BEN_ID, REASON, ADMIN_ID),
      ).rejects.toBeInstanceOf(AdminNotFoundError);

      expect(auditCalls).toHaveLength(0);
    });
  });
});
