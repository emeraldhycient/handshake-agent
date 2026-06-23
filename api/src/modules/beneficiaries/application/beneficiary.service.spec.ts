/**
 * TDD — beneficiary.service.spec.ts (S3)
 *
 * Unit tests for BeneficiaryService. All dependencies are mocked:
 *   - IBeneficiaryRepository (mock object)
 *   - AssetRegistry (mock object — validateAddress is a pure boolean fn)
 *   - ConfigService (stub returning undefined for the optional cooling-off key)
 *
 * Tests cover:
 *   - addBankAccount persists via the repo and returns the record
 *   - addCryptoAddress validates address (invalid → InvalidAddressError)
 *   - addCryptoAddress sets firstUseLockedUntil on valid address
 *   - listForUser returns active records from the repo
 *   - getDefault returns the default from the repo
 *   - requireById returns the record; throws BeneficiaryNotFoundError when absent
 */

import { ConfigService } from '@nestjs/config';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import {
  InvalidAddressError,
  BeneficiaryNotFoundError,
} from '../domain/beneficiary-errors';
import type {
  IBeneficiaryRepository,
  BeneficiaryRecord,
} from './ports/beneficiary.repository.port';
import { BeneficiaryService } from './beneficiary.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(
  overrides: Partial<BeneficiaryRecord> = {},
): BeneficiaryRecord {
  return {
    id: 'ben-id-1',
    userId: 'user-id-1',
    type: 'bank_account',
    label: 'GTB Savings',
    accountNumber: '0123456789',
    accountHolderName: 'John Doe',
    bankCode: '058',
    cryptoAddress: null,
    cryptoAsset: null,
    cryptoNetwork: null,
    verificationStatus: 'pending',
    firstUseLockedUntil: null,
    verifiedAt: null,
    isDefault: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeCryptoRecord(
  overrides: Partial<BeneficiaryRecord> = {},
): BeneficiaryRecord {
  return makeRecord({
    id: 'ben-id-2',
    type: 'crypto_address',
    label: 'My TRON wallet',
    accountNumber: null,
    accountHolderName: null,
    bankCode: null,
    cryptoAddress: 'TQn9Y2khDD3VHKZ2GRdmKXD8bNkRuaBP2p',
    cryptoAsset: 'USDT',
    cryptoNetwork: 'TRON',
    firstUseLockedUntil: new Date(Date.now() + 86400_000),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BeneficiaryService', () => {
  let service: BeneficiaryService;
  let repo: jest.Mocked<IBeneficiaryRepository>;
  let assetRegistry: jest.Mocked<AssetRegistry>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    repo = {
      listForUser: jest.fn(),
      addBankAccount: jest.fn(),
      addCryptoAddress: jest.fn(),
      getById: jest.fn(),
      getDefault: jest.fn(),
    };

    assetRegistry = {
      validateAddress: jest.fn(),
    } as unknown as jest.Mocked<AssetRegistry>;

    configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as jest.Mocked<ConfigService>;

    // Build the service manually (no Nest test bed) — constructor injection.
    service = new BeneficiaryService(repo, assetRegistry, configService);
  });

  // ── listForUser ────────────────────────────────────────────────────────────

  describe('listForUser', () => {
    it('returns the records from the repo', async () => {
      const records = [makeRecord()];
      repo.listForUser.mockResolvedValue(records);

      const result = await service.listForUser('user-id-1', 'bank_account');

      expect(repo.listForUser).toHaveBeenCalledWith(
        'user-id-1',
        'bank_account',
      );
      expect(result).toBe(records);
    });

    it('passes the crypto_address type correctly', async () => {
      repo.listForUser.mockResolvedValue([]);

      await service.listForUser('user-id-1', 'crypto_address');

      expect(repo.listForUser).toHaveBeenCalledWith(
        'user-id-1',
        'crypto_address',
      );
    });
  });

  // ── addBankAccount ─────────────────────────────────────────────────────────

  describe('addBankAccount', () => {
    it('passes the correct args to the repo and returns the created record', async () => {
      const record = makeRecord();
      repo.addBankAccount.mockResolvedValue(record);

      const result = await service.addBankAccount({
        userId: 'user-id-1',
        accountNumber: '0123456789',
        bankCode: '058',
        accountName: 'John Doe',
        label: 'GTB Savings',
      });

      expect(repo.addBankAccount).toHaveBeenCalledWith({
        userId: 'user-id-1',
        accountNumber: '0123456789',
        bankCode: '058',
        accountName: 'John Doe',
        label: 'GTB Savings',
      });
      expect(result).toBe(record);
    });

    it('does NOT call assetRegistry.validateAddress for bank accounts', async () => {
      repo.addBankAccount.mockResolvedValue(makeRecord());

      await service.addBankAccount({
        userId: 'u1',
        accountNumber: '0000000000',
        bankCode: '033',
        accountName: 'Jane',
        label: 'UBA',
      });

      expect(assetRegistry.validateAddress).not.toHaveBeenCalled();
    });
  });

  // ── addCryptoAddress ───────────────────────────────────────────────────────

  describe('addCryptoAddress', () => {
    it('throws InvalidAddressError when AssetRegistry.validateAddress returns false', async () => {
      assetRegistry.validateAddress.mockReturnValue(false);

      await expect(
        service.addCryptoAddress({
          userId: 'user-id-1',
          address: 'bad-address',
          network: 'TRON',
          asset: 'USDT',
          label: 'Bad wallet',
        }),
      ).rejects.toThrow(InvalidAddressError);

      expect(repo.addCryptoAddress).not.toHaveBeenCalled();
    });

    it('validates the address with the registry before persisting', async () => {
      assetRegistry.validateAddress.mockReturnValue(true);
      repo.addCryptoAddress.mockResolvedValue(makeCryptoRecord());

      await service.addCryptoAddress({
        userId: 'user-id-1',
        address: 'TQn9Y2khDD3VHKZ2GRdmKXD8bNkRuaBP2p',
        network: 'TRON',
        asset: 'USDT',
        label: 'My wallet',
      });

      expect(assetRegistry.validateAddress).toHaveBeenCalledWith(
        'TRON',
        'TQn9Y2khDD3VHKZ2GRdmKXD8bNkRuaBP2p',
      );
    });

    it('sets firstUseLockedUntil ~24h from now (default cooling-off) on valid address', async () => {
      assetRegistry.validateAddress.mockReturnValue(true);
      const record = makeCryptoRecord();
      repo.addCryptoAddress.mockResolvedValue(record);

      const before = Date.now();
      await service.addCryptoAddress({
        userId: 'user-id-1',
        address: 'TQn9Y2khDD3VHKZ2GRdmKXD8bNkRuaBP2p',
        network: 'TRON',
        asset: 'USDT',
        label: 'My wallet',
      });
      const after = Date.now();

      const callArg = repo.addCryptoAddress.mock.calls[0][0];
      const lockTs = callArg.firstUseLockedUntil.getTime();

      // 24h from now (default): between (before + 23.9h) and (after + 24.1h).
      const twentyFourH = 24 * 60 * 60 * 1000;
      expect(lockTs).toBeGreaterThanOrEqual(before + twentyFourH - 5000);
      expect(lockTs).toBeLessThanOrEqual(after + twentyFourH + 5000);
    });

    it('returns the created record from the repo', async () => {
      assetRegistry.validateAddress.mockReturnValue(true);
      const record = makeCryptoRecord();
      repo.addCryptoAddress.mockResolvedValue(record);

      const result = await service.addCryptoAddress({
        userId: 'user-id-1',
        address: 'TQn9Y2khDD3VHKZ2GRdmKXD8bNkRuaBP2p',
        network: 'TRON',
        asset: 'USDT',
        label: 'My wallet',
      });

      expect(result).toBe(record);
    });

    it('uses a custom cooling-off when configured', async () => {
      // Override the config stub to return 3600 (1 hour).
      configService.get.mockReturnValue(3600);

      assetRegistry.validateAddress.mockReturnValue(true);
      repo.addCryptoAddress.mockResolvedValue(makeCryptoRecord());

      const before = Date.now();
      await service.addCryptoAddress({
        userId: 'u1',
        address: 'TQn9Y2khDD3VHKZ2GRdmKXD8bNkRuaBP2p',
        network: 'TRON',
        asset: 'USDT',
        label: 'wallet',
      });
      const after = Date.now();

      const callArg = repo.addCryptoAddress.mock.calls[0][0];
      const lockTs = callArg.firstUseLockedUntil.getTime();

      const oneHour = 3600 * 1000;
      expect(lockTs).toBeGreaterThanOrEqual(before + oneHour - 5000);
      expect(lockTs).toBeLessThanOrEqual(after + oneHour + 5000);
    });
  });

  // ── getDefault ─────────────────────────────────────────────────────────────

  describe('getDefault', () => {
    it('returns the default beneficiary from the repo', async () => {
      const record = makeRecord();
      repo.getDefault.mockResolvedValue(record);

      const result = await service.getDefault('user-id-1', 'bank_account');

      expect(repo.getDefault).toHaveBeenCalledWith('user-id-1', 'bank_account');
      expect(result).toBe(record);
    });

    it('returns null when no default exists', async () => {
      repo.getDefault.mockResolvedValue(null);

      const result = await service.getDefault('user-id-1', 'bank_account');

      expect(result).toBeNull();
    });
  });

  // ── requireById ───────────────────────────────────────────────────────────

  describe('requireById', () => {
    it('returns the record when found', async () => {
      const record = makeRecord();
      repo.getById.mockResolvedValue(record);

      const result = await service.requireById('user-id-1', 'ben-id-1');

      expect(repo.getById).toHaveBeenCalledWith('user-id-1', 'ben-id-1');
      expect(result).toBe(record);
    });

    it('throws BeneficiaryNotFoundError when the repo returns null', async () => {
      repo.getById.mockResolvedValue(null);

      await expect(
        service.requireById('user-id-1', 'ben-id-missing'),
      ).rejects.toThrow(BeneficiaryNotFoundError);
    });
  });

  // ── getById ────────────────────────────────────────────────────────────────

  describe('getById', () => {
    it('returns the record when found', async () => {
      const record = makeRecord();
      repo.getById.mockResolvedValue(record);

      const result = await service.getById('user-id-1', 'ben-id-1');

      expect(result).toBe(record);
    });

    it('returns null when not found', async () => {
      repo.getById.mockResolvedValue(null);

      const result = await service.getById('user-id-1', 'ben-id-missing');

      expect(result).toBeNull();
    });
  });
});
