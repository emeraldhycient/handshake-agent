import { ProfileService } from './profile.service';

const limitsConfig = {
  NGN: {
    tier_1: { perTxFiatMax: 50000, dailyFiatMax: 200000, dailyTxCountMax: 10 },
    tier_2: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
    tier_3: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
  },
};
const config = {
  get: (k: string) => (k === 'limits' ? limitsConfig : undefined),
};
const registry = { defaultFiat: () => 'NGN' };

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
    const identity = {
      findKycProfile: jest
        .fn()
        .mockResolvedValue({ firstName: 'Amara', lastName: 'Okeke' }),
      findWhatsAppAddressByUserId: jest
        .fn()
        .mockResolvedValue('+2348011112222'),
    };
    const svc = new ProfileService(
      auth as never,
      identity as never,
      config as never,
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
    const identity = {
      findKycProfile: jest.fn().mockResolvedValue(null),
      findWhatsAppAddressByUserId: jest.fn().mockResolvedValue(null),
    };
    const svc = new ProfileService(
      auth as never,
      identity as never,
      config as never,
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
    const identity = {
      findKycProfile: jest
        .fn()
        .mockResolvedValue({ firstName: 'Amara', lastName: null }),
      findWhatsAppAddressByUserId: jest.fn().mockResolvedValue(null),
    };
    const svc = new ProfileService(
      auth as never,
      identity as never,
      config as never,
      registry as never,
    );

    const out = await svc.getProfile('u1');
    expect(out.fullName).toBe('Amara');
    expect(out.phone).toBeNull();
  });
});
