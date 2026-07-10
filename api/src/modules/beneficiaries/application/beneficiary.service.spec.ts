/**
 * TDD — beneficiary.service.spec.ts (S3 + Fix E)
 *
 * Unit tests for BeneficiaryService. All dependencies are mocked:
 *   - IBeneficiaryRepository (mock object)
 *   - INameEnquiry (mock object — resolve is an async fn)
 *   - AssetRegistry (mock object — validateAddress is a pure boolean fn)
 *   - EffectiveConfigService (stub returning undefined for the optional cooling-off key)
 *
 * Tests cover:
 *   - addBankAccount calls name-enquiry, persists resolved name + verifiedAt (Fix E)
 *   - addBankAccount enquiry failure → NameEnquiryFailedError + no repo call (Fix E)
 *   - addCryptoAddress validates address (invalid → InvalidAddressError)
 *   - addCryptoAddress sets firstUseLockedUntil on valid address
 *   - addCryptoAddress does NOT call name-enquiry (Fix E)
 *   - listForUser returns active records from the repo
 *   - getDefault returns the default from the repo
 *   - requireById returns the record; throws BeneficiaryNotFoundError when absent
 */

import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import {
  InvalidAddressError,
  BeneficiaryInvalidAccountNumberError,
  BeneficiaryNotFoundError,
  NameEnquiryFailedError,
  UnknownBankCountryError,
} from '../domain/beneficiary-errors';
import type {
  IBeneficiaryRepository,
  BeneficiaryRecord,
} from './ports/beneficiary.repository.port';
import type { INameEnquiry } from './ports/name-enquiry.port';
import type { IBankListProvider } from './ports/bank-list.port';
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
    payoutCurrency: 'NGN',
    bankCountry: 'NG',
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
    payoutCurrency: null,
    bankCountry: null,
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
  let nameEnquiry: jest.Mocked<INameEnquiry>;
  let assetRegistry: jest.Mocked<AssetRegistry>;
  let configService: jest.Mocked<EffectiveConfigService>;
  let bankListProvider: jest.Mocked<IBankListProvider>;

  // Catalog: NGN→NG is name-enquiry-resolvable; GHS→GH is NOT.
  const COUNTRY_BY_FIAT: Record<string, string> = { NGN: 'NG', GHS: 'GH' };

  beforeEach(() => {
    repo = {
      listForUser: jest.fn(),
      addBankAccount: jest.fn(),
      addCryptoAddress: jest.fn(),
      getById: jest.fn(),
      getDefault: jest.fn(),
      listAll: jest.fn(),
      findById: jest.fn(),
      clearCoolingOff: jest.fn(),
      findActiveDuplicate: jest.fn().mockResolvedValue(null),
      softDelete: jest.fn(),
      findByLabel: jest.fn(),
    };

    nameEnquiry = {
      resolve: jest.fn(),
    };

    assetRegistry = {
      validateAddress: jest.fn(),
      defaultFiat: jest.fn().mockReturnValue('NGN'),
      countryForFiat: jest.fn((code: string) => {
        const country = COUNTRY_BY_FIAT[code];
        if (!country) throw new Error(`no country for ${code}`);
        return country;
      }),
      knownCountries: jest.fn().mockReturnValue(['NG', 'GH']),
    } as unknown as jest.Mocked<AssetRegistry>;

    configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as jest.Mocked<EffectiveConfigService>;

    bankListProvider = {
      listBanks: jest.fn(),
    };

    // Build the service manually (no Nest test bed) — constructor injection.
    service = new BeneficiaryService(
      repo,
      nameEnquiry,
      assetRegistry,
      configService,
      bankListProvider,
    );
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

  // ── addBankAccount (Fix E) ──────────────────────────────────────────────────

  describe('addBankAccount', () => {
    it('calls name-enquiry with bankCode + accountNumber before persisting', async () => {
      nameEnquiry.resolve.mockResolvedValue({
        accountName: 'RESOLVED NAME',
        provider: 'mock',
        reference: 'mock-ref-001',
      });
      repo.addBankAccount.mockResolvedValue(makeRecord());

      await service.addBankAccount({
        userId: 'user-id-1',
        accountNumber: '0123456789',
        bankCode: '058',
        accountName: 'Caller Supplied Name',
        label: 'GTB Savings',
      });

      expect(nameEnquiry.resolve).toHaveBeenCalledWith({
        bankCode: '058',
        accountNumber: '0123456789',
      });
    });

    it('persists the RESOLVED accountName (not the caller-supplied name)', async () => {
      nameEnquiry.resolve.mockResolvedValue({
        accountName: 'RESOLVED NAME FROM BANK',
        provider: 'mock',
        reference: 'mock-ref-002',
      });
      repo.addBankAccount.mockResolvedValue(makeRecord());

      await service.addBankAccount({
        userId: 'user-id-1',
        accountNumber: '0123456789',
        bankCode: '058',
        accountName: 'Caller Supplied Name',
        label: 'GTB Savings',
      });

      expect(repo.addBankAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          accountName: 'RESOLVED NAME FROM BANK',
        }),
      );
    });

    it('passes verifiedAt as a Date to the repo', async () => {
      const before = new Date();
      nameEnquiry.resolve.mockResolvedValue({
        accountName: 'RESOLVED',
        provider: 'mock',
        reference: 'ref-003',
      });
      repo.addBankAccount.mockResolvedValue(makeRecord());

      await service.addBankAccount({
        userId: 'user-id-1',
        accountNumber: '0123456789',
        bankCode: '058',
        accountName: 'Someone',
        label: 'GTB',
      });

      const after = new Date();
      const callArg = repo.addBankAccount.mock.calls[0][0];
      expect(callArg.verifiedAt).toBeInstanceOf(Date);
      // NG is resolvable → verifiedAt is a Date (never null on this path).
      expect(callArg.verifiedAt!.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(callArg.verifiedAt!.getTime()).toBeLessThanOrEqual(
        after.getTime(),
      );
    });

    it('returns the record from the repo', async () => {
      const record = makeRecord();
      nameEnquiry.resolve.mockResolvedValue({
        accountName: 'RESOLVED',
        provider: 'mock',
        reference: 'ref-004',
      });
      repo.addBankAccount.mockResolvedValue(record);

      const result = await service.addBankAccount({
        userId: 'user-id-1',
        accountNumber: '0123456789',
        bankCode: '058',
        accountName: 'John Doe',
        label: 'GTB Savings',
      });

      expect(result).toBe(record);
    });

    it('throws NameEnquiryFailedError and does NOT call repo when enquiry fails', async () => {
      nameEnquiry.resolve.mockRejectedValue(
        new NameEnquiryFailedError('058', '9999999999'),
      );

      await expect(
        service.addBankAccount({
          userId: 'user-id-1',
          accountNumber: '9999999999',
          bankCode: '058',
          accountName: 'Should Not Matter',
          label: 'GTB Savings',
        }),
      ).rejects.toThrow(NameEnquiryFailedError);

      expect(repo.addBankAccount).not.toHaveBeenCalled();
    });

    it('does NOT call assetRegistry.validateAddress for bank accounts', async () => {
      nameEnquiry.resolve.mockResolvedValue({
        accountName: 'RESOLVED',
        provider: 'mock',
        reference: 'ref-005',
      });
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

    // ── dedupe (one typo / re-add must not duplicate) ───────────────────────
    it('reuses an existing active bank account instead of inserting a duplicate', async () => {
      const existing = makeRecord({ id: 'existing-bank-id' });
      repo.findActiveDuplicate.mockResolvedValue(existing);
      nameEnquiry.resolve.mockResolvedValue({
        accountName: 'RESOLVED',
        provider: 'mock',
        reference: 'ref-dupe',
      });

      const result = await service.addBankAccount({
        userId: 'user-id-1',
        accountNumber: '0123456789',
        bankCode: '058',
        accountName: 'John Doe',
        label: 'GTB Savings',
      });

      expect(repo.findActiveDuplicate).toHaveBeenCalledWith('user-id-1', {
        type: 'bank_account',
        accountNumber: '0123456789',
        bankCode: '058',
      });
      // Reuse the existing row — no insert, no redundant name-enquiry.
      expect(repo.addBankAccount).not.toHaveBeenCalled();
      expect(nameEnquiry.resolve).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    // ── currency/country derivation + country-gated name-enquiry ─────────────
    it('derives country from currency and persists a VERIFIED NG bank (resolvable rail)', async () => {
      nameEnquiry.resolve.mockResolvedValue({
        accountName: 'RESOLVED NAME',
        provider: 'flutterwave',
        reference: 'ref-ng',
      });
      repo.addBankAccount.mockResolvedValue(makeRecord());

      await service.addBankAccount({
        userId: 'user-id-1',
        accountNumber: '0123456789',
        bankCode: '058',
        label: 'GTB',
        currency: 'NGN',
      });

      expect(assetRegistry.countryForFiat).toHaveBeenCalledWith('NGN');
      expect(nameEnquiry.resolve).toHaveBeenCalledTimes(1);
      expect(repo.addBankAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          accountName: 'RESOLVED NAME',
          payoutCurrency: 'NGN',
          bankCountry: 'NG',
          verificationStatus: 'verified',
        }),
      );
      const callArg = repo.addBankAccount.mock.calls[0][0];
      expect(callArg.verifiedAt).toBeInstanceOf(Date);
    });

    it('defaults currency to the catalog base fiat when the caller omits it (WhatsApp NGN Flow)', async () => {
      nameEnquiry.resolve.mockResolvedValue({
        accountName: 'RESOLVED',
        provider: 'flutterwave',
        reference: 'ref-default',
      });
      repo.addBankAccount.mockResolvedValue(makeRecord());

      await service.addBankAccount({
        userId: 'user-id-1',
        accountNumber: '0123456789',
        bankCode: '058',
        accountName: 'Someone',
        label: 'GTB',
      });

      expect(assetRegistry.defaultFiat).toHaveBeenCalled();
      expect(repo.addBankAccount).toHaveBeenCalledWith(
        expect.objectContaining({ payoutCurrency: 'NGN', bankCountry: 'NG' }),
      );
    });

    it('SKIPS name-enquiry for a non-resolvable country and saves the user-entered name UNVERIFIED (never fails closed)', async () => {
      repo.addBankAccount.mockResolvedValue(makeRecord());

      await service.addBankAccount({
        userId: 'user-id-1',
        accountNumber: '0123456789',
        bankCode: '030100', // a GH bank code
        accountName: 'KOFI MENSAH',
        label: 'My Ghana bank',
        currency: 'GHS',
      });

      // GH is not in the resolvable set → no enquiry, no fail-closed.
      expect(nameEnquiry.resolve).not.toHaveBeenCalled();
      expect(repo.addBankAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          accountName: 'KOFI MENSAH',
          payoutCurrency: 'GHS',
          bankCountry: 'GH',
          verificationStatus: 'unverified',
          verifiedAt: null,
        }),
      );
    });

    it('falls back to the label as the unverified name when no accountName is supplied', async () => {
      repo.addBankAccount.mockResolvedValue(makeRecord());

      await service.addBankAccount({
        userId: 'user-id-1',
        accountNumber: '0123456789',
        bankCode: '030100',
        label: 'My Ghana bank',
        currency: 'GHS',
      });

      expect(repo.addBankAccount).toHaveBeenCalledWith(
        expect.objectContaining({ accountName: 'My Ghana bank' }),
      );
    });

    it('respects a config override of the resolvable-countries set', async () => {
      // Admin adds GH to the resolvable set → GHS now runs name-enquiry.
      configService.get.mockImplementation((key: string) =>
        key === 'beneficiary.nameEnquiryResolvableCountries'
          ? ['NG', 'GH']
          : undefined,
      );
      nameEnquiry.resolve.mockResolvedValue({
        accountName: 'RESOLVED GH',
        provider: 'flutterwave',
        reference: 'ref-gh',
      });
      repo.addBankAccount.mockResolvedValue(makeRecord());

      await service.addBankAccount({
        userId: 'user-id-1',
        accountNumber: '0123456789',
        bankCode: '030100',
        accountName: 'IGNORED',
        label: 'My Ghana bank',
        currency: 'GHS',
      });

      expect(nameEnquiry.resolve).toHaveBeenCalledTimes(1);
      expect(repo.addBankAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          accountName: 'RESOLVED GH',
          verificationStatus: 'verified',
        }),
      );
    });

    // ── B1: per-country account-number validation (server-side gate) ──────────
    it('accepts a 10-digit NUBAN for NG', async () => {
      nameEnquiry.resolve.mockResolvedValue({
        accountName: 'RESOLVED',
        provider: 'flutterwave',
        reference: 'ref-ng10',
      });
      repo.addBankAccount.mockResolvedValue(makeRecord());

      await expect(
        service.addBankAccount({
          userId: 'u1',
          accountNumber: '0123456789', // 10 digits
          bankCode: '058',
          label: 'GTB',
          currency: 'NGN',
        }),
      ).resolves.toBeDefined();
      expect(nameEnquiry.resolve).toHaveBeenCalledTimes(1);
    });

    it('rejects a 9-digit NG account number (before dedupe / name-enquiry / repo)', async () => {
      await expect(
        service.addBankAccount({
          userId: 'u1',
          accountNumber: '012345678', // 9 digits — invalid NUBAN
          bankCode: '058',
          label: 'GTB',
          currency: 'NGN',
        }),
      ).rejects.toThrow(BeneficiaryInvalidAccountNumberError);

      expect(repo.findActiveDuplicate).not.toHaveBeenCalled();
      expect(nameEnquiry.resolve).not.toHaveBeenCalled();
      expect(repo.addBankAccount).not.toHaveBeenCalled();
    });

    it('accepts a 13-digit GHS account number (permissive non-NG band — the old 10-digit DTO rejected it)', async () => {
      repo.addBankAccount.mockResolvedValue(makeRecord());

      await service.addBankAccount({
        userId: 'u1',
        accountNumber: '1234567890123', // 13 digits
        bankCode: '030100',
        accountName: 'KOFI MENSAH',
        label: 'Ghana bank',
        currency: 'GHS',
      });

      expect(repo.addBankAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          accountNumber: '1234567890123',
          bankCountry: 'GH',
          verificationStatus: 'unverified',
        }),
      );
    });

    it('rejects a non-digit account number', async () => {
      await expect(
        service.addBankAccount({
          userId: 'u1',
          accountNumber: '01234ABCDE',
          bankCode: '030100',
          accountName: 'KOFI',
          label: 'Ghana bank',
          currency: 'GHS',
        }),
      ).rejects.toThrow(BeneficiaryInvalidAccountNumberError);
      expect(repo.addBankAccount).not.toHaveBeenCalled();
    });

    // ── B3: unverified bank adds carry a first-use cooling-off ────────────────
    it('sets a ~24h first-use cooling-off on an UNVERIFIED (non-resolvable country) bank add', async () => {
      repo.addBankAccount.mockResolvedValue(makeRecord());
      const before = Date.now();

      await service.addBankAccount({
        userId: 'u1',
        accountNumber: '1234567890123',
        bankCode: '030100',
        accountName: 'KOFI MENSAH',
        label: 'Ghana bank',
        currency: 'GHS',
      });
      const after = Date.now();

      const callArg = repo.addBankAccount.mock.calls[0][0];
      expect(callArg.verificationStatus).toBe('unverified');
      expect(callArg.firstUseLockedUntil).toBeInstanceOf(Date);
      const lockTs = callArg.firstUseLockedUntil!.getTime();
      const day = 24 * 60 * 60 * 1000; // default cooling-off (config stub → undefined)
      expect(lockTs).toBeGreaterThanOrEqual(before + day - 5000);
      expect(lockTs).toBeLessThanOrEqual(after + day + 5000);
    });

    it('does NOT set a cooling-off on a VERIFIED NG bank (name-enquiry resolved)', async () => {
      nameEnquiry.resolve.mockResolvedValue({
        accountName: 'RESOLVED',
        provider: 'flutterwave',
        reference: 'ref-ng-verified',
      });
      repo.addBankAccount.mockResolvedValue(makeRecord());

      await service.addBankAccount({
        userId: 'u1',
        accountNumber: '0123456789',
        bankCode: '058',
        label: 'GTB',
        currency: 'NGN',
      });

      const callArg = repo.addBankAccount.mock.calls[0][0];
      expect(callArg.verificationStatus).toBe('verified');
      expect(callArg.firstUseLockedUntil).toBeNull();
    });

    // ── A2: forceUnverified (media-extraction path) ──────────────────────────
    it('forceUnverified SKIPS name-enquiry and persists UNVERIFIED + cooling-off even for a resolvable country (NG)', async () => {
      repo.addBankAccount.mockResolvedValue(makeRecord());

      await service.addBankAccount({
        userId: 'u1',
        accountNumber: '0123456789',
        bankCode: '058',
        accountName: 'From image',
        label: 'From image',
        currency: 'NGN',
        forceUnverified: true,
      });

      // NG is normally name-enquiry-resolvable, but forceUnverified skips it so
      // an image-extracted destination never becomes verified/immediately-usable.
      expect(nameEnquiry.resolve).not.toHaveBeenCalled();
      const callArg = repo.addBankAccount.mock.calls[0][0];
      expect(callArg.verificationStatus).toBe('unverified');
      expect(callArg.firstUseLockedUntil).toBeInstanceOf(Date);
    });

    // ── rail carried through to the repo ─────────────────────────────────────
    it('defaults the rail to bank on a verified NG add', async () => {
      nameEnquiry.resolve.mockResolvedValue({
        accountName: 'RESOLVED',
        provider: 'flutterwave',
        reference: 'ref-rail',
      });
      repo.addBankAccount.mockResolvedValue(makeRecord());

      await service.addBankAccount({
        userId: 'u1',
        accountNumber: '0123456789',
        bankCode: '058',
        label: 'GTB',
        currency: 'NGN',
      });

      expect(repo.addBankAccount).toHaveBeenCalledWith(
        expect.objectContaining({ rail: 'bank' }),
      );
    });

    it('carries a mobile_money rail through to the repo', async () => {
      repo.addBankAccount.mockResolvedValue(makeRecord());

      await service.addBankAccount({
        userId: 'u1',
        accountNumber: '1234567890123',
        bankCode: '030100',
        accountName: 'KOFI',
        label: 'MoMo',
        currency: 'GHS',
        rail: 'mobile_money',
      });

      expect(repo.addBankAccount).toHaveBeenCalledWith(
        expect.objectContaining({ rail: 'mobile_money' }),
      );
    });
  });

  // ── listBanks ────────────────────────────────────────────────────────────

  describe('listBanks', () => {
    it('validates the country then delegates to the bank-list provider', async () => {
      const banks = [{ name: 'GTBank', code: '058' }];
      bankListProvider.listBanks.mockResolvedValue(banks);

      const result = await service.listBanks('ng');

      // Country is normalised to upper-case before the provider call.
      expect(bankListProvider.listBanks).toHaveBeenCalledWith('NG');
      expect(result).toBe(banks);
    });

    it('throws UnknownBankCountryError for a country not in the catalog', async () => {
      await expect(service.listBanks('ZZ')).rejects.toThrow(
        UnknownBankCountryError,
      );
      expect(bankListProvider.listBanks).not.toHaveBeenCalled();
    });
  });

  // ── addCryptoAddress ───────────────────────────────────────────────────────

  describe('addCryptoAddress', () => {
    it('does NOT call name-enquiry for crypto-address beneficiaries', async () => {
      assetRegistry.validateAddress.mockReturnValue(true);
      repo.addCryptoAddress.mockResolvedValue(makeCryptoRecord());

      await service.addCryptoAddress({
        userId: 'user-id-1',
        address: 'TQn9Y2khDD3VHKZ2GRdmKXD8bNkRuaBP2p',
        network: 'TRON',
        asset: 'USDT',
        label: 'My wallet',
      });

      expect(nameEnquiry.resolve).not.toHaveBeenCalled();
    });

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

    it('reuses an existing active crypto address (preserves the cooling-off clock)', async () => {
      const existing = makeCryptoRecord({ id: 'existing-crypto-id' });
      repo.findActiveDuplicate.mockResolvedValue(existing);
      assetRegistry.validateAddress.mockReturnValue(true);

      const result = await service.addCryptoAddress({
        userId: 'user-id-1',
        address: 'TQn9Y2khDD3VHKZ2GRdmKXD8bNkRuaBP2p',
        network: 'TRON',
        asset: 'USDT',
        label: 'My wallet again',
      });

      expect(repo.findActiveDuplicate).toHaveBeenCalledWith('user-id-1', {
        type: 'crypto_address',
        cryptoAddress: 'TQn9Y2khDD3VHKZ2GRdmKXD8bNkRuaBP2p',
      });
      // Reuse the existing row — never re-insert (would reset firstUseLockedUntil).
      expect(repo.addCryptoAddress).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('still validates the address before the dedupe lookup (invalid never dedupes)', async () => {
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

      expect(repo.findActiveDuplicate).not.toHaveBeenCalled();
    });

    it('uses a custom cooling-off when configured (DB AppSetting override flows through EffectiveConfigService)', async () => {
      // Simulate a DB AppSetting override of beneficiary.cryptoCoolingOffSeconds
      // to 3600 (1 hour); the override is read at call time and must take effect.
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

  // ── resolveByNickname (Wave B — beneficiary nicknames) ─────────────────────

  describe('resolveByNickname', () => {
    it('delegates to repo.findByLabel scoped by user + type and returns the matches', async () => {
      const matches = [makeRecord(), makeRecord({ id: 'ben-id-3' })];
      repo.findByLabel.mockResolvedValue(matches);

      const result = await service.resolveByNickname(
        'user-id-1',
        'bank_account',
        'GTB Savings',
      );

      expect(repo.findByLabel).toHaveBeenCalledWith(
        'user-id-1',
        'GTB Savings',
        'bank_account',
      );
      expect(result).toBe(matches);
    });

    it('trims the nickname before the lookup', async () => {
      repo.findByLabel.mockResolvedValue([]);

      await service.resolveByNickname('user-id-1', 'crypto_address', '  mum  ');

      expect(repo.findByLabel).toHaveBeenCalledWith(
        'user-id-1',
        'mum',
        'crypto_address',
      );
    });

    it('returns an empty array when nothing matches', async () => {
      repo.findByLabel.mockResolvedValue([]);

      const result = await service.resolveByNickname(
        'user-id-1',
        'bank_account',
        'ghost',
      );

      expect(result).toEqual([]);
    });

    it('returns an empty array without hitting the repo for a blank nickname', async () => {
      const result = await service.resolveByNickname(
        'user-id-1',
        'bank_account',
        '   ',
      );

      expect(result).toEqual([]);
      expect(repo.findByLabel).not.toHaveBeenCalled();
    });
  });

  // ── delete (soft-delete) ────────────────────────────────────────────────────

  describe('delete', () => {
    it('soft-deletes the beneficiary and returns its id', async () => {
      repo.softDelete.mockResolvedValue(true);

      const result = await service.delete('user-id-1', 'ben-id-1');

      expect(repo.softDelete).toHaveBeenCalledWith('user-id-1', 'ben-id-1');
      expect(result).toEqual({ id: 'ben-id-1', deleted: true });
    });

    it('throws BeneficiaryNotFoundError when nothing was deleted', async () => {
      repo.softDelete.mockResolvedValue(false);

      await expect(
        service.delete('user-id-1', 'ben-id-missing'),
      ).rejects.toThrow(BeneficiaryNotFoundError);
    });
  });
});
