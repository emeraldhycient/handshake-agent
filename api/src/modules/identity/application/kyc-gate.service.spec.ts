/**
 * Unit tests for KycGateService (task 2.2, §3.3).
 *
 * All external dependencies are mocked:
 *   - IDENTITY_REPOSITORY → mock IIdentityRepository
 *   - VELOCITY_REPOSITORY → mock IVelocityRepository
 *   - ConfigService       → stub returning fixed limit values
 *   - CLOCK               → stub returning a fixed Date
 *
 * Tests follow strict TDD: written first (red), then KycGateService is implemented.
 */

import type {
  IIdentityRepository,
  UserRecord,
} from './ports/identity.repository.port';
import type { IVelocityRepository } from './ports/velocity.repository.port';
import type { AppConfig } from '../../../core/config/configuration';
import type { Clock } from '../../../core/common/clock';
import {
  GateError,
  KycNotVerifiedError,
  SimSwapBlockedError,
  TierLimitExceededError,
  VelocityExceededError,
} from '../domain/gate-errors';
import { KycGateService } from './kyc-gate.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2024-06-01T12:00:00.000Z');

const TIER_1_LIMITS = {
  perTxFiatMax: 50_000,
  dailyFiatMax: 200_000,
  dailyTxCountMax: 10,
};

const stubConfig = {
  get: (key: string) => {
    if (key === 'limits') {
      return {
        tier_1: TIER_1_LIMITS,
        tier_2: {
          perTxFiatMax: 500_000,
          dailyFiatMax: 2_000_000,
          dailyTxCountMax: 30,
        },
        tier_3: {
          perTxFiatMax: 5_000_000,
          dailyFiatMax: 20_000_000,
          dailyTxCountMax: 100,
        },
      } satisfies AppConfig['limits'];
    }
    return undefined;
  },
} as unknown as import('@nestjs/config').ConfigService<AppConfig, true>;

const stubClock: Clock = { now: () => FIXED_NOW };

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user-id-1',
    status: 'active',
    kycStatus: 'verified',
    kycTier: 'tier_1',
    simSwapDetectedAt: null,
    ...overrides,
  };
}

function makeIdentityRepo(user: UserRecord | null): IIdentityRepository {
  return {
    findActiveChannelIdentity: jest.fn(),
    loadUser: jest.fn().mockResolvedValue(user),
    loadContact: jest.fn(),
    createContactWithChannelIdentity: jest.fn(),
  };
}

function makeVelocityRepo(
  fiatTotal: number,
  txCount: number,
): IVelocityRepository {
  return {
    getDailyUsage: jest.fn().mockResolvedValue({ fiatTotal, txCount }),
  };
}

function makeService(
  user: UserRecord | null,
  fiatTotal = 0,
  txCount = 0,
): KycGateService {
  return new KycGateService(
    makeIdentityRepo(user),
    makeVelocityRepo(fiatTotal, txCount),
    stubConfig,
    stubClock,
  );
}

const BASE_INPUT = { userId: 'user-id-1', fiatAmount: 10_000, asset: 'USDT' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KycGateService.assertCanTransact', () => {
  it('resolves (no throw) for a verified tier_1 user with a small amount and low daily usage', async () => {
    const svc = makeService(makeUser(), 0, 0);
    await expect(svc.assertCanTransact(BASE_INPUT)).resolves.toBeUndefined();
  });

  // ── SIM swap ──────────────────────────────────────────────────────────────

  it('throws SimSwapBlockedError when user.simSwapDetectedAt is set', async () => {
    const svc = makeService(
      makeUser({ simSwapDetectedAt: new Date('2024-05-30T10:00:00Z') }),
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toThrow(
      SimSwapBlockedError,
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toMatchObject({
      code: 'SIM_SWAP_BLOCKED',
    });
  });

  // ── KYC status / tier ─────────────────────────────────────────────────────

  it('throws KycNotVerifiedError when kycStatus is pending', async () => {
    const svc = makeService(
      makeUser({ kycStatus: 'pending', kycTier: 'tier_1' }),
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toThrow(
      KycNotVerifiedError,
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toMatchObject({
      code: 'KYC_NOT_VERIFIED',
    });
  });

  it('throws KycNotVerifiedError when kycStatus is rejected', async () => {
    const svc = makeService(
      makeUser({ kycStatus: 'rejected', kycTier: 'tier_1' }),
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toThrow(
      KycNotVerifiedError,
    );
  });

  it('throws KycNotVerifiedError when kycStatus is verified but kycTier is unverified', async () => {
    const svc = makeService(
      makeUser({ kycStatus: 'verified', kycTier: 'unverified' }),
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toThrow(
      KycNotVerifiedError,
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toMatchObject({
      code: 'KYC_NOT_VERIFIED',
    });
  });

  it('throws KycNotVerifiedError when kycStatus is not_started', async () => {
    const svc = makeService(
      makeUser({ kycStatus: 'not_started', kycTier: 'unverified' }),
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toThrow(
      KycNotVerifiedError,
    );
  });

  // ── Per-tx limit ──────────────────────────────────────────────────────────

  it('throws TierLimitExceededError when fiatAmount exceeds perTxFiatMax', async () => {
    const svc = makeService(makeUser(), 0, 0);
    const input = { ...BASE_INPUT, fiatAmount: 50_001 }; // over tier_1 limit of 50_000
    await expect(svc.assertCanTransact(input)).rejects.toThrow(
      TierLimitExceededError,
    );
    await expect(svc.assertCanTransact(input)).rejects.toMatchObject({
      code: 'TIER_LIMIT_EXCEEDED',
      requestedAmount: 50_001,
      limitAmount: 50_000,
      tier: 'tier_1',
    });
  });

  it('does NOT throw TierLimitExceededError when fiatAmount equals perTxFiatMax exactly', async () => {
    const svc = makeService(makeUser(), 0, 0);
    const input = { ...BASE_INPUT, fiatAmount: 50_000 }; // exactly at limit
    await expect(svc.assertCanTransact(input)).resolves.toBeUndefined();
  });

  // ── Daily fiat velocity ───────────────────────────────────────────────────

  it('throws VelocityExceededError (fiat) when daily spend + fiatAmount would exceed dailyFiatMax', async () => {
    // 195_000 used + 10_000 requested = 205_000 > 200_000
    const svc = makeService(makeUser(), 195_000, 2);
    const input = { ...BASE_INPUT, fiatAmount: 10_000 };
    await expect(svc.assertCanTransact(input)).rejects.toThrow(
      VelocityExceededError,
    );
    await expect(svc.assertCanTransact(input)).rejects.toMatchObject({
      code: 'VELOCITY_EXCEEDED',
      kind: 'fiat',
      tier: 'tier_1',
    });
  });

  it('does NOT throw VelocityExceededError when daily fiat would hit exactly dailyFiatMax', async () => {
    // 190_000 used + 10_000 requested = 200_000 exactly at limit
    const svc = makeService(makeUser(), 190_000, 0);
    const input = { ...BASE_INPUT, fiatAmount: 10_000 };
    await expect(svc.assertCanTransact(input)).resolves.toBeUndefined();
  });

  // ── Daily tx count velocity ───────────────────────────────────────────────

  it('throws VelocityExceededError (count) when tx count + 1 would exceed dailyTxCountMax', async () => {
    // 10 used + 1 = 11 > 10 (tier_1 limit)
    const svc = makeService(makeUser(), 0, 10);
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toThrow(
      VelocityExceededError,
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toMatchObject({
      code: 'VELOCITY_EXCEEDED',
      kind: 'count',
      tier: 'tier_1',
    });
  });

  it('does NOT throw VelocityExceededError when txCount is 1 below the cap', async () => {
    // 9 used + 1 = 10 exactly at limit
    const svc = makeService(makeUser(), 0, 9);
    await expect(svc.assertCanTransact(BASE_INPUT)).resolves.toBeUndefined();
  });

  // ── Error hierarchy ───────────────────────────────────────────────────────

  it('all gate errors extend GateError', () => {
    expect(new SimSwapBlockedError()).toBeInstanceOf(GateError);
    expect(new KycNotVerifiedError('status')).toBeInstanceOf(GateError);
    expect(new TierLimitExceededError(1, 2, 'tier_1')).toBeInstanceOf(
      GateError,
    );
    expect(new VelocityExceededError('fiat', 1, 2, 'tier_1')).toBeInstanceOf(
      GateError,
    );
  });

  // ── Order of checks (sim-swap fires before KYC) ───────────────────────────

  it('SimSwapBlockedError fires before KycNotVerifiedError when both would trigger', async () => {
    const svc = makeService(
      makeUser({
        simSwapDetectedAt: new Date(),
        kycStatus: 'pending',
      }),
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toThrow(
      SimSwapBlockedError,
    );
  });

  // ── Missing user ──────────────────────────────────────────────────────────

  it('throws with a "not found" message when user cannot be found (repo returns null)', async () => {
    const svc = makeService(null);
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toThrow(
      /not found/i,
    );
  });
});
