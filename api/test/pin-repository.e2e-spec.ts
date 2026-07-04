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

  // ── Test 4: registerFailedAttempt is atomic and returns the new count ─────
  it('registerFailedAttempt atomically bumps the count by 1 and returns the new state', async () => {
    const userId = await seedUser();

    const first = await repo.registerFailedAttempt(userId, new Date());
    expect(first.count).toBe(1);
    expect(first.lockedUntil).toBeNull();
    const second = await repo.registerFailedAttempt(userId, new Date());
    expect(second.count).toBe(2);

    const state = await repo.getPinState(userId);
    expect(state!.pinFailureCount).toBe(2);
    expect(state!.pinLockedUntil).toBeNull();
  });

  it('registerFailedAttempt holds under concurrency — no lost updates (TOCTOU guard)', async () => {
    const userId = await seedUser();
    const now = new Date();

    // Fire a concurrent burst; the atomic DB statement must count every one.
    const BURST = 20;
    const results = await Promise.all(
      Array.from({ length: BURST }, () =>
        repo.registerFailedAttempt(userId, now),
      ),
    );

    // Every returned count is distinct and covers 1..BURST exactly.
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(
      Array.from({ length: BURST }, (_, i) => i + 1),
    );

    const state = await repo.getPinState(userId);
    expect(state!.pinFailureCount).toBe(BURST);
  });

  it('registerFailedAttempt on a just-EXPIRED lock starts a fresh window atomically under a burst', async () => {
    const userId = await seedUser();

    // Reach the cap, then lock in the PAST (window elapsed) — the attacker-
    // inducible state the fold-in reset must handle without a TOCTOU.
    for (let i = 0; i < 5; i += 1)
      await repo.registerFailedAttempt(userId, new Date());
    await repo.setLock(userId, new Date(Date.now() - 60_000));

    // A concurrent burst on the expired window: because the reset is folded into
    // the same atomic statement as the increment, counts still come out as a
    // clean 1..BURST (no interleaved double-reset keeping guesses under the cap).
    const now = new Date();
    const BURST = 20;
    const results = await Promise.all(
      Array.from({ length: BURST }, () =>
        repo.registerFailedAttempt(userId, now),
      ),
    );
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(
      Array.from({ length: BURST }, (_, i) => i + 1),
    );

    const state = await repo.getPinState(userId);
    expect(state!.pinFailureCount).toBe(BURST);
  });

  // ── Test 5: setLock persists pinLockedUntil ───────────────────────────────
  it('setLock persists pinLockedUntil without changing the failure count', async () => {
    const userId = await seedUser();
    await repo.registerFailedAttempt(userId, new Date());
    await repo.registerFailedAttempt(userId, new Date());

    const lockedUntil = new Date('2099-01-01T00:00:00.000Z');
    await repo.setLock(userId, lockedUntil);

    const state = await repo.getPinState(userId);
    expect(state!.pinFailureCount).toBe(2); // unchanged
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

    // First record failures + lock (via the atomic register + setLock API)
    for (let i = 0; i < 5; i += 1)
      await repo.registerFailedAttempt(userId, new Date());
    await repo.setLock(userId, lockedUntil);
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

    // 2. Record incremental failures (atomic register)
    expect((await repo.registerFailedAttempt(userId, new Date())).count).toBe(
      1,
    );
    expect((await repo.registerFailedAttempt(userId, new Date())).count).toBe(
      2,
    );
    expect((await repo.registerFailedAttempt(userId, new Date())).count).toBe(
      3,
    );

    const afterThree = await repo.getPinState(userId);
    expect(afterThree!.pinFailureCount).toBe(3);
    expect(afterThree!.pinLockedUntil).toBeNull();

    // 3. Lock on the 5th failure
    expect((await repo.registerFailedAttempt(userId, new Date())).count).toBe(
      4,
    );
    expect((await repo.registerFailedAttempt(userId, new Date())).count).toBe(
      5,
    );
    const lockedAt = new Date('2099-06-01T08:00:00.000Z');
    await repo.setLock(userId, lockedAt);
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
