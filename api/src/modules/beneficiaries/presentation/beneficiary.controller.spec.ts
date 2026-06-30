/**
 * Unit tests for BeneficiaryController (web, JWT-auth).
 *
 * TDD: tests written FIRST. Covers list, bank-account add (incl. name-enquiry
 * failure → 422), crypto-address add (incl. invalid-address → 422), and the
 * record → DTO mapping (Date → ISO, nulls preserved).
 */

import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { BeneficiaryController } from './beneficiary.controller';
import { BeneficiaryService } from '../application/beneficiary.service';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import {
  NameEnquiryFailedError,
  InvalidAddressError,
  BeneficiaryNotFoundError,
} from '../domain/beneficiary-errors';
import type { BeneficiaryRecord } from '../application/ports/beneficiary.repository.port';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_USER = {
  userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  sessionId: 'sess-uuid',
  deviceId: null,
};

const CREATED = new Date('2026-06-29T12:00:00.000Z');
const LOCKED = new Date('2026-06-30T12:00:00.000Z');

const bankRecord: BeneficiaryRecord = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  userId: TEST_USER.userId,
  type: 'bank_account',
  label: 'My GTB',
  accountNumber: '0123456789',
  accountHolderName: 'ADA LOVELACE',
  bankCode: '058',
  cryptoAddress: null,
  cryptoAsset: null,
  cryptoNetwork: null,
  verificationStatus: 'verified',
  firstUseLockedUntil: null,
  verifiedAt: CREATED,
  isDefault: true,
  createdAt: CREATED,
  updatedAt: CREATED,
  deletedAt: null,
};

const cryptoRecord: BeneficiaryRecord = {
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  userId: TEST_USER.userId,
  type: 'crypto_address',
  label: 'Cold wallet',
  accountNumber: null,
  accountHolderName: null,
  bankCode: null,
  cryptoAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
  cryptoAsset: 'USDT',
  cryptoNetwork: 'TRON',
  verificationStatus: 'verified',
  firstUseLockedUntil: LOCKED,
  verifiedAt: null,
  isDefault: false,
  createdAt: CREATED,
  updatedAt: CREATED,
  deletedAt: null,
};

const mockService = {
  listForUser: jest.fn(),
  addBankAccount: jest.fn(),
  addCryptoAddress: jest.fn(),
  delete: jest.fn(),
};

async function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    controllers: [BeneficiaryController],
    providers: [{ provide: BeneficiaryService, useValue: mockService }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({ canActivate: () => true })
    .compile();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BeneficiaryController', () => {
  let controller: BeneficiaryController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await buildModule();
    controller = module.get(BeneficiaryController);
  });

  describe('list', () => {
    it('lists beneficiaries of the requested type for the current user', async () => {
      mockService.listForUser.mockResolvedValue([bankRecord]);

      const result = await controller.list({ type: 'bank_account' }, TEST_USER);

      expect(mockService.listForUser).toHaveBeenCalledWith(
        TEST_USER.userId,
        'bank_account',
      );
      expect(result.beneficiaries).toHaveLength(1);
      expect(result.beneficiaries[0]).toEqual({
        id: bankRecord.id,
        type: 'bank_account',
        label: 'My GTB',
        accountNumber: '0123456789',
        accountHolderName: 'ADA LOVELACE',
        bankCode: '058',
        cryptoAddress: null,
        cryptoAsset: null,
        cryptoNetwork: null,
        verificationStatus: 'verified',
        isDefault: true,
        firstUseLockedUntil: null,
        createdAt: CREATED.toISOString(),
      });
    });

    it('maps a crypto record incl. firstUseLockedUntil → ISO', async () => {
      mockService.listForUser.mockResolvedValue([cryptoRecord]);

      const result = await controller.list(
        { type: 'crypto_address' },
        TEST_USER,
      );

      expect(result.beneficiaries[0].firstUseLockedUntil).toBe(
        LOCKED.toISOString(),
      );
      expect(result.beneficiaries[0].cryptoNetwork).toBe('TRON');
    });
  });

  describe('addBankAccount', () => {
    it('persists a bank account and returns the mapped DTO', async () => {
      mockService.addBankAccount.mockResolvedValue(bankRecord);

      const result = await controller.addBankAccount(
        { accountNumber: '0123456789', bankCode: '058', label: 'My GTB' },
        TEST_USER,
      );

      expect(mockService.addBankAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_USER.userId,
          accountNumber: '0123456789',
          bankCode: '058',
          label: 'My GTB',
        }),
      );
      expect(result.accountHolderName).toBe('ADA LOVELACE');
    });

    it('maps NameEnquiryFailedError → 422', async () => {
      mockService.addBankAccount.mockRejectedValue(
        new NameEnquiryFailedError('058', '0123456789'),
      );

      await expect(
        controller.addBankAccount(
          { accountNumber: '0123456789', bankCode: '058', label: 'My GTB' },
          TEST_USER,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('addCryptoAddress', () => {
    it('persists a crypto address and returns the mapped DTO', async () => {
      mockService.addCryptoAddress.mockResolvedValue(cryptoRecord);

      const result = await controller.addCryptoAddress(
        {
          address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
          network: 'TRON',
          asset: 'USDT',
          label: 'Cold wallet',
        },
        TEST_USER,
      );

      expect(mockService.addCryptoAddress).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_USER.userId,
          address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
          network: 'TRON',
          asset: 'USDT',
          label: 'Cold wallet',
        }),
      );
      expect(result.cryptoAddress).toBe('TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE');
    });

    it('maps InvalidAddressError → 422', async () => {
      mockService.addCryptoAddress.mockRejectedValue(
        new InvalidAddressError('TRON', 'bad'),
      );

      await expect(
        controller.addCryptoAddress(
          { address: 'bad', network: 'TRON', asset: 'USDT', label: 'x' },
          TEST_USER,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('remove (DELETE /:id)', () => {
    it('soft-deletes the beneficiary for the current user and acks', async () => {
      mockService.delete.mockResolvedValue({
        id: bankRecord.id,
        deleted: true,
      });

      const result = await controller.remove(bankRecord.id, TEST_USER);

      expect(mockService.delete).toHaveBeenCalledWith(
        TEST_USER.userId,
        bankRecord.id,
      );
      expect(result).toEqual({ id: bankRecord.id, deleted: true });
    });

    it('maps BeneficiaryNotFoundError → 404', async () => {
      mockService.delete.mockRejectedValue(
        new BeneficiaryNotFoundError('missing-id'),
      );

      await expect(controller.remove('missing-id', TEST_USER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
