/**
 * Unit tests for BeneficiaryController (web, JWT-auth).
 *
 * TDD: tests written FIRST. Covers list, banks dropdown, bank-account add (incl.
 * name-enquiry failure → 422), crypto-address add (incl. invalid-address → 422),
 * the record → DTO mapping (Date → ISO, nulls preserved, currency/country), and
 * the R2 step-up-on-add chain (PIN verify + device-bound step-up before persist).
 */

import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { BeneficiaryController } from './beneficiary.controller';
import { BeneficiaryService } from '../application/beneficiary.service';
import { PinService } from '../../../core/auth/pin.service';
import { SessionService } from '../../../core/auth/session.service';
import { PinInvalidError } from '../../../core/auth/domain/pin-errors';
import { StepUpRequiredError } from '../../../core/auth/domain/session-errors';
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
const VALID_PIN = '5731';

const bankRecord: BeneficiaryRecord = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  userId: TEST_USER.userId,
  type: 'bank_account',
  label: 'My GTB',
  accountNumber: '0123456789',
  accountHolderName: 'ADA LOVELACE',
  bankCode: '058',
  payoutCurrency: 'NGN',
  bankCountry: 'NG',
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
  payoutCurrency: null,
  bankCountry: null,
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
  listBanks: jest.fn(),
  addBankAccount: jest.fn(),
  addCryptoAddress: jest.fn(),
  delete: jest.fn(),
};

const mockPinService = {
  verifyPin: jest.fn(),
};

const mockSessionService = {
  findDeviceIdByFingerprint: jest.fn(),
  findPinnedDeviceId: jest.fn(),
  startOrTouch: jest.fn(),
  recordStepUp: jest.fn(),
};

async function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    controllers: [BeneficiaryController],
    providers: [
      { provide: BeneficiaryService, useValue: mockService },
      { provide: PinService, useValue: mockPinService },
      { provide: SessionService, useValue: mockSessionService },
    ],
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
    // Default step-up happy path: PIN ok, device resolves via the pinned device.
    mockPinService.verifyPin.mockResolvedValue(undefined);
    mockSessionService.findDeviceIdByFingerprint.mockResolvedValue(null);
    mockSessionService.findPinnedDeviceId.mockResolvedValue('device-1');
    mockSessionService.startOrTouch.mockResolvedValue(undefined);
    mockSessionService.recordStepUp.mockResolvedValue(undefined);

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
        currency: 'NGN',
        country: 'NG',
        cryptoAddress: null,
        cryptoAsset: null,
        cryptoNetwork: null,
        verificationStatus: 'verified',
        isDefault: true,
        firstUseLockedUntil: null,
        createdAt: CREATED.toISOString(),
      });
    });

    it('maps a crypto record incl. firstUseLockedUntil → ISO and null currency/country', async () => {
      mockService.listForUser.mockResolvedValue([cryptoRecord]);

      const result = await controller.list(
        { type: 'crypto_address' },
        TEST_USER,
      );

      expect(result.beneficiaries[0].firstUseLockedUntil).toBe(
        LOCKED.toISOString(),
      );
      expect(result.beneficiaries[0].cryptoNetwork).toBe('TRON');
      expect(result.beneficiaries[0].currency).toBeNull();
      expect(result.beneficiaries[0].country).toBeNull();
    });
  });

  describe('listBanks', () => {
    it('returns the banks for the requested country', async () => {
      mockService.listBanks.mockResolvedValue([
        { name: 'GTBank', code: '058' },
      ]);

      const result = await controller.listBanks({ country: 'NG' });

      expect(mockService.listBanks).toHaveBeenCalledWith('NG');
      expect(result).toEqual({ banks: [{ name: 'GTBank', code: '058' }] });
    });
  });

  describe('addBankAccount', () => {
    const addBankDto = {
      accountNumber: '0123456789',
      bankCode: '058',
      label: 'My GTB',
      currency: 'NGN',
      pin: VALID_PIN,
    };

    it('verifies PIN + records step-up, then persists and returns the mapped DTO', async () => {
      mockService.addBankAccount.mockResolvedValue(bankRecord);

      const result = await controller.addBankAccount(addBankDto, TEST_USER);

      // R2: PIN verified, device-bound step-up recorded BEFORE the service call.
      expect(mockPinService.verifyPin).toHaveBeenCalledWith(
        TEST_USER.userId,
        VALID_PIN,
      );
      expect(mockSessionService.recordStepUp).toHaveBeenCalledWith(
        TEST_USER.userId,
        'device-1',
        expect.any(Date),
      );
      expect(mockService.addBankAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_USER.userId,
          accountNumber: '0123456789',
          bankCode: '058',
          label: 'My GTB',
          currency: 'NGN',
        }),
      );
      expect(result.accountHolderName).toBe('ADA LOVELACE');
      expect(result.currency).toBe('NGN');
      expect(result.country).toBe('NG');
    });

    it('rejects with 401 and does NOT persist when the PIN is invalid', async () => {
      mockPinService.verifyPin.mockRejectedValue(new PinInvalidError(2));

      await expect(
        controller.addBankAccount(addBankDto, TEST_USER),
      ).rejects.toThrow(PinInvalidError);

      expect(mockService.addBankAccount).not.toHaveBeenCalled();
      expect(mockSessionService.recordStepUp).not.toHaveBeenCalled();
    });

    it('throws STEP_UP_REQUIRED and does NOT persist when no device resolves', async () => {
      mockSessionService.findPinnedDeviceId.mockResolvedValue(null);

      await expect(
        controller.addBankAccount(addBankDto, TEST_USER),
      ).rejects.toThrow(StepUpRequiredError);

      expect(mockService.addBankAccount).not.toHaveBeenCalled();
    });

    it('binds step-up to the client fingerprint when it matches a device', async () => {
      mockSessionService.findDeviceIdByFingerprint.mockResolvedValue(
        'device-fp',
      );
      mockService.addBankAccount.mockResolvedValue(bankRecord);

      await controller.addBankAccount(
        { ...addBankDto, deviceFingerprint: 'fp-abc' },
        TEST_USER,
      );

      expect(mockSessionService.findDeviceIdByFingerprint).toHaveBeenCalledWith(
        TEST_USER.userId,
        'fp-abc',
      );
      expect(mockSessionService.recordStepUp).toHaveBeenCalledWith(
        TEST_USER.userId,
        'device-fp',
        expect.any(Date),
      );
    });

    it('maps NameEnquiryFailedError → 422 (after step-up passed)', async () => {
      mockService.addBankAccount.mockRejectedValue(
        new NameEnquiryFailedError('058', '0123456789'),
      );

      await expect(
        controller.addBankAccount(addBankDto, TEST_USER),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('addCryptoAddress', () => {
    const addCryptoDto = {
      address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
      network: 'TRON' as const,
      asset: 'USDT' as const,
      label: 'Cold wallet',
      pin: VALID_PIN,
    };

    it('verifies PIN + records step-up, then persists and returns the mapped DTO', async () => {
      mockService.addCryptoAddress.mockResolvedValue(cryptoRecord);

      const result = await controller.addCryptoAddress(addCryptoDto, TEST_USER);

      expect(mockPinService.verifyPin).toHaveBeenCalledWith(
        TEST_USER.userId,
        VALID_PIN,
      );
      expect(mockSessionService.recordStepUp).toHaveBeenCalled();
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

    it('rejects with 401 and does NOT persist when the PIN is invalid', async () => {
      mockPinService.verifyPin.mockRejectedValue(new PinInvalidError(1));

      await expect(
        controller.addCryptoAddress(addCryptoDto, TEST_USER),
      ).rejects.toThrow(PinInvalidError);

      expect(mockService.addCryptoAddress).not.toHaveBeenCalled();
    });

    it('maps InvalidAddressError → 422 (after step-up passed)', async () => {
      mockService.addCryptoAddress.mockRejectedValue(
        new InvalidAddressError('TRON', 'bad'),
      );

      await expect(
        controller.addCryptoAddress(
          { ...addCryptoDto, address: 'bad' },
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
