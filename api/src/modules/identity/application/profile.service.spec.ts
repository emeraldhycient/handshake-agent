import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
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

/** Identity stub — settings default to null (no user-set phone/fiat). */
function makeIdentity(overrides: Record<string, jest.Mock> = {}) {
  return {
    findKycProfile: jest.fn().mockResolvedValue(null),
    findWhatsAppAddressByUserId: jest.fn().mockResolvedValue(null),
    findProfileSettings: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('ProfileService', () => {
  it('composes email + name + phone + tier limits for a verified user', async () => {
    const auth = {
      me: jest.fn().mockResolvedValue({
        userId: 'u1',
        email: 'a@b.com',
        kycStatus: 'verified',
        kycTier: 'tier_1',
        hasPin: true,
      }),
    };
    const identity = makeIdentity({
      findKycProfile: jest
        .fn()
        .mockResolvedValue({ firstName: 'Amara', lastName: 'Okeke' }),
      findWhatsAppAddressByUserId: jest
        .fn()
        .mockResolvedValue('+2348011112222'),
    });
    const svc = new ProfileService(
      auth as never,
      identity as never,
      config,
      registry as never,
    );

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
      },
    });
  });

  it('returns null name/phone/limits for an unverified user', async () => {
    const auth = {
      me: jest.fn().mockResolvedValue({
        userId: 'u1',
        email: 'a@b.com',
        kycStatus: 'not_started',
        kycTier: 'unverified',
        hasPin: false,
      }),
    };
    const identity = makeIdentity();
    const svc = new ProfileService(
      auth as never,
      identity as never,
      config,
      registry as never,
    );

    const out = await svc.getProfile('u1');
    expect(out).toMatchObject({
      fullName: null,
      phone: null,
      limits: null,
      kycTier: 'unverified',
    });
  });

  it('joins only the present name part when one is missing', async () => {
    const auth = {
      me: jest.fn().mockResolvedValue({
        userId: 'u1',
        email: 'a@b.com',
        kycStatus: 'verified',
        kycTier: 'tier_1',
        hasPin: true,
      }),
    };
    const identity = makeIdentity({
      findKycProfile: jest
        .fn()
        .mockResolvedValue({ firstName: 'Amara', lastName: null }),
    });
    const svc = new ProfileService(
      auth as never,
      identity as never,
      config,
      registry as never,
    );

    const out = await svc.getProfile('u1');
    expect(out.fullName).toBe('Amara');
    expect(out.phone).toBeNull();
  });

  it('reflects a DB AppSetting override of the tier limits (EffectiveConfigService flows through)', async () => {
    // Simulate an admin override of tier_1 limits; the profile must return the
    // overridden values, proving get('limits') resolves through the layered config.
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
    const auth = {
      me: jest.fn().mockResolvedValue({
        userId: 'u1',
        email: 'a@b.com',
        kycStatus: 'verified',
        kycTier: 'tier_1',
        hasPin: true,
      }),
    };
    const identity = makeIdentity({
      findKycProfile: jest
        .fn()
        .mockResolvedValue({ firstName: 'Amara', lastName: 'Okeke' }),
    });
    const svc = new ProfileService(
      auth as never,
      identity as never,
      overridden,
      registry as never,
    );

    const out = await svc.getProfile('u1');
    expect(out.limits).toEqual({
      perTxFiatMax: 999999,
      dailyFiatMax: 8888888,
      dailyTxCountMax: 77,
    });
  });

  it('prefers the user-set phone and a LIVE preferred fiat over the defaults', async () => {
    const auth = {
      me: jest.fn().mockResolvedValue({
        userId: 'u1',
        email: 'a@b.com',
        kycStatus: 'verified',
        kycTier: 'tier_1',
        hasPin: true,
      }),
    };
    const identity = makeIdentity({
      findWhatsAppAddressByUserId: jest
        .fn()
        .mockResolvedValue('+2348011112222'),
      findProfileSettings: jest.fn().mockResolvedValue({
        profilePhone: '+2348099998888',
        preferredFiatCurrency: 'GHS',
      }),
    });
    const svc = new ProfileService(
      auth as never,
      identity as never,
      config,
      registry as never,
    );

    const out = await svc.getProfile('u1');
    expect(out.phone).toBe('+2348099998888');
    expect(out.fiatCurrency).toBe('GHS');
  });

  it('falls back to the default fiat when the preferred one is no longer live (fail-safe)', async () => {
    const auth = {
      me: jest.fn().mockResolvedValue({
        userId: 'u1',
        email: 'a@b.com',
        kycStatus: 'verified',
        kycTier: 'tier_1',
        hasPin: true,
      }),
    };
    const identity = makeIdentity({
      findProfileSettings: jest.fn().mockResolvedValue({
        profilePhone: null,
        preferredFiatCurrency: 'XOF',
      }),
    });
    const svc = new ProfileService(
      auth as never,
      identity as never,
      config,
      registry as never,
    );

    const out = await svc.getProfile('u1');
    expect(out.fiatCurrency).toBe('NGN');
  });
});
