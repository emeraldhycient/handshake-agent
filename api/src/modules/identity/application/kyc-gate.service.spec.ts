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
import type {
  AppConfig,
  GatingConfig,
} from '../../../core/config/configuration';
import type { Clock } from '../../../core/common/clock';
import {
  CapabilityTierError,
  GateError,
  KycNotVerifiedError,
  OnChainSendLimitExceededError,
  SimSwapBlockedError,
  TierChangeCoolingOffError,
  TierLimitExceededError,
  VelocityExceededError,
} from '../domain/gate-errors';
import {
  KycGateService,
  type AssertCanTransactInput,
} from './kyc-gate.service';

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

// Task 1.3: mirrors the real code-default `gating.capabilityMinTier` map
// (configuration.ts) — buy/receive need tier_1, sell/send/swap need tier_2.
const DEFAULT_GATING: GatingConfig = {
  capabilityMinTier: {
    'crypto.buy': 'tier_1',
    'crypto.receive': 'tier_1',
    'crypto.sell': 'tier_2',
    'crypto.send': 'tier_2',
    'crypto.swap': 'tier_2',
  },
};

/**
 * Builds an EffectiveConfigService stub returning `limits`/`gating` from
 * `get('limits')`/`get('gating')`. Passing custom values simulates a DB
 * `AppSetting` override flowing through the layered config — the consumer reads
 * it at the same call site.
 */
function makeConfig(
  limits: AppConfig['limits'] = DEFAULT_LIMITS,
  tierChangeCoolingOffSeconds = 0,
  gating: GatingConfig = DEFAULT_GATING,
): EffectiveConfigService {
  return {
    get: (key: string) => {
      if (key === 'limits') return limits;
      if (key === 'compliance') return { tierChangeCoolingOffSeconds };
      if (key === 'gating') return gating;
      return undefined;
    },
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
    tierChangedAt: null,
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
    // Profile settings (Wave C) — unused by KycGateService; stubbed for type completeness.
    findProfileSettings: jest.fn().mockResolvedValue(null),
    updateProfileSettings: jest.fn().mockResolvedValue(undefined),
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
  recentSendCount = 0,
): IVelocityRepository {
  return {
    getDailyUsage: jest.fn().mockResolvedValue({ fiatTotal, txCount }),
    getWeeklyUsage: jest.fn().mockResolvedValue({ fiatTotal: weeklyTotal }),
    getRecentSendCount: jest.fn().mockResolvedValue(recentSendCount),
  };
}

function makeService(
  user: UserRecord | null,
  fiatTotal = '0',
  txCount = 0,
  config: EffectiveConfigService = stubConfig,
  weeklyTotal = '0',
  recentSendCount = 0,
): KycGateService {
  return new KycGateService(
    makeIdentityRepo(user),
    makeVelocityRepo(fiatTotal, txCount, weeklyTotal, recentSendCount),
    config,
    stubClock,
  );
}

// Fix-C: fiatAmount is now a string (exact NGN decimal) — no Number() at the gate.
// Task 8: fiatCurrency is now required on AssertCanTransactInput.
// Task 1.3: capability is now required — 'crypto.buy' (tier_1) is the default so
// existing limit/velocity tests (which exercise a tier_1 user) keep resolving.
const BASE_INPUT: AssertCanTransactInput = {
  userId: 'user-id-1',
  fiatAmount: '10000',
  asset: 'USDT',
  fiatCurrency: 'NGN',
  capability: 'crypto.buy',
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

  // ── Capability → minimum-tier gate (Task 1.3) ────────────────────────────
  // Replaces the old `kycStatus !== 'verified'` hard block: a tier_1 (email-
  // verified) user may use tier_1 capabilities (buy/receive) regardless of
  // kycStatus; tier_2 capabilities (sell/send/swap) require tier_2. `unverified`
  // fails `tierAtLeast` for every configured capability, so it stays blocked
  // everywhere with no separate status check.

  it('a tier_1 user may buy even when kycStatus is not verified (status is no longer gated)', async () => {
    const svc = makeService(
      makeUser({ kycStatus: 'pending', kycTier: 'tier_1' }),
    );
    await expect(
      svc.assertCanTransact({ ...BASE_INPUT, capability: 'crypto.buy' }),
    ).resolves.toBeUndefined();
  });

  it('a tier_1 user may NOT send (crypto.send requires tier_2)', async () => {
    const svc = makeService(makeUser({ kycTier: 'tier_1' }));
    await expect(
      svc.assertCanTransact({ ...BASE_INPUT, capability: 'crypto.send' }),
    ).rejects.toBeInstanceOf(CapabilityTierError);
    await expect(
      svc.assertCanTransact({ ...BASE_INPUT, capability: 'crypto.send' }),
    ).rejects.toMatchObject({
      code: 'CAPABILITY_TIER_REQUIRED',
      capability: 'crypto.send',
      requiredTier: 'tier_2',
      actualTier: 'tier_1',
    });
  });

  it('a tier_1 user may NOT sell (crypto.sell requires tier_2)', async () => {
    const svc = makeService(makeUser({ kycTier: 'tier_1' }));
    await expect(
      svc.assertCanTransact({ ...BASE_INPUT, capability: 'crypto.sell' }),
    ).rejects.toBeInstanceOf(CapabilityTierError);
  });

  it('a tier_1 user may NOT swap (crypto.swap requires tier_2)', async () => {
    const svc = makeService(makeUser({ kycTier: 'tier_1' }));
    await expect(
      svc.assertCanTransact({ ...BASE_INPUT, capability: 'crypto.swap' }),
    ).rejects.toBeInstanceOf(CapabilityTierError);
    await expect(
      svc.assertCanTransact({ ...BASE_INPUT, capability: 'crypto.swap' }),
    ).rejects.toMatchObject({
      code: 'CAPABILITY_TIER_REQUIRED',
      capability: 'crypto.swap',
      requiredTier: 'tier_2',
      actualTier: 'tier_1',
    });
  });

  it('a tier_2 user may send, sell, and swap', async () => {
    const svc = makeService(makeUser({ kycTier: 'tier_2' }));
    for (const capability of [
      'crypto.send',
      'crypto.sell',
      'crypto.swap',
    ] as const) {
      await expect(
        svc.assertCanTransact({ ...BASE_INPUT, capability }),
      ).resolves.toBeUndefined();
    }
  });

  it('an unverified user may not buy', async () => {
    const svc = makeService(
      makeUser({ kycStatus: 'verified', kycTier: 'unverified' }),
    );
    await expect(
      svc.assertCanTransact({ ...BASE_INPUT, capability: 'crypto.buy' }),
    ).rejects.toBeInstanceOf(CapabilityTierError);
    await expect(
      svc.assertCanTransact({ ...BASE_INPUT, capability: 'crypto.buy' }),
    ).rejects.toMatchObject({
      code: 'CAPABILITY_TIER_REQUIRED',
      capability: 'crypto.buy',
      requiredTier: 'tier_1',
      actualTier: 'unverified',
    });
  });

  it('an unverified user is blocked from every capability (no separate status check needed)', async () => {
    const svc = makeService(makeUser({ kycTier: 'unverified' }));
    for (const capability of [
      'crypto.buy',
      'crypto.receive',
      'crypto.sell',
      'crypto.send',
      'crypto.swap',
    ] as const) {
      await expect(
        svc.assertCanTransact({ ...BASE_INPUT, capability }),
      ).rejects.toBeInstanceOf(CapabilityTierError);
    }
  });

  it('fails closed to tier_2 when a capability has no configured gating entry', async () => {
    const svc = makeService(
      makeUser({ kycTier: 'tier_1' }),
      '0',
      0,
      makeConfig(DEFAULT_LIMITS, 0, { capabilityMinTier: {} }),
    );
    await expect(
      svc.assertCanTransact({ ...BASE_INPUT, capability: 'crypto.buy' }),
    ).rejects.toMatchObject({
      code: 'CAPABILITY_TIER_REQUIRED',
      requiredTier: 'tier_2',
    });
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

  it('the positive-amount guard fires AFTER the capability-tier gate (still blocks unverified first)', async () => {
    // A zero amount from an unverified user surfaces the capability-tier error,
    // not the amount error — the tier gate is higher-severity and runs first.
    const svc = makeService(
      makeUser({ kycStatus: 'verified', kycTier: 'unverified' }),
    );
    await expect(
      svc.assertCanTransact({ ...BASE_INPUT, fiatAmount: '0' }),
    ).rejects.toThrow(CapabilityTierError);
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

  // ── Rolling 10-minute on-chain send-count velocity (sendsPer10MinMax) ──────

  const SENDS_LIMITS: AppConfig['limits'] = {
    NGN: {
      tier_1: { ...TIER_1_LIMITS, sendsPer10MinMax: 3 },
      tier_2: DEFAULT_LIMITS.NGN.tier_2,
      tier_3: DEFAULT_LIMITS.NGN.tier_3,
    },
  };

  it('throws VelocityExceededError (sends_10min) when this on-chain send would exceed sendsPer10MinMax', async () => {
    // 3 sends already in the last 10 min + this one = 4 > 3 cap.
    const svc = makeService(
      makeUser(),
      '0',
      0,
      makeConfig(SENDS_LIMITS),
      '0',
      3,
    );
    const input = { ...BASE_INPUT, onChainSend: true };
    await expect(svc.assertCanTransact(input)).rejects.toThrow(
      VelocityExceededError,
    );
    await expect(svc.assertCanTransact(input)).rejects.toMatchObject({
      code: 'VELOCITY_EXCEEDED',
      kind: 'sends_10min',
      limit: 3,
      tier: 'tier_1',
    });
  });

  it('does NOT apply the 10-min send cap to a non-send tx (buy/sell/swap)', async () => {
    // A huge recent-send count, but this is NOT an on-chain send → the cap never gates it.
    const svc = makeService(
      makeUser(),
      '0',
      0,
      makeConfig(SENDS_LIMITS),
      '0',
      99,
    );
    await expect(
      svc.assertCanTransact(BASE_INPUT), // onChainSend absent
    ).resolves.toBeUndefined();
  });

  it('does NOT throw when this on-chain send lands exactly on sendsPer10MinMax', async () => {
    // 2 sends already + this one = 3 = cap (> is the boundary, not >=).
    const svc = makeService(
      makeUser(),
      '0',
      0,
      makeConfig(SENDS_LIMITS),
      '0',
      2,
    );
    const input = { ...BASE_INPUT, onChainSend: true };
    await expect(svc.assertCanTransact(input)).resolves.toBeUndefined();
  });

  it('skips the 10-min send cap when the tier has no sendsPer10MinMax', async () => {
    // Default tier_1 has no sendsPer10MinMax; even a huge recent-send count passes.
    const svc = makeService(makeUser(), '0', 0, stubConfig, '0', 99);
    const input = { ...BASE_INPUT, onChainSend: true };
    await expect(svc.assertCanTransact(input)).resolves.toBeUndefined();
  });

  // ── Tier-change cooling-off (compliance.tierChangeCoolingOffSeconds) ──────
  // Blocks ALL money moves for a window after the KYC tier last changed.

  it('throws TierChangeCoolingOffError when within the cooling-off window after a tier change', async () => {
    // tier changed 1h ago; 2h cooling-off → still held (hold until 13:00 > now 12:00).
    const changedAt = new Date(FIXED_NOW.getTime() - 60 * 60 * 1000);
    const svc = makeService(
      makeUser({ tierChangedAt: changedAt }),
      '0',
      0,
      makeConfig(DEFAULT_LIMITS, 7200),
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toBeInstanceOf(
      TierChangeCoolingOffError,
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).rejects.toMatchObject({
      code: 'TIER_CHANGE_COOLING_OFF',
    });
  });

  it('does NOT throw once the cooling-off window has elapsed', async () => {
    // tier changed 3h ago; 2h cooling-off → elapsed (hold until 11:00 < now 12:00).
    const changedAt = new Date(FIXED_NOW.getTime() - 3 * 60 * 60 * 1000);
    const svc = makeService(
      makeUser({ tierChangedAt: changedAt }),
      '0',
      0,
      makeConfig(DEFAULT_LIMITS, 7200),
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).resolves.toBeUndefined();
  });

  it('does NOT hold when the cooling-off is 0 (disabled), even right after a tier change', async () => {
    const svc = makeService(
      makeUser({ tierChangedAt: FIXED_NOW }),
      '0',
      0,
      makeConfig(DEFAULT_LIMITS, 0),
    );
    await expect(svc.assertCanTransact(BASE_INPUT)).resolves.toBeUndefined();
  });

  it('does NOT hold a user whose tier has never changed (tierChangedAt null)', async () => {
    const svc = makeService(
      makeUser({ tierChangedAt: null }),
      '0',
      0,
      makeConfig(DEFAULT_LIMITS, 7200),
    );
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
    expect(
      new CapabilityTierError('crypto.send', 'tier_2', 'tier_1'),
    ).toBeInstanceOf(GateError);
  });

  // ── Order of checks (sim-swap fires before the capability-tier gate) ─────

  it('SimSwapBlockedError fires before the capability-tier gate when both would trigger', async () => {
    const svc = makeService(
      makeUser({
        simSwapDetectedAt: new Date(),
        kycTier: 'unverified',
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
        capability: 'crypto.buy',
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
        capability: 'crypto.buy',
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
        capability: 'crypto.buy',
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
        capability: 'crypto.buy',
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
      {
        getDailyUsage: jest.fn(),
        getWeeklyUsage: jest.fn(),
        getRecentSendCount: jest.fn(),
      },
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
      {
        getDailyUsage: jest.fn(),
        getWeeklyUsage: jest.fn(),
        getRecentSendCount: jest.fn(),
      },
      stubConfig,
      stubClock,
    );
    await expect(svc.getOriginatorName(USER_ID)).resolves.toBe('Chisom');
  });

  it('returns null when KycProfile row does not exist', async () => {
    const identityRepo = makeIdentityRepo(defaultUser, null);
    const svc = new KycGateService(
      identityRepo,
      {
        getDailyUsage: jest.fn(),
        getWeeklyUsage: jest.fn(),
        getRecentSendCount: jest.fn(),
      },
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
      {
        getDailyUsage: jest.fn(),
        getWeeklyUsage: jest.fn(),
        getRecentSendCount: jest.fn(),
      },
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
      {
        getDailyUsage: jest.fn(),
        getWeeklyUsage: jest.fn(),
        getRecentSendCount: jest.fn(),
      },
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
      {
        getDailyUsage: jest.fn(),
        getWeeklyUsage: jest.fn(),
        getRecentSendCount: jest.fn(),
      },
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

// ---------------------------------------------------------------------------
// assertCanReleasePayout — velocity-free re-check for retrying a stuck payout
// (go-readiness #2). Reuses the baseline (SIM/KYC/tier/cooling-off/per-tx) but
// intentionally SKIPS the cumulative velocity counters (this tx already consumed
// its allocation at execute time) — re-running them would double-count and block.
// ---------------------------------------------------------------------------

describe('KycGateService.assertCanReleasePayout', () => {
  // Task 1.3: payout retries are only issued for sell/send transactions (both
  // capability-gated to tier_2 — see AdminTreasuryPayoutRetryService), so the
  // fixture defaults to 'crypto.sell' with a tier_2 user; the existing per-tx /
  // velocity-skip assertions are bumped from tier_1 to tier_2 accordingly.
  const PAYOUT_INPUT: AssertCanTransactInput = {
    userId: 'user-id-1',
    fiatAmount: '10000',
    fiatCurrency: 'NGN',
    asset: 'USDT',
    capability: 'crypto.sell',
  };

  it('resolves for a verified tier_2 user within the per-tx cap', async () => {
    const svc = makeService(makeUser({ kycTier: 'tier_2' }), '0', 0);
    await expect(
      svc.assertCanReleasePayout(PAYOUT_INPUT),
    ).resolves.toBeUndefined();
  });

  it('does NOT consult the daily/weekly velocity counters (avoids double-count)', async () => {
    const identityRepo = makeIdentityRepo(makeUser({ kycTier: 'tier_2' }));
    const velocityRepo = makeVelocityRepo('0', 0);
    const svc = new KycGateService(
      identityRepo,
      velocityRepo,
      stubConfig,
      stubClock,
    );
    await svc.assertCanReleasePayout(PAYOUT_INPUT);
    expect(velocityRepo.getDailyUsage).not.toHaveBeenCalled();
    expect(velocityRepo.getWeeklyUsage).not.toHaveBeenCalled();
    expect(velocityRepo.getRecentSendCount).not.toHaveBeenCalled();
  });

  it('passes even when daily usage is already AT the cap (velocity skipped)', async () => {
    // tier_2 dailyFiatMax is 2_000_000; a fresh assertCanTransact would trip velocity.
    const svc = makeService(makeUser({ kycTier: 'tier_2' }), '2000000', 30);
    await expect(
      svc.assertCanReleasePayout(PAYOUT_INPUT),
    ).resolves.toBeUndefined();
  });

  it('throws SimSwapBlockedError when simSwapDetectedAt is set', async () => {
    const svc = makeService(
      makeUser({
        kycTier: 'tier_2',
        simSwapDetectedAt: new Date('2024-05-30T10:00:00Z'),
      }),
    );
    await expect(svc.assertCanReleasePayout(PAYOUT_INPUT)).rejects.toThrow(
      SimSwapBlockedError,
    );
  });

  it('throws CapabilityTierError when the tier is below the capability minimum (tier_1 retrying a sell payout)', async () => {
    const svc = makeService(makeUser({ kycTier: 'tier_1' }));
    await expect(svc.assertCanReleasePayout(PAYOUT_INPUT)).rejects.toThrow(
      CapabilityTierError,
    );
    await expect(
      svc.assertCanReleasePayout(PAYOUT_INPUT),
    ).rejects.toMatchObject({
      code: 'CAPABILITY_TIER_REQUIRED',
      capability: 'crypto.sell',
      requiredTier: 'tier_2',
      actualTier: 'tier_1',
    });
  });

  it('throws TierLimitExceededError when amount exceeds the per-tx cap', async () => {
    const svc = makeService(makeUser({ kycTier: 'tier_2' })); // perTxFiatMax = 500_000
    await expect(
      svc.assertCanReleasePayout({ ...PAYOUT_INPUT, fiatAmount: '600000' }),
    ).rejects.toThrow(TierLimitExceededError);
  });

  it('throws TierChangeCoolingOffError inside the cooling-off window', async () => {
    const svc = makeService(
      makeUser({
        kycTier: 'tier_2',
        tierChangedAt: new Date(FIXED_NOW.getTime() - 1000),
      }),
      '0',
      0,
      makeConfig(DEFAULT_LIMITS, 3600),
    );
    await expect(svc.assertCanReleasePayout(PAYOUT_INPUT)).rejects.toThrow(
      TierChangeCoolingOffError,
    );
  });
});
