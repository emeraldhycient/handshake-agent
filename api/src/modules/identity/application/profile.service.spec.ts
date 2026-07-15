import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { Clock } from '../../../core/common/clock';
import { ProfileService } from './profile.service';

const limitsConfig = {
  NGN: {
    tier_1: { perTxFiatMax: 50000, dailyFiatMax: 200000, dailyTxCountMax: 10 },
    tier_2: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
    tier_3: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
  },
};

/** Builds an EffectiveConfigService stub returning `limits` from get('limits'). */
function makeConfig(limits: unknown = limitsConfig): EffectiveConfigService {
  return {
    get: (k: string) => (k === 'limits' ? limits : undefined),
  } as unknown as EffectiveConfigService;
}

const config = makeConfig();
const registry = {
  defaultFiat: () => 'NGN',
  isCurrencyLive: (code: string) => code === 'NGN' || code === 'GHS',
};

const MEMBER_SINCE = new Date('2026-07-01T00:00:00.000Z');

/** Identity stub — settings default to null (no user-set phone/fiat). */
function makeIdentity(overrides: Record<string, jest.Mock> = {}) {
  return {
    findKycProfile: jest.fn().mockResolvedValue(null),
    findWhatsAppAddressByUserId: jest.fn().mockResolvedValue(null),
    findProfileSettings: jest.fn().mockResolvedValue(null),
    loadUser: jest.fn().mockResolvedValue({
      id: 'u1',
      status: 'active',
      kycStatus: 'verified',
      kycTier: 'tier_1',
      simSwapDetectedAt: null,
      tierChangedAt: null,
      createdAt: MEMBER_SINCE,
      pinnedDeviceId: null,
    }),
    ...overrides,
  };
}

/** Velocity stub — default: nothing used yet. */
function makeVelocity(usage = { fiatTotal: '0', txCount: 0 }) {
  return { getDailyUsage: jest.fn().mockResolvedValue(usage) };
}

const clock: Clock = { now: () => new Date('2026-07-15T12:00:00.000Z') };

interface BuildOpts {
  me?: Record<string, unknown>;
  identity?: Record<string, jest.Mock>;
  config?: EffectiveConfigService;
  velocity?: { getDailyUsage: jest.Mock };
}

function build(opts: BuildOpts = {}) {
  const me = {
    userId: 'u1',
    email: 'a@b.com',
    kycStatus: 'verified',
    kycTier: 'tier_1',
    hasPin: true,
    ...opts.me,
  };
  const auth = { me: jest.fn().mockResolvedValue(me) };
  const identity = makeIdentity(opts.identity);
  const velocity = opts.velocity ?? makeVelocity();
  const svc = new ProfileService(
    auth as never,
    identity as never,
    opts.config ?? config,
    registry as never,
    velocity as never,
    clock,
  );
  return { svc, auth, identity, velocity };
}

describe('ProfileService', () => {
  it('composes email + name + phone + tier limits (with live usage) + memberSince + security', async () => {
    const { svc } = build({
      me: { emailVerified: true },
      identity: {
        findKycProfile: jest
          .fn()
          .mockResolvedValue({ firstName: 'Amara', lastName: 'Okeke' }),
        findWhatsAppAddressByUserId: jest
          .fn()
          .mockResolvedValue('+2348011112222'),
        loadUser: jest.fn().mockResolvedValue({
          id: 'u1',
          status: 'active',
          kycStatus: 'verified',
          kycTier: 'tier_1',
          simSwapDetectedAt: null,
          tierChangedAt: null,
          createdAt: MEMBER_SINCE,
          pinnedDeviceId: 'dev-1',
        }),
      },
      velocity: makeVelocity({ fiatTotal: '320000', txCount: 3 }),
    });

    const out = await svc.getProfile('u1');
    expect(out).toEqual({
      email: 'a@b.com',
      fullName: 'Amara Okeke',
      phone: '+2348011112222',
      kycStatus: 'verified',
      kycTier: 'tier_1',
      fiatCurrency: 'NGN',
      limits: {
        perTxFiatMax: 50000,
        dailyFiatMax: 200000,
        dailyTxCountMax: 10,
        dailyFiatUsed: 320000,
        dailyTxCountUsed: 3,
      },
      memberSince: '2026-07-01T00:00:00.000Z',
      // hasPin + emailVerified + deviceBound(dev-1), kyc tier_1 not verified → 3 → good
      security: { score: 3, label: 'good' },
    });
  });

  it('returns null name/phone/limits for an unverified user and skips the usage read', async () => {
    const { svc, velocity } = build({
      me: { kycStatus: 'not_started', kycTier: 'unverified', hasPin: false },
      identity: {
        loadUser: jest.fn().mockResolvedValue({
          id: 'u1',
          status: 'active',
          kycStatus: 'not_started',
          kycTier: 'unverified',
          simSwapDetectedAt: null,
          tierChangedAt: null,
          createdAt: MEMBER_SINCE,
          pinnedDeviceId: null,
        }),
      },
    });

    const out = await svc.getProfile('u1');
    expect(out).toMatchObject({
      fullName: null,
      phone: null,
      limits: null,
      kycTier: 'unverified',
    });
    expect(velocity.getDailyUsage).not.toHaveBeenCalled();
    // hasPin false, email unverified, no device, unverified tier → 0 → weak
    expect(out.security).toEqual({ score: 0, label: 'weak' });
  });

  it('folds the current 24h window usage into limits for a verified user', async () => {
    const { svc, velocity } = build({
      velocity: makeVelocity({ fiatTotal: '195000.00', txCount: 2 }),
    });
    const out = await svc.getProfile('u1');
    expect(velocity.getDailyUsage).toHaveBeenCalledWith(
      'u1',
      new Date('2026-07-15T12:00:00.000Z'),
      'NGN',
    );
    expect(out.limits).toEqual({
      perTxFiatMax: 50000,
      dailyFiatMax: 200000,
      dailyTxCountMax: 10,
      dailyFiatUsed: 195000,
      dailyTxCountUsed: 2,
    });
  });

  it('surfaces memberSince as the ISO account-creation timestamp', async () => {
    const { svc } = build();
    const out = await svc.getProfile('u1');
    expect(out.memberSince).toBe('2026-07-01T00:00:00.000Z');
  });

  it('returns a null memberSince when the user row is absent', async () => {
    const { svc } = build({
      identity: { loadUser: jest.fn().mockResolvedValue(null) },
    });
    const out = await svc.getProfile('u1');
    expect(out.memberSince).toBeNull();
  });

  describe('security strength score', () => {
    const cases: Array<{
      name: string;
      me: Record<string, unknown>;
      pinnedDeviceId: string | null;
      kycTier: string;
      expected: { score: number; label: string };
    }> = [
      {
        name: 'all four signals → strong',
        me: { hasPin: true, emailVerified: true, kycTier: 'tier_2' },
        pinnedDeviceId: 'dev-1',
        kycTier: 'tier_2',
        expected: { score: 4, label: 'strong' },
      },
      {
        name: 'three signals → good',
        me: { hasPin: true, emailVerified: true, kycTier: 'tier_3' },
        pinnedDeviceId: null,
        kycTier: 'tier_3',
        expected: { score: 3, label: 'good' },
      },
      {
        name: 'two signals → fair',
        me: { hasPin: true, emailVerified: false, kycTier: 'tier_2' },
        pinnedDeviceId: null,
        kycTier: 'tier_2',
        expected: { score: 2, label: 'fair' },
      },
      {
        name: 'one signal → weak',
        me: { hasPin: true, emailVerified: false, kycTier: 'tier_1' },
        pinnedDeviceId: null,
        kycTier: 'tier_1',
        expected: { score: 1, label: 'weak' },
      },
    ];

    for (const c of cases) {
      it(c.name, async () => {
        const { svc } = build({
          me: c.me,
          identity: {
            loadUser: jest.fn().mockResolvedValue({
              id: 'u1',
              status: 'active',
              kycStatus: 'verified',
              kycTier: c.kycTier,
              simSwapDetectedAt: null,
              tierChangedAt: null,
              createdAt: MEMBER_SINCE,
              pinnedDeviceId: c.pinnedDeviceId,
            }),
          },
        });
        const out = await svc.getProfile('u1');
        expect(out.security).toEqual(c.expected);
      });
    }
  });

  it('joins only the present name part when one is missing', async () => {
    const { svc } = build({
      identity: {
        findKycProfile: jest
          .fn()
          .mockResolvedValue({ firstName: 'Amara', lastName: null }),
      },
    });
    const out = await svc.getProfile('u1');
    expect(out.fullName).toBe('Amara');
    expect(out.phone).toBeNull();
  });

  it('reflects a DB AppSetting override of the tier limits (EffectiveConfigService flows through)', async () => {
    const overridden = makeConfig({
      NGN: {
        tier_1: {
          perTxFiatMax: 999999,
          dailyFiatMax: 8888888,
          dailyTxCountMax: 77,
        },
        tier_2: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
        tier_3: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
      },
    });
    const { svc } = build({
      config: overridden,
      identity: {
        findKycProfile: jest
          .fn()
          .mockResolvedValue({ firstName: 'Amara', lastName: 'Okeke' }),
      },
    });
    const out = await svc.getProfile('u1');
    expect(out.limits).toMatchObject({
      perTxFiatMax: 999999,
      dailyFiatMax: 8888888,
      dailyTxCountMax: 77,
    });
  });

  it('prefers the user-set phone and a LIVE preferred fiat over the defaults', async () => {
    const { svc } = build({
      identity: {
        findWhatsAppAddressByUserId: jest
          .fn()
          .mockResolvedValue('+2348011112222'),
        findProfileSettings: jest.fn().mockResolvedValue({
          profilePhone: '+2348099998888',
          preferredFiatCurrency: 'GHS',
        }),
      },
    });
    const out = await svc.getProfile('u1');
    expect(out.phone).toBe('+2348099998888');
    expect(out.fiatCurrency).toBe('GHS');
  });

  it('surfaces payId from the me projection when the user has claimed one', async () => {
    const { svc } = build({ me: { payId: 'amara' } });
    const out = await svc.getProfile('u1');
    expect(out.payId).toBe('amara');
  });

  it('returns payId undefined (not null) when the user has not claimed one', async () => {
    const { svc } = build({ me: { payId: null } });
    const out = await svc.getProfile('u1');
    expect(out.payId).toBeUndefined();
  });

  it('falls back to the default fiat when the preferred one is no longer live (fail-safe)', async () => {
    const { svc } = build({
      identity: {
        findProfileSettings: jest.fn().mockResolvedValue({
          profilePhone: null,
          preferredFiatCurrency: 'XOF',
        }),
      },
    });
    const out = await svc.getProfile('u1');
    expect(out.fiatCurrency).toBe('NGN');
  });
});
