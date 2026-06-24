/**
 * Integration test for PinPrismaRepository (task 4.3).
 *
 * Runs against a REAL Postgres via Testcontainers — all DB constraints and
 * field types are exercised against the actual schema.  Requires Docker.
 *
 * Runs in the `test:e2e` lane (jest-e2e.json), NOT the default unit lane,
 * so a Docker-less machine does not fail `pnpm test`.
 */

import { PrismaClient } from '../generated/prisma/client';
import { PinPrismaRepository } from '../src/core/auth/infrastructure/pin.prisma.repository';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

describe('PinPrismaRepository (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: PinPrismaRepository;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());
    // Boundary cast: PrismaClient → PrismaService (same API surface; safe at runtime).
    repo = new PinPrismaRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await stop?.();
  });

  /** Seed a bare User row and return its id. */
  async function seedUser(): Promise<string> {
    const user = await prisma.user.create({ data: {} });
    return user.id;
  }

  // ── Test 1: getPinState on a fresh user ────────────────────────────────────
  it('getPinState returns { pinHash: null, pinFailureCount: 0, pinLockedUntil: null } for a fresh user', async () => {
    const userId = await seedUser();

    const state = await repo.getPinState(userId);

    expect(state).not.toBeNull();
    expect(state!.pinHash).toBeNull();
    expect(state!.pinFailureCount).toBe(0);
    expect(state!.pinLockedUntil).toBeNull();
  });

  // ── Test 2: getPinState on unknown id ─────────────────────────────────────
  it('getPinState returns null for an unknown userId', async () => {
    const result = await repo.getPinState(
      '00000000-0000-7000-8000-000000000099',
    );
    expect(result).toBeNull();
  });

  // ── Test 3: setPinHash round-trip ─────────────────────────────────────────
  it('setPinHash persists the hash; getPinState reads it back', async () => {
    const userId = await seedUser();
    const hash = 'aabbccdd:11223344556677889900aabbccddee';

    await repo.setPinHash(userId, hash);

    const state = await repo.getPinState(userId);
    expect(state).not.toBeNull();
    expect(state!.pinHash).toBe(hash);
    expect(state!.pinFailureCount).toBe(0);
  });

  // ── Test 4: recordFailure (without lock) ──────────────────────────────────
  it('recordFailure increments the failure count and leaves pinLockedUntil null when not locking', async () => {
    const userId = await seedUser();

    await repo.recordFailure(userId, 2, null);

    const state = await repo.getPinState(userId);
    expect(state!.pinFailureCount).toBe(2);
    expect(state!.pinLockedUntil).toBeNull();
  });

  // ── Test 5: recordFailure (with lockout timestamp) ────────────────────────
  it('recordFailure sets pinLockedUntil when a lockout timestamp is provided', async () => {
    const userId = await seedUser();
    const lockedUntil = new Date('2099-01-01T00:00:00.000Z');

    await repo.recordFailure(userId, 5, lockedUntil);

    const state = await repo.getPinState(userId);
    expect(state!.pinFailureCount).toBe(5);
    expect(state!.pinLockedUntil).not.toBeNull();
    // Timestamps may lose sub-second precision in Postgres; compare at second granularity.
    expect(state!.pinLockedUntil!.getTime()).toBeGreaterThanOrEqual(
      lockedUntil.getTime() - 1000,
    );
  });

  // ── Test 6: resetFailures clears count and lock ───────────────────────────
  it('resetFailures sets pinFailureCount to 0 and clears pinLockedUntil', async () => {
    const userId = await seedUser();
    const lockedUntil = new Date('2099-12-31T23:59:59.000Z');

    // First record a failure + lock
    await repo.recordFailure(userId, 5, lockedUntil);
    const locked = await repo.getPinState(userId);
    expect(locked!.pinFailureCount).toBe(5);
    expect(locked!.pinLockedUntil).not.toBeNull();

    // Now reset
    await repo.resetFailures(userId);
    const reset = await repo.getPinState(userId);
    expect(reset!.pinFailureCount).toBe(0);
    expect(reset!.pinLockedUntil).toBeNull();
  });

  // ── Test 7: full lifecycle (set → fail × N → lock → reset) ───────────────
  it('full lifecycle: set PIN hash, record failures until locked, then reset', async () => {
    const userId = await seedUser();
    const hash = 'deadbeef:cafecafe11223344556677889900';

    // 1. Set the PIN
    await repo.setPinHash(userId, hash);
    const afterSet = await repo.getPinState(userId);
    expect(afterSet!.pinHash).toBe(hash);
    expect(afterSet!.pinFailureCount).toBe(0);

    // 2. Record incremental failures
    await repo.recordFailure(userId, 1, null);
    await repo.recordFailure(userId, 2, null);
    await repo.recordFailure(userId, 3, null);

    const afterThree = await repo.getPinState(userId);
    expect(afterThree!.pinFailureCount).toBe(3);
    expect(afterThree!.pinLockedUntil).toBeNull();

    // 3. Lock on the 5th failure
    const lockedAt = new Date('2099-06-01T08:00:00.000Z');
    await repo.recordFailure(userId, 5, lockedAt);
    const afterLock = await repo.getPinState(userId);
    expect(afterLock!.pinFailureCount).toBe(5);
    expect(afterLock!.pinLockedUntil).not.toBeNull();
    expect(afterLock!.pinHash).toBe(hash); // hash is unchanged

    // 4. Reset on successful verify
    await repo.resetFailures(userId);
    const afterReset = await repo.getPinState(userId);
    expect(afterReset!.pinFailureCount).toBe(0);
    expect(afterReset!.pinLockedUntil).toBeNull();
    expect(afterReset!.pinHash).toBe(hash); // hash still there
  });
});
