/**
 * Integration tests for the admin TREASURY oversight + beneficiary cooling-off
 * repositories (Phase 3, sub-area D) against a REAL Postgres (Testcontainers).
 * Exercises every new read/write on the real schema — enums, FKs, Decimal, the
 * append-only WalletBalance snapshot aggregation, and the firstUseLockedUntil
 * clear:
 *
 *   - TreasuryReadPrismaRepository: aggregateBalances (latest snapshot per
 *     wallet+asset, grouped by network+asset), listExposures, listAlerts (filter),
 *     acknowledgeAlert, listWithdrawalPolicies (active only)
 *   - BeneficiaryPrismaRepository: listAll, findById, clearCoolingOff
 *
 * Runs in the `test:e2e` lane (jest-e2e.json). Requires Docker.
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '../generated/prisma/client';
import type { AssetRegistry } from '../src/core/catalog/asset-registry';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { TreasuryReadPrismaRepository } from '../src/modules/treasury/infrastructure/treasury-read.prisma.repository';
import { BeneficiaryPrismaRepository } from '../src/modules/beneficiaries/infrastructure/beneficiary.prisma.repository';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

describe('Admin treasury + beneficiary repositories (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  let treasury: TreasuryReadPrismaRepository;
  let beneficiaries: BeneficiaryPrismaRepository;

  let userId: string;
  const adminId = randomUUID();

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());
    const svc = prisma as unknown as PrismaService;
    // The catalog default fiat is only consulted by the payout-queue projection
    // (not exercised in this suite); a minimal stub keeps the integration wiring
    // faithful without booting the full config-backed registry.
    const registry = {
      defaultFiat: () => 'NGN',
    } as unknown as AssetRegistry;
    treasury = new TreasuryReadPrismaRepository(svc, registry);
    beneficiaries = new BeneficiaryPrismaRepository(svc);
    userId = (await prisma.user.create({ data: {} })).id;
  });

  afterAll(async () => {
    await stop?.();
  });

  // ── Treasury: aggregateBalances ─────────────────────────────────────────────

  // One wallet per (user, network) — @@unique([userId, network]) — so each wallet
  // gets a fresh user.
  async function seedWallet(): Promise<string> {
    const owner = await prisma.user.create({ data: {} });
    const wallet = await prisma.wallet.create({
      data: {
        userId: owner.id,
        network: 'TRON' as never,
        address: `addr-${randomUUID()}`,
        providerReference: `ref-${randomUUID()}`,
        status: 'active',
      },
      select: { id: true },
    });
    return wallet.id;
  }

  async function seedBalance(
    walletId: string,
    asset: string,
    amount: string,
    syncedAt: Date,
  ): Promise<void> {
    await prisma.walletBalance.create({
      data: {
        walletId,
        asset,
        amount,
        assetDecimals: 6,
        source: 'provider_sync',
        syncedAt,
      },
    });
  }

  describe('TreasuryReadPrismaRepository.aggregateBalances', () => {
    it('sums the LATEST snapshot per (wallet, asset) grouped by network + asset', async () => {
      const w1 = await seedWallet();
      const w2 = await seedWallet();

      // w1/USDT: an old stale snapshot then a fresh one — only the fresh counts.
      await seedBalance(w1, 'USDT', '100', new Date('2026-01-01T00:00:00Z'));
      await seedBalance(w1, 'USDT', '250', new Date('2026-02-01T00:00:00Z'));
      // w2/USDT: a single snapshot.
      await seedBalance(w2, 'USDT', '50', new Date('2026-02-01T00:00:00Z'));

      const rows = await treasury.aggregateBalances();
      const tronUsdt = rows.find(
        (r) => r.network === 'TRON' && r.asset === 'USDT',
      );
      expect(tronUsdt).toBeDefined();
      // 250 (latest of w1) + 50 (w2) = 300 — the stale 100 is NOT summed.
      expect(Number(tronUsdt?.totalAmount)).toBe(300);
      expect(tronUsdt?.walletCount).toBe(2);
    });
  });

  // ── Treasury: exposures + alerts + policies ─────────────────────────────────

  async function seedExposure(over?: {
    status?: 'safe' | 'warning' | 'critical';
    snapshotType?: 'real_time' | 'daily_snapshot';
    asset?: string;
  }): Promise<string> {
    const row = await prisma.treasuryExposure.create({
      data: {
        asset: over?.asset ?? `USDT-${randomUUID().slice(0, 8)}`,
        fiatCurrency: 'NGN',
        cryptoHeld: '1000',
        fiatEquivalent: '1600000.00',
        fiatReserve: '500000.00',
        netExposure: '1100000.00',
        exposureLimitBps: 500,
        alertThresholdBps: 400,
        status: (over?.status ?? 'warning') as never,
        snapshotType: (over?.snapshotType ?? 'real_time') as never,
      },
      select: { id: true },
    });
    return row.id;
  }

  describe('TreasuryReadPrismaRepository.listExposures', () => {
    it('returns real_time snapshots with Decimals serialized to strings', async () => {
      const id = await seedExposure({ status: 'critical' });
      const rows = await treasury.listExposures();
      const found = rows.find((r) => r.id === id);
      expect(found).toBeDefined();
      expect(found?.status).toBe('critical');
      expect(typeof found?.fiatEquivalent).toBe('string');
      expect(found?.fiatEquivalent).toBe('1600000');
      expect(found?.cryptoHeld).toBe('1000');
    });
  });

  describe('TreasuryReadPrismaRepository alerts', () => {
    it('listAlerts filters by acknowledged state; acknowledgeAlert stamps the row', async () => {
      const exposureId = await seedExposure();
      const alert = await prisma.treasuryAlert.create({
        data: {
          exposureId,
          asset: 'USDT',
          severity: 'critical',
          message: 'Breach',
          netExposure: '1100000.00',
          exposureLimit: '1000000.00',
        },
        select: { id: true },
      });

      // Unacknowledged filter includes it.
      const unack = await treasury.listAlerts({ acknowledged: false });
      expect(unack.some((a) => a.id === alert.id)).toBe(true);
      // Acknowledged filter excludes it (still unacknowledged).
      const ack = await treasury.listAlerts({ acknowledged: true });
      expect(ack.some((a) => a.id === alert.id)).toBe(false);

      const at = new Date('2026-03-01T00:00:00.000Z');
      await treasury.acknowledgeAlert(alert.id, adminId, 'reviewed', at);

      const row = await prisma.treasuryAlert.findUniqueOrThrow({
        where: { id: alert.id },
      });
      expect(row.acknowledgedAt?.toISOString()).toBe(at.toISOString());
      expect(row.acknowledgedByAdminId).toBe(adminId);
      expect(row.acknowledgmentNote).toBe('reviewed');

      // Now it shows under the acknowledged filter.
      const ack2 = await treasury.listAlerts({ acknowledged: true });
      expect(ack2.some((a) => a.id === alert.id)).toBe(true);
    });
  });

  describe('TreasuryReadPrismaRepository.listWithdrawalPolicies', () => {
    it('returns only active (disabledAt null) policies with nullable caps', async () => {
      const w = await seedWallet();
      const active = await prisma.withdrawalPolicy.create({
        data: {
          walletId: w,
          maxWithdrawalPerDay: '5000',
          requiresApproval: true,
          allowListMode: 'allow_list_only',
        },
        select: { id: true },
      });
      const disabled = await prisma.withdrawalPolicy.create({
        data: {
          walletId: w,
          disabledAt: new Date('2026-01-01T00:00:00Z'),
        },
        select: { id: true },
      });

      const rows = await treasury.listWithdrawalPolicies();
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(active.id);
      expect(ids).not.toContain(disabled.id);

      const found = rows.find((r) => r.id === active.id);
      expect(found?.maxWithdrawalPerTx).toBeNull();
      expect(found?.maxWithdrawalPerDay).toBe('5000');
      expect(found?.requiresApproval).toBe(true);
      expect(found?.allowListMode).toBe('allow_list_only');
    });
  });

  // ── Beneficiary: listAll / findById / clearCoolingOff ───────────────────────

  describe('BeneficiaryPrismaRepository admin reads + cooling-off override', () => {
    it('listAll returns active beneficiaries; findById fetches by id; clearCoolingOff nulls the lock', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000);
      const ben = await prisma.beneficiary.create({
        data: {
          userId,
          type: 'crypto_address' as never,
          label: 'Cold wallet',
          cryptoAddress: 'TXyz',
          cryptoAsset: 'USDT',
          cryptoNetwork: 'TRON' as never,
          verificationStatus: 'pending' as never,
          firstUseLockedUntil: future,
        },
        select: { id: true },
      });

      const all = await beneficiaries.listAll({ limit: 50 });
      expect(all.some((b) => b.id === ben.id)).toBe(true);

      const found = await beneficiaries.findById(ben.id);
      expect(found?.id).toBe(ben.id);
      expect(found?.firstUseLockedUntil).not.toBeNull();
      expect(await beneficiaries.findById(randomUUID())).toBeNull();

      await beneficiaries.clearCoolingOff(ben.id);
      const after = await prisma.beneficiary.findUniqueOrThrow({
        where: { id: ben.id },
      });
      expect(after.firstUseLockedUntil).toBeNull();
    });

    it('listAll excludes soft-deleted beneficiaries', async () => {
      const deleted = await prisma.beneficiary.create({
        data: {
          userId,
          type: 'bank_account' as never,
          label: 'Closed',
          accountNumber: '0011',
          accountHolderName: 'X',
          bankCode: '058',
          verificationStatus: 'verified' as never,
          deletedAt: new Date(),
        },
        select: { id: true },
      });
      const all = await beneficiaries.listAll({ limit: 50 });
      expect(all.some((b) => b.id === deleted.id)).toBe(false);
      // findById also excludes soft-deleted rows.
      expect(await beneficiaries.findById(deleted.id)).toBeNull();
    });
  });
});
