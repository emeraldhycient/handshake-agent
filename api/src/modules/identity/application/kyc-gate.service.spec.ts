/**
 * Unit tests for KycGateService (task 2.2, §3.3).
 *
 * All external dependencies are mocked:
 *   - IDENTITY_REPOSITORY    → mock IIdentityRepository
 *   - VELOCITY_REPOSITORY    → mock IVelocityRepository
 *   - EffectiveConfigService → stub returning fixed (or overridden) limit values
 *   - CLOCK                  → stub returning a fixed Date
 *
 * Tests follow strict TDD: written first (red), then KycGateService is implemented.
 */

import type {
  IIdentityRepository,
  UserRecord,
} from './ports/identity.repository.port';
import type { IVelocityRepository } from './ports/velocity.repository.port';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { AppConfig } from '../../../core/config/configuration';
import type { Clock } from '../../../core/common/clock';
import {
  GateError,
  KycNotVerifiedError,
  OnChainSendLimitExceededError,
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

const DEFAULT_LIMITS: AppConfig['limits'] = {
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
};

/**
 * Builds an EffectiveConfigService stub returning `limits` from `get('limits')`.
 * Passing a custom `limits` simulates a DB `AppSetting` override flowing through
 * the layered config — the consumer reads it at the same call site.
 */
function makeConfig(
  limits: AppConfig['limits'] = DEFAULT_LIMITS,
): EffectiveConfigService {
  return {
    get: (key: string) => (key === 'limits' ? limits : undefined),
  } as unknown as EffectiveConfigService;
}

const stubConfig = makeConfig();

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
  originator:
    | import('./ports/identity.repository.port').OriginatorIdentityRecord
    | null = null,
): IIdentityRepository {
  return {
    findActiveChannelIdentity: jest.fn(),
    findWhatsAppAddressByUserId: jest.fn().mockResolvedValue(null),
    loadUser: jest.fn().mockResolvedValue(user),
    loadContact: jest.fn(),
    findKycProfile: jest.fn().mockResolvedValue(kycProfile),
    findOriginatorIdentity: jest.fn().mockResolvedValue(originator),
    createContactWithChannelIdentity: jest.fn(),
    // Admin reads/writes — unused by KycGateService; stubbed for type completeness.
    listUsers: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listUsersPendingKycReview: jest
      .fn()
      .mockResolvedValue({ items: [], nextCursor: null }),
    listKycReviewQueue: jest
      .fn()
      .mockResolvedValue({ items: [], nextCursor: null }),
    loadUserWithKycAndDevices: jest.fn().mockResolvedValue(null),
    hasSanctionsHit: jest.fn().mockResolvedValue(false),
    listDevicesForUser: jest.fn().mockResolvedValue([]),
    setUserStatus: jest.fn(),
    setKycTier: jest.fn(),
    setSimSwapDetectedAt: jest.fn(),
    revokeDevice: jest.fn(),
    unpinDevice: jest.fn(),
    resetKycToPending: jest.fn(),
  };
}

function makeVelocityRepo(
  fiatTotal: string,
  txCount: number,
  weeklyTotal = '0',
): IVelocityRepository {
  return {
    getDailyUsage: jest.fn().mockResolvedValue({ fiatTotal, txCount }),
    getWeeklyUsage: jest.fn().mockResolvedValue({ fiatTotal: weeklyTotal }),
  };
}

function makeService(
  user: UserRecord | null,
  fiatTotal = '0',
  txCount = 0,
  config: EffectiveConfigService = stubConfig,
  weeklyTotal = '0',
): KycGateService {
  return new KycGateService(
    makeIdentityRepo(user),
    makeVelocityRepo(fiatTotal, txCount, weeklyTotal),
    config,
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

  it('honors a DB AppSetting override to perTxFiatMax (EffectiveConfigService flows through the gate)', async () => {
    // Base allows 10_000 (tier_1 perTxFiatMax=50_000). An admin override lowers
    // perTxFiatMax to 5_000 — the SAME 10_000 amount must now be rejected,
    // proving the override flows through the consumer's get('limits') call.
    const overriddenLimits: AppConfig['limits'] = {
      NGN: {
        ...DEFAULT_LIMITS.NGN,
        tier_1: { ...TIER_1_LIMITS, perTxFiatMax: 5_000 },
      },
    };
    const svc = makeService(makeUser(), '0', 0, makeConfig(overriddenLimits));
    const input = { ...BASE_INPUT, fiatAmount: '10000' };
    await expect(svc.assertCanTransact(input)).rejects.toMatchObject({
      code: 'TIER_LIMIT_EXCEEDED',
      limitAmount: 5_000,
      tier: 'tier_1',
    });
  });

  // ── Positive-amount guard (finding #20) ──────────────────────────────────
  // The gate must fail closed on a non-positive fiat-equivalent regardless of
  // which money path called it. BUY/SELL are protected incidentally by the quote
  // domain, but SEND/SWAP route their fiat-equivalent straight through the gate —
  // a zero/negative amount must never pass the tier + velocity checks (§3.1/§3.3).

  it('throws TierLimitExceededError for a zero fiat amount (never gate-bypass)', async () => {
    const svc = makeService(makeUser(), '0', 0);
    const input = { ...BASE_INPUT, fiatAmount: '0' };
    await expect(svc.assertCanTransact(input)).rejects.toThrow(
      TierLimitExceededError,
    );
    await expect(svc.assertCanTransact(input)).rejects.toMatchObject({
      code: 'TIER_LIMIT_EXCEEDED',
    });
  });

  it('throws TierLimitExceededError for a "0.00" fiat amount (scaled-zero)', async () => {
    const svc = makeService(makeUser(), '0', 0);
    const input = { ...BASE_INPUT, fiatAmount: '0.00' };
    await expect(svc.assertCanTransact(input)).rejects.toThrow(
      TierLimitExceededError,
    );
  });

  it('throws TierLimitExceededError for a negative fiat amount', async () => {
    const svc = makeService(makeUser(), '0', 0);
    const input = { ...BASE_INPUT, fiatAmount: '-100' };
    await expect(svc.assertCanTransact(input)).rejects.toThrow(
      TierLimitExceededError,
    );
  });

  it('the positive-amount guard fires AFTER the KYC/tier gate (still blocks unverified first)', async () => {
    // A zero amount from an unverified user surfaces the KYC error, not the
    // amount error — KYC is the higher-severity gate and runs first.
    const svc = makeService(
      makeUser({ kycStatus: 'verified', kycTier: 'unverified' }),
    );
    await expect(
      svc.assertCanTransact({ ...BASE_INPUT, fiatAmount: '0' }),
    ).rejects.toThrow(KycNotVerifiedError);
  });

  it('the positive-amount guard does NOT increment velocity (rejects before usage load)', async () => {
    const velocityRepo = makeVelocityRepo('0', 0);
    const svc = new KycGateService(
      makeIdentityRepo(makeUser()),
      velocityRepo,
      stubConfig,
      stubClock,
    );
    await expect(
      svc.assertCanTransact({ ...BASE_INPUT, fiatAmount: '0' }),
    ).rejects.toThrow(TierLimitExceededError);
    expect(velocityRepo.getDailyUsage).not.toHaveBeenCalled();
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

  // ── Rolling 7-day (weekly) velocity ───────────────────────────────────────
  // A weekly cap is enforced only when the tier config carries `weeklyFiatMax`.

  const WEEKLY_LIMITS: AppConfig['limits'] = {
    NGN: {
      tier_1: { ...TIER_1_LIMITS, weeklyFiatMax: 1_000_000 },
      tier_2: DEFAULT_LIMITS.NGN.tier_2,
      tier_3: DEFAULT_LIMITS.NGN.tier_3,
    },
  };

  it('throws VelocityExceededError (weekly) when rolling-7d spend + amount would exceed weeklyFiatMax', async () => {
    // 995_000 used this week + 10_000 = 1_005_000 > 1_000_000 weekly cap. Daily usage
    // is 0 and the amount is under perTx/daily, so ONLY the weekly cap trips.
    const svc = makeService(
      makeUser(),
      '0',
      0,
      makeConfig(WEEKLY_LIMITS),
      '995000',
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toThrow(
      VelocityExceededError,
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toMatchObject({
      code: 'VELOCITY_EXCEEDED',
      kind: 'weekly',
      limit: 1_000_000,
      tier: 'tier_1',
      fiatCurrency: 'NGN',
    });
  });

  it('does NOT throw when rolling-7d spend + amount equals weeklyFiatMax exactly', async () => {
    // 990_000 + 10_000 = 1_000_000 exactly at the cap (> is the boundary, not >=).
    const svc = makeService(
      makeUser(),
      '0',
      0,
      makeConfig(WEEKLY_LIMITS),
      '990000',
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).resolves.toBeUndefined();
  });

  it('skips the weekly check entirely when the tier has no weeklyFiatMax', async () => {
    // Default tier_1 config has NO weeklyFiatMax; even a huge weekly total passes —
    // the weekly gate is enforced only where the cap is configured.
    const svc = makeService(makeUser(), '0', 0, stubConfig, '999999999');
    await expect(svc.assertCanTransact(BASE_INPUT)).resolves.toBeUndefined();
  });

  it('honors a DB AppSetting override to weeklyFiatMax (flows through the gate)', async () => {
    // Override lowers the weekly cap to 12_000; a 10_000 amount on top of 5_000 of
    // weekly usage (15_000) must now be rejected.
    const lowered: AppConfig['limits'] = {
      NGN: {
        tier_1: { ...TIER_1_LIMITS, weeklyFiatMax: 12_000 },
        tier_2: DEFAULT_LIMITS.NGN.tier_2,
        tier_3: DEFAULT_LIMITS.NGN.tier_3,
      },
    };
    const svc = makeService(makeUser(), '0', 0, makeConfig(lowered), '5000');
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toMatchObject({
      code: 'VELOCITY_EXCEEDED',
      kind: 'weekly',
      limit: 12_000,
    });
  });

  // ── Single on-chain send cap (perSendOnChainFiatMax) ──────────────────────
  // Applies ONLY to on-chain (crypto-address) sends — irreversible, so tighter.

  const ONCHAIN_LIMITS: AppConfig['limits'] = {
    NGN: {
      tier_1: { ...TIER_1_LIMITS, perSendOnChainFiatMax: 30_000 },
      tier_2: DEFAULT_LIMITS.NGN.tier_2,
      tier_3: DEFAULT_LIMITS.NGN.tier_3,
    },
  };

  it('throws OnChainSendLimitExceededError when an on-chain send exceeds perSendOnChainFiatMax', async () => {
    // 40_000 is under perTx (50_000) but over the on-chain cap (30_000).
    const svc = makeService(makeUser(), '0', 0, makeConfig(ONCHAIN_LIMITS));
    const input = { ...BASE_INPUT, fiatAmount: '40000', onChainSend: true };
    await expect(svc.assertCanTransact(input)).rejects.toBeInstanceOf(
      OnChainSendLimitExceededError,
    );
    await expect(svc.assertCanTransact(input)).rejects.toMatchObject({
      code: 'SEND_LIMIT_EXCEEDED',
      limitAmount: 30_000,
      tier: 'tier_1',
      fiatCurrency: 'NGN',
    });
  });

  it('does NOT apply the on-chain cap to a non-send tx (buy/sell/swap) of the same amount', async () => {
    // Same 40_000, but NOT an on-chain send → only the general perTx cap (50_000)
    // applies, which it passes. The on-chain cap must never gate a buy/sell/swap.
    const svc = makeService(makeUser(), '0', 0, makeConfig(ONCHAIN_LIMITS));
    const input = { ...BASE_INPUT, fiatAmount: '40000' }; // onChainSend absent
    await expect(svc.assertCanTransact(input)).resolves.toBeUndefined();
  });

  it('does NOT throw when an on-chain send equals perSendOnChainFiatMax exactly', async () => {
    const svc = makeService(makeUser(), '0', 0, makeConfig(ONCHAIN_LIMITS));
    const input = { ...BASE_INPUT, fiatAmount: '30000', onChainSend: true };
    await expect(svc.assertCanTransact(input)).resolves.toBeUndefined();
  });

  it('skips the on-chain cap when the tier has no perSendOnChainFiatMax', async () => {
    // Default tier_1 config (no perSendOnChainFiatMax); a 40_000 on-chain send passes
    // (only perTx 50_000 applies).
    const svc = makeService(makeUser(), '0', 0);
    const input = { ...BASE_INPUT, fiatAmount: '40000', onChainSend: true };
    await expect(svc.assertCanTransact(input)).resolves.toBeUndefined();
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
      { getDailyUsage: jest.fn(), getWeeklyUsage: jest.fn() },
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
      { getDailyUsage: jest.fn(), getWeeklyUsage: jest.fn() },
      stubConfig,
      stubClock,
    );
    await expect(svc.getOriginatorName(USER_ID)).resolves.toBe('Chisom');
  });

  it('returns null when KycProfile row does not exist', async () => {
    const identityRepo = makeIdentityRepo(defaultUser, null);
    const svc = new KycGateService(
      identityRepo,
      { getDailyUsage: jest.fn(), getWeeklyUsage: jest.fn() },
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
      { getDailyUsage: jest.fn(), getWeeklyUsage: jest.fn() },
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
      { getDailyUsage: jest.fn(), getWeeklyUsage: jest.fn() },
      stubConfig,
      stubClock,
    );
    await expect(svc.getOriginatorName(USER_ID)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// KycGateService.getOriginatorIdentity — payment-provider customer attribution
// ---------------------------------------------------------------------------

describe('KycGateService.getOriginatorIdentity', () => {
  const USER_ID = 'user-id-1';
  const defaultUser = makeUser();

  function makeService(
    originator:
      | import('./ports/identity.repository.port').OriginatorIdentityRecord
      | null,
  ): KycGateService {
    return new KycGateService(
      makeIdentityRepo(defaultUser, null, originator),
      { getDailyUsage: jest.fn(), getWeeklyUsage: jest.fn() },
      stubConfig,
      stubClock,
    );
  }

  it('returns the real KYC name and prefers the verified backup email', async () => {
    const svc = makeService({
      firstName: 'Emeka',
      lastName: 'Adeyemi',
      verifiedEmail: 'emeka.kyc@example.com',
      email: 'emeka.login@example.com',
    });
    await expect(svc.getOriginatorIdentity(USER_ID)).resolves.toEqual({
      firstName: 'Emeka',
      lastName: 'Adeyemi',
      email: 'emeka.kyc@example.com',
    });
  });

  it('falls back to the login email when no verified backup email exists', async () => {
    const svc = makeService({
      firstName: 'Chisom',
      lastName: 'Okafor',
      verifiedEmail: null,
      email: 'chisom.login@example.com',
    });
    await expect(svc.getOriginatorIdentity(USER_ID)).resolves.toEqual({
      firstName: 'Chisom',
      lastName: 'Okafor',
      email: 'chisom.login@example.com',
    });
  });

  it('resolves email to null when neither email column is set', async () => {
    const svc = makeService({
      firstName: 'Ada',
      lastName: null,
      verifiedEmail: null,
      email: null,
    });
    await expect(svc.getOriginatorIdentity(USER_ID)).resolves.toEqual({
      firstName: 'Ada',
      lastName: null,
      email: null,
    });
  });

  it('returns an all-null projection when the user row does not exist', async () => {
    const svc = makeService(null);
    await expect(svc.getOriginatorIdentity(USER_ID)).resolves.toEqual({
      firstName: null,
      lastName: null,
      email: null,
    });
  });
});
