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
      verifiedAt,
    });

    expect(created.id).toBeTruthy();
    expect(created.userId).toBe(user.id);
    expect(created.type).toBe('bank_account');
    expect(created.label).toBe('GTB Savings');
    expect(created.accountNumber).toBe('0123456789');
    expect(created.bankCode).toBe('058');
    expect(created.accountHolderName).toBe('JOHN DOE (RESOLVED)');
    // Fix E: repository now writes 'verified' (name was resolved by INameEnquiry).
    expect(created.verificationStatus).toBe('verified');
    expect(created.verifiedAt).toBeInstanceOf(Date);
    expect(created.isDefault).toBe(true); // first bank account → default
    expect(created.deletedAt).toBeNull();

    const list = await repo.listForUser(user.id, 'bank_account');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
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
    });

    const second = await repo.addBankAccount({
      userId: user.id,
      accountNumber: '2222222222',
      bankCode: '011',
      accountName: 'Jane Doe',
      label: 'First Bank',
      verifiedAt: new Date(),
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
    });

    await repo.addBankAccount({
      userId: user.id,
      accountNumber: '6666666666',
      bankCode: '033',
      accountName: 'Secondary',
      label: 'Secondary',
      verifiedAt: new Date(),
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
});
