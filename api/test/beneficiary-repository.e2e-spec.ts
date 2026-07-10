/**
 * Integration test for BeneficiaryPrismaRepository (S3).
 *
 * Runs against a REAL Postgres via Testcontainers so all schema constraints
 * (FK → User, indexes, soft-delete semantics) are verified. Requires Docker.
 *
 * Runs in the `test:e2e` lane (jest-e2e.json), NOT the default unit lane,
 * so a Docker-less machine does not fail `pnpm test`.
 */

import { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { BeneficiaryPrismaRepository } from '../src/modules/beneficiaries/infrastructure/beneficiary.prisma.repository';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

describe('BeneficiaryPrismaRepository (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: BeneficiaryPrismaRepository;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());
    // Boundary cast: PrismaClient → PrismaService (safe; same API surface used).
    repo = new BeneficiaryPrismaRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await stop?.();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function seedUser(): Promise<{ id: string }> {
    return prisma.user.create({ data: {} });
  }

  // ── Test 1: addBankAccount → read back via listForUser ───────────────────

  it('addBankAccount persists a bank account with verifiedAt + verified status (Fix E)', async () => {
    const user = await seedUser();
    const verifiedAt = new Date();

    const created = await repo.addBankAccount({
      userId: user.id,
      accountNumber: '0123456789',
      bankCode: '058',
      // accountName is the bank-resolved name provided by BeneficiaryService
      // after calling INameEnquiry (Fix E — service layer resolves before calling repo).
      accountName: 'JOHN DOE (RESOLVED)',
      label: 'GTB Savings',
      payoutCurrency: 'NGN',
      bankCountry: 'NG',
      verificationStatus: 'verified',
      verifiedAt,
    });

    expect(created.id).toBeTruthy();
    expect(created.userId).toBe(user.id);
    expect(created.type).toBe('bank_account');
    expect(created.label).toBe('GTB Savings');
    expect(created.accountNumber).toBe('0123456789');
    expect(created.bankCode).toBe('058');
    expect(created.accountHolderName).toBe('JOHN DOE (RESOLVED)');
    // Wave G: currency/country dimension persisted + read back.
    expect(created.payoutCurrency).toBe('NGN');
    expect(created.bankCountry).toBe('NG');
    // Fix E: repository now writes 'verified' (name was resolved by INameEnquiry).
    expect(created.verificationStatus).toBe('verified');
    expect(created.verifiedAt).toBeInstanceOf(Date);
    expect(created.isDefault).toBe(true); // first bank account → default
    expect(created.deletedAt).toBeNull();

    const list = await repo.listForUser(user.id, 'bank_account');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
  });

  // ── Test 1b: unverified non-NG bank persists currency/country + null verifiedAt ──

  it('persists an UNVERIFIED bank with payoutCurrency/bankCountry and null verifiedAt', async () => {
    const user = await seedUser();

    const created = await repo.addBankAccount({
      userId: user.id,
      accountNumber: '0123456789',
      bankCode: '030100',
      accountName: 'KOFI MENSAH', // user-entered, kept as-is (no rail to resolve)
      label: 'My Ghana bank',
      payoutCurrency: 'GHS',
      bankCountry: 'GH',
      verificationStatus: 'unverified',
      verifiedAt: null,
    });

    expect(created.payoutCurrency).toBe('GHS');
    expect(created.bankCountry).toBe('GH');
    expect(created.accountHolderName).toBe('KOFI MENSAH');
    expect(created.verificationStatus).toBe('unverified');
    expect(created.verifiedAt).toBeNull();

    // Read back through listForUser preserves the columns.
    const [readBack] = await repo.listForUser(user.id, 'bank_account');
    expect(readBack.payoutCurrency).toBe('GHS');
    expect(readBack.bankCountry).toBe('GH');
  });

  // ── Test 1c: crypto rows leave currency/country null ─────────────────────

  it('leaves payoutCurrency/bankCountry null on a crypto-address beneficiary', async () => {
    const user = await seedUser();

    const created = await repo.addCryptoAddress({
      userId: user.id,
      address: 'TQn9Y2khDD3VHKZ2GRdmKXD8bNkRuaBP2q',
      network: 'TRON',
      asset: 'USDT',
      label: 'Cold wallet',
      firstUseLockedUntil: new Date(Date.now() + 86400_000),
    });

    expect(created.payoutCurrency).toBeNull();
    expect(created.bankCountry).toBeNull();
  });

  // ── Test 2: second bank account is not default ───────────────────────────

  it('second bank account is NOT the default', async () => {
    const user = await seedUser();

    await repo.addBankAccount({
      userId: user.id,
      accountNumber: '1111111111',
      bankCode: '033',
      accountName: 'Jane Doe',
      label: 'UBA',
      verifiedAt: new Date(),
      payoutCurrency: 'NGN',
      bankCountry: 'NG',
      verificationStatus: 'verified',
    });

    const second = await repo.addBankAccount({
      userId: user.id,
      accountNumber: '2222222222',
      bankCode: '011',
      accountName: 'Jane Doe',
      label: 'First Bank',
      verifiedAt: new Date(),
      payoutCurrency: 'NGN',
      bankCountry: 'NG',
      verificationStatus: 'verified',
    });

    expect(second.isDefault).toBe(false);
  });

  // ── Test 3: addCryptoAddress with firstUseLockedUntil ────────────────────

  it('addCryptoAddress persists a crypto address with firstUseLockedUntil set', async () => {
    const user = await seedUser();
    const lockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const created = await repo.addCryptoAddress({
      userId: user.id,
      address: 'TQn9Y2khDD3VHKZ2GRdmKXD8bNkRuaBP2p',
      network: 'TRON',
      asset: 'USDT',
      label: 'My TRON wallet',
      firstUseLockedUntil: lockedUntil,
    });

    expect(created.id).toBeTruthy();
    expect(created.type).toBe('crypto_address');
    expect(created.cryptoAddress).toBe('TQn9Y2khDD3VHKZ2GRdmKXD8bNkRuaBP2p');
    expect(created.cryptoNetwork).toBe('TRON');
    expect(created.cryptoAsset).toBe('USDT');
    expect(created.isDefault).toBe(true); // first crypto → default
    expect(created.firstUseLockedUntil).toBeDefined();
    expect(created.firstUseLockedUntil!.getTime()).toBeCloseTo(
      lockedUntil.getTime(),
      -2, // within ~100ms
    );
  });

  // ── Test 4: listForUser filters by type and excludes soft-deleted rows ────

  it('listForUser excludes soft-deleted rows and returns only the requested type', async () => {
    const user = await seedUser();

    const bankBen = await repo.addBankAccount({
      userId: user.id,
      accountNumber: '3333333333',
      bankCode: '044',
      accountName: 'Test User',
      label: 'Access Bank',
      verifiedAt: new Date(),
      payoutCurrency: 'NGN',
      bankCountry: 'NG',
      verificationStatus: 'verified',
    });

    const cryptoBen = await repo.addCryptoAddress({
      userId: user.id,
      address: 'TRXaddr_for_filter_test_00000000001',
      network: 'TRON',
      asset: 'USDT',
      label: 'TRON wallet',
      firstUseLockedUntil: new Date(Date.now() + 86400_000),
    });

    // Soft-delete the bank account directly via Prisma (simulating soft-delete).
    await prisma.beneficiary.update({
      where: { id: bankBen.id },
      data: { deletedAt: new Date() },
    });

    // listForUser for bank_account: soft-deleted row excluded → empty list
    const bankList = await repo.listForUser(user.id, 'bank_account');
    expect(bankList).toHaveLength(0);

    // listForUser for crypto_address: non-deleted row included
    const cryptoList = await repo.listForUser(user.id, 'crypto_address');
    expect(cryptoList).toHaveLength(1);
    expect(cryptoList[0].id).toBe(cryptoBen.id);
  });

  // ── Test 5: getById returns null for another user's beneficiary ──────────

  it('getById returns null when the beneficiary belongs to a different user', async () => {
    const user1 = await seedUser();
    const user2 = await seedUser();

    const ben = await repo.addBankAccount({
      userId: user1.id,
      accountNumber: '4444444444',
      bankCode: '058',
      accountName: 'User1',
      label: 'User1 GTB',
      verifiedAt: new Date(),
      payoutCurrency: 'NGN',
      bankCountry: 'NG',
      verificationStatus: 'verified',
    });

    // user2 must not be able to see user1's beneficiary.
    const result = await repo.getById(user2.id, ben.id);
    expect(result).toBeNull();
  });

  // ── Test 6: getDefault returns the default beneficiary ───────────────────

  it('getDefault returns the default bank account for the user', async () => {
    const user = await seedUser();

    const first = await repo.addBankAccount({
      userId: user.id,
      accountNumber: '5555555555',
      bankCode: '044',
      accountName: 'Main',
      label: 'Main Account',
      verifiedAt: new Date(),
      payoutCurrency: 'NGN',
      bankCountry: 'NG',
      verificationStatus: 'verified',
    });

    await repo.addBankAccount({
      userId: user.id,
      accountNumber: '6666666666',
      bankCode: '033',
      accountName: 'Secondary',
      label: 'Secondary',
      verifiedAt: new Date(),
      payoutCurrency: 'NGN',
      bankCountry: 'NG',
      verificationStatus: 'verified',
    });

    const def = await repo.getDefault(user.id, 'bank_account');
    expect(def).not.toBeNull();
    expect(def!.id).toBe(first.id);
    expect(def!.isDefault).toBe(true);
  });

  // ── Test 7: getDefault returns null when no beneficiaries exist ──────────

  it('getDefault returns null when the user has no bank accounts', async () => {
    const user = await seedUser();

    const result = await repo.getDefault(user.id, 'bank_account');
    expect(result).toBeNull();
  });

  // ── Test 8+: findByLabel (Wave B — beneficiary nickname resolution) ────────

  it('findByLabel matches the label case-insensitively (exact match, not substring)', async () => {
    const user = await seedUser();

    const mum = await repo.addBankAccount({
      userId: user.id,
      accountNumber: '7777777777',
      bankCode: '058',
      accountName: 'MOTHER DOE',
      label: 'Mum',
      verifiedAt: new Date(),
      payoutCurrency: 'NGN',
      bankCountry: 'NG',
      verificationStatus: 'verified',
    });
    await repo.addBankAccount({
      userId: user.id,
      accountNumber: '8888888888',
      bankCode: '044',
      accountName: 'FRIEND OF MUM',
      label: "Mum's friend",
      verifiedAt: new Date(),
      payoutCurrency: 'NGN',
      bankCountry: 'NG',
      verificationStatus: 'verified',
    });

    // Different casing still matches ("mum" ↔ "Mum") …
    const matches = await repo.findByLabel(user.id, 'mUm', 'bank_account');
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(mum.id);

    // … but a substring never does ("Mum" must not match "Mum's friend").
    const substring = await repo.findByLabel(user.id, 'Mum', 'bank_account');
    expect(substring.map((m) => m.id)).toEqual([mum.id]);
  });

  it('findByLabel excludes soft-deleted rows', async () => {
    const user = await seedUser();

    const ben = await repo.addBankAccount({
      userId: user.id,
      accountNumber: '9999999990',
      bankCode: '058',
      accountName: 'GONE',
      label: 'Old account',
      verifiedAt: new Date(),
      payoutCurrency: 'NGN',
      bankCountry: 'NG',
      verificationStatus: 'verified',
    });
    await prisma.beneficiary.update({
      where: { id: ben.id },
      data: { deletedAt: new Date() },
    });

    const matches = await repo.findByLabel(user.id, 'Old account');
    expect(matches).toHaveLength(0);
  });

  it('findByLabel returns ALL matches ordered isDefault desc then createdAt asc', async () => {
    const user = await seedUser();

    // First insert becomes the default; give the same label to three rows.
    const defaultBen = await repo.addBankAccount({
      userId: user.id,
      accountNumber: '1010101010',
      bankCode: '058',
      accountName: 'ONE',
      label: 'Savings',
      verifiedAt: new Date(),
      payoutCurrency: 'NGN',
      bankCountry: 'NG',
      verificationStatus: 'verified',
    });
    const second = await repo.addBankAccount({
      userId: user.id,
      accountNumber: '2020202020',
      bankCode: '044',
      accountName: 'TWO',
      label: 'savings',
      verifiedAt: new Date(),
      payoutCurrency: 'NGN',
      bankCountry: 'NG',
      verificationStatus: 'verified',
    });
    const third = await repo.addBankAccount({
      userId: user.id,
      accountNumber: '3030303030',
      bankCode: '033',
      accountName: 'THREE',
      label: 'SAVINGS',
      verifiedAt: new Date(),
      payoutCurrency: 'NGN',
      bankCountry: 'NG',
      verificationStatus: 'verified',
    });

    const matches = await repo.findByLabel(user.id, 'savings', 'bank_account');
    expect(matches.map((m) => m.id)).toEqual([
      defaultBen.id, // isDefault first
      second.id, // then createdAt asc
      third.id,
    ]);
  });

  it('findByLabel filters by type when given and spans types when omitted', async () => {
    const user = await seedUser();

    const bank = await repo.addBankAccount({
      userId: user.id,
      accountNumber: '4040404040',
      bankCode: '058',
      accountName: 'BANK MUM',
      label: 'Mum',
      verifiedAt: new Date(),
      payoutCurrency: 'NGN',
      bankCountry: 'NG',
      verificationStatus: 'verified',
    });
    const crypto = await repo.addCryptoAddress({
      userId: user.id,
      address: 'TRXaddr_findByLabel_type_0000000001',
      network: 'TRON',
      asset: 'USDT',
      label: 'Mum',
      firstUseLockedUntil: new Date(Date.now() + 86400_000),
    });

    const bankOnly = await repo.findByLabel(user.id, 'mum', 'bank_account');
    expect(bankOnly.map((m) => m.id)).toEqual([bank.id]);

    const cryptoOnly = await repo.findByLabel(user.id, 'mum', 'crypto_address');
    expect(cryptoOnly.map((m) => m.id)).toEqual([crypto.id]);

    const all = await repo.findByLabel(user.id, 'mum');
    expect(all.map((m) => m.id).sort()).toEqual([bank.id, crypto.id].sort());
  });

  it('findByLabel never returns another user_s beneficiaries', async () => {
    const user1 = await seedUser();
    const user2 = await seedUser();

    await repo.addBankAccount({
      userId: user1.id,
      accountNumber: '5050505050',
      bankCode: '058',
      accountName: 'USER ONE MUM',
      label: 'Mum',
      verifiedAt: new Date(),
      payoutCurrency: 'NGN',
      bankCountry: 'NG',
      verificationStatus: 'verified',
    });

    const matches = await repo.findByLabel(user2.id, 'Mum');
    expect(matches).toHaveLength(0);
  });
});
