import { describe, it, expect } from 'vitest'
import { ProfileResponseSchema } from './profile.dto'

describe('ProfileResponseSchema', () => {
  it('parses a full verified profile', () => {
    const ok = {
      email: 'a@b.com',
      fullName: 'Amara Okeke',
      phone: '+2348011112222',
      kycStatus: 'verified',
      kycTier: 'tier_1',
      fiatCurrency: 'NGN',
      limits: { perTxFiatMax: 50000, dailyFiatMax: 200000, dailyTxCountMax: 10 },
    }
    expect(ProfileResponseSchema.parse(ok)).toEqual(ok)
  })

  it('parses an unverified profile with nulls', () => {
    const ok = {
      email: 'a@b.com',
      fullName: null,
      phone: null,
      kycStatus: 'not_started',
      kycTier: 'unverified',
      fiatCurrency: 'NGN',
      limits: null,
    }
    expect(ProfileResponseSchema.parse(ok)).toEqual(ok)
  })

  it('rejects a missing email', () => {
    expect(() =>
      ProfileResponseSchema.parse({
        fullName: null,
        phone: null,
        kycStatus: 'verified',
        kycTier: 'tier_1',
        fiatCurrency: 'NGN',
        limits: null,
      }),
    ).toThrow()
  })
})
