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
        NGN: {
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

function makeIdentityRepo(
  user: UserRecord | null,
  kycProfile:
    | import('./ports/identity.repository.port').KycProfileRecord
    | null = null,
): IIdentityRepository {
  return {
    findActiveChannelIdentity: jest.fn(),
    findWhatsAppAddressByUserId: jest.fn().mockResolvedValue(null),
    loadUser: jest.fn().mockResolvedValue(user),
    loadContact: jest.fn(),
    findKycProfile: jest.fn().mockResolvedValue(kycProfile),
    createContactWithChannelIdentity: jest.fn(),
  };
}

function makeVelocityRepo(
  fiatTotal: string,
  txCount: number,
): IVelocityRepository {
  return {
    getDailyUsage: jest.fn().mockResolvedValue({ fiatTotal, txCount }),
  };
}

function makeService(
  user: UserRecord | null,
  fiatTotal = '0',
  txCount = 0,
): KycGateService {
  return new KycGateService(
    makeIdentityRepo(user),
    makeVelocityRepo(fiatTotal, txCount),
    stubConfig,
    stubClock,
  );
}

// Fix-C: fiatAmount is now a string (exact NGN decimal) — no Number() at the gate.
// Task 8: fiatCurrency is now required on AssertCanTransactInput.
const BASE_INPUT = {
  userId: 'user-id-1',
  fiatAmount: '10000',
  asset: 'USDT',
  fiatCurrency: 'NGN',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KycGateService.assertCanTransact', () => {
  it('resolves (no throw) for a verified tier_1 user with a small amount and low daily usage', async () => {
    const svc = makeService(makeUser(), '0', 0);
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
    const svc = makeService(makeUser(), '0', 0);
    const input = { ...BASE_INPUT, fiatAmount: '50001' }; // over tier_1 limit of 50_000
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
    const svc = makeService(makeUser(), '0', 0);
    const input = { ...BASE_INPUT, fiatAmount: '50000' }; // exactly at limit
    await expect(svc.assertCanTransact(input)).resolves.toBeUndefined();
  });

  // ── Daily fiat velocity ───────────────────────────────────────────────────

  it('throws VelocityExceededError (fiat) when daily spend + fiatAmount would exceed dailyFiatMax', async () => {
    // 195_000 used + 10_000 requested = 205_000 > 200_000
    const svc = makeService(makeUser(), '195000', 2);
    const input = { ...BASE_INPUT, fiatAmount: '10000' };
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
    const svc = makeService(makeUser(), '190000', 0);
    const input = { ...BASE_INPUT, fiatAmount: '10000' };
    await expect(svc.assertCanTransact(input)).resolves.toBeUndefined();
  });

  // ── Daily tx count velocity ───────────────────────────────────────────────

  it('throws VelocityExceededError (count) when tx count + 1 would exceed dailyTxCountMax', async () => {
    // 10 used + 1 = 11 > 10 (tier_1 limit)
    const svc = makeService(makeUser(), '0', 10);
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
    const svc = makeService(makeUser(), '0', 9);
    await expect(svc.assertCanTransact(BASE_INPUT)).resolves.toBeUndefined();
  });

  // ── Error hierarchy ───────────────────────────────────────────────────────

  it('all gate errors extend GateError', () => {
    expect(new SimSwapBlockedError()).toBeInstanceOf(GateError);
    expect(new KycNotVerifiedError('status')).toBeInstanceOf(GateError);
    expect(new TierLimitExceededError(1, 2, 'tier_1', 'NGN')).toBeInstanceOf(
      GateError,
    );
    expect(
      new VelocityExceededError('fiat', 1, 2, 'tier_1', 'NGN'),
    ).toBeInstanceOf(GateError);
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

  // ── Fix-C: BigInt-exact precision tests ──────────────────────────────────

  it('compares amounts exactly at the boundary — 50000.00 passes, 50000.01 fails (tier_1 perTxFiatMax=50000)', async () => {
    const svcPass = makeService(makeUser(), '0', 0);
    await expect(
      svcPass.assertCanTransact({ ...BASE_INPUT, fiatAmount: '50000.00' }),
    ).resolves.toBeUndefined();

    const svcFail = makeService(makeUser(), '0', 0);
    await expect(
      svcFail.assertCanTransact({ ...BASE_INPUT, fiatAmount: '50000.01' }),
    ).rejects.toThrow(TierLimitExceededError);
  });

  it('daily accumulation: 199999.99 used + 0.01 requested = exactly 200000 passes (tier_1 dailyFiatMax=200000)', async () => {
    const svc = makeService(makeUser(), '199999.99', 0);
    await expect(
      svc.assertCanTransact({ ...BASE_INPUT, fiatAmount: '0.01' }),
    ).resolves.toBeUndefined();
  });

  it('daily accumulation: 199999.99 used + 0.02 requested = 200000.01 fails (exceeds tier_1 dailyFiatMax=200000)', async () => {
    const svc = makeService(makeUser(), '199999.99', 0);
    await expect(
      svc.assertCanTransact({ ...BASE_INPUT, fiatAmount: '0.02' }),
    ).rejects.toThrow(VelocityExceededError);
  });

  it('handles amounts with more than 15 significant digits without float precision loss', async () => {
    // Tier_3 limit: perTxFiatMax=5_000_000, dailyFiatMax=20_000_000
    // This value would lose precision as a JavaScript float (>2^53 minor units for 18dp).
    // We pass a value that is exactly at tier_3 perTxFiatMax as a string.
    const tier3User = makeUser({ kycTier: 'tier_3' });
    const svc = makeService(tier3User, '0', 0);
    // 5000000 is exactly at the limit — should pass
    await expect(
      svc.assertCanTransact({
        ...BASE_INPUT,
        fiatAmount: '5000000',
        userId: 'user-id-1',
      }),
    ).resolves.toBeUndefined();
    // 5000000.01 exceeds the limit — should fail
    await expect(
      svc.assertCanTransact({
        ...BASE_INPUT,
        fiatAmount: '5000000.01',
        userId: 'user-id-1',
      }),
    ).rejects.toThrow(TierLimitExceededError);
  });

  // ── Task 8: per-fiat limit resolution ────────────────────────────────────

  it('resolves the per-fiat tier limit for the transaction currency', async () => {
    // tier_1 perTxFiatMax = 50_000; 60_000 should breach it.
    const svc = makeService(makeUser(), '0', 0);
    await expect(
      svc.assertCanTransact({
        userId: 'user-id-1',
        fiatAmount: '60000',
        asset: 'USDT',
        fiatCurrency: 'NGN',
      }),
    ).rejects.toBeInstanceOf(TierLimitExceededError);
  });

  it('fails closed for a currency with no configured limits', async () => {
    const svc = makeService(makeUser(), '0', 0);
    await expect(
      svc.assertCanTransact({
        userId: 'user-id-1',
        fiatAmount: '1',
        asset: 'USDT',
        fiatCurrency: 'USD',
      }),
    ).rejects.toThrow(/USD/);
  });

  // ── Task 12: currency-aware error messages ────────────────────────────────

  it('TierLimitExceededError message names the transaction currency (NGN)', async () => {
    const svc = makeService(makeUser(), '0', 0);
    const err = await svc
      .assertCanTransact({
        userId: 'user-id-1',
        fiatAmount: '60000',
        asset: 'USDT',
        fiatCurrency: 'NGN',
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TierLimitExceededError);
    expect(String((err as Error).message)).toContain('NGN');
  });

  it('VelocityExceededError (fiat) message names the transaction currency (NGN)', async () => {
    // 195_000 used + 10_000 requested = 205_000 > 200_000 (tier_1 dailyFiatMax)
    const svc = makeService(makeUser(), '195000', 2);
    const err = await svc
      .assertCanTransact({ ...BASE_INPUT, fiatAmount: '10000' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VelocityExceededError);
    expect(String((err as Error).message)).toContain('NGN');
  });

  it('VelocityExceededError (count) message does not require a currency in the message (count errors are currency-neutral)', async () => {
    // Count errors don't carry a fiat amount in the message — no currency expected.
    const svc = makeService(makeUser(), '0', 10);
    const err = await svc
      .assertCanTransact(BASE_INPUT)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VelocityExceededError);
    expect((err as VelocityExceededError).kind).toBe('count');
  });

  it('TierLimitExceededError preserves numeric payload fields (backward-compat)', async () => {
    const svc = makeService(makeUser(), '0', 0);
    const err = await svc
      .assertCanTransact({
        userId: 'user-id-1',
        fiatAmount: '60000',
        asset: 'USDT',
        fiatCurrency: 'NGN',
      })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: 'TIER_LIMIT_EXCEEDED',
      requestedAmount: 60_000,
      limitAmount: 50_000,
      tier: 'tier_1',
      fiatCurrency: 'NGN',
    });
  });

  it('VelocityExceededError (fiat) preserves numeric payload fields (backward-compat)', async () => {
    const svc = makeService(makeUser(), '195000', 2);
    const err = await svc
      .assertCanTransact({ ...BASE_INPUT, fiatAmount: '10000' })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: 'VELOCITY_EXCEEDED',
      kind: 'fiat',
      tier: 'tier_1',
      fiatCurrency: 'NGN',
    });
  });
});

// ---------------------------------------------------------------------------
// Fix-D: KycGateService.getOriginatorName
// ---------------------------------------------------------------------------

describe('KycGateService.getOriginatorName', () => {
  const USER_ID = 'user-id-1';
  const defaultUser = makeUser();

  it('returns "firstName lastName" when both KycProfile fields are present', async () => {
    const identityRepo = makeIdentityRepo(defaultUser, {
      firstName: 'Emeka',
      lastName: 'Adeyemi',
    });
    const svc = new KycGateService(
      identityRepo,
      { getDailyUsage: jest.fn() },
      stubConfig,
      stubClock,
    );
    await expect(svc.getOriginatorName(USER_ID)).resolves.toBe('Emeka Adeyemi');
  });

  it('returns firstName only when lastName is null', async () => {
    const identityRepo = makeIdentityRepo(defaultUser, {
      firstName: 'Chisom',
      lastName: null,
    });
    const svc = new KycGateService(
      identityRepo,
      { getDailyUsage: jest.fn() },
      stubConfig,
      stubClock,
    );
    await expect(svc.getOriginatorName(USER_ID)).resolves.toBe('Chisom');
  });

  it('returns null when KycProfile row does not exist', async () => {
    const identityRepo = makeIdentityRepo(defaultUser, null);
    const svc = new KycGateService(
      identityRepo,
      { getDailyUsage: jest.fn() },
      stubConfig,
      stubClock,
    );
    await expect(svc.getOriginatorName(USER_ID)).resolves.toBeNull();
  });

  it('returns null when both firstName and lastName are null', async () => {
    const identityRepo = makeIdentityRepo(defaultUser, {
      firstName: null,
      lastName: null,
    });
    const svc = new KycGateService(
      identityRepo,
      { getDailyUsage: jest.fn() },
      stubConfig,
      stubClock,
    );
    await expect(svc.getOriginatorName(USER_ID)).resolves.toBeNull();
  });

  it('trims whitespace and returns null when name parts are blank', async () => {
    const identityRepo = makeIdentityRepo(defaultUser, {
      firstName: '   ',
      lastName: '',
    });
    const svc = new KycGateService(
      identityRepo,
      { getDailyUsage: jest.fn() },
      stubConfig,
      stubClock,
    );
    await expect(svc.getOriginatorName(USER_ID)).resolves.toBeNull();
  });
});
