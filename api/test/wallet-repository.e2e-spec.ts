/**
 * Integration test for WalletPrismaRepository (WN-1: wallet per network).
 *
 * Runs against a REAL Postgres via Testcontainers so all schema constraints
 * (@@unique([userId, network]), @unique address, FK → User) are verified.
 * Requires Docker.
 *
 * Runs in the `test:e2e` lane (jest-e2e.json), NOT the default unit lane,
 * so a Docker-less machine does not fail `pnpm test`.
 */

import { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { WalletPrismaRepository } from '../src/modules/wallets/infrastructure/wallet.prisma.repository';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

describe('WalletPrismaRepository (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: WalletPrismaRepository;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());
    // Boundary cast: PrismaClient → PrismaService (safe; same API surface used).
    repo = new WalletPrismaRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await stop?.();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function seedUser(): Promise<{ id: string }> {
    return prisma.user.create({ data: {} });
  }

  // ── Test 1: create → findByUserNetwork round-trip ────────────────────────

  it('persists a new wallet and reads it back via findByUserNetwork', async () => {
    const user = await seedUser();

    const created = await repo.create({
      userId: user.id,
      network: 'TRON',
      address: 'TRX_ADDR_ROUND_TRIP_001',
      providerReference: 'blockradar-ref-001',
      status: 'active',
      provisionedAt: new Date('2025-01-15T10:00:00.000Z'),
    });

    expect(created.id).toBeTruthy();
    expect(created.userId).toBe(user.id);
    expect(created.network).toBe('TRON');
    expect(created.address).toBe('TRX_ADDR_ROUND_TRIP_001');
    expect(created.providerReference).toBe('blockradar-ref-001');
    expect(created.status).toBe('active');

    const found = await repo.findByUserNetwork(user.id, 'TRON');

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.address).toBe('TRX_ADDR_ROUND_TRIP_001');
    expect(found!.providerReference).toBe('blockradar-ref-001');
  });

  // ── Test 2: findByUserNetwork returns null for unknown user ───────────────

  it('findByUserNetwork returns null when no wallet exists', async () => {
    const result = await repo.findByUserNetwork(
      '00000000-0000-7000-8000-000000000099',
      'TRON',
    );
    expect(result).toBeNull();
  });

  // ── Test 3: @@unique([userId, network]) rejects a duplicate ───────────────

  it('rejects a second wallet with the same (userId, network) — @@unique constraint', async () => {
    const user = await seedUser();

    await repo.create({
      userId: user.id,
      network: 'TRON',
      address: 'TRX_ADDR_UNIQUE_001',
      providerReference: 'blockradar-ref-unique-001',
      status: 'active',
      provisionedAt: new Date(),
    });

    // A second wallet for the same user/network must be rejected by the DB.
    await expect(
      repo.create({
        userId: user.id,
        network: 'TRON',
        address: 'TRX_ADDR_UNIQUE_002', // different address to bypass @unique on address
        providerReference: 'blockradar-ref-unique-002',
        status: 'active',
        provisionedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  // ── Test 4: @unique address constraint ───────────────────────────────────

  it('rejects a wallet with a duplicate on-chain address', async () => {
    const user1 = await seedUser();
    const user2 = await seedUser();

    await repo.create({
      userId: user1.id,
      network: 'TRON',
      address: 'TRX_ADDR_DUPLICATE',
      providerReference: 'blockradar-ref-dup-001',
      status: 'active',
      provisionedAt: new Date(),
    });

    // Different user, same address — @unique on address must reject it.
    await expect(
      repo.create({
        userId: user2.id,
        network: 'TRON',
        address: 'TRX_ADDR_DUPLICATE',
        providerReference: 'blockradar-ref-dup-002',
        status: 'active',
        provisionedAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});
