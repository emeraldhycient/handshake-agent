import { describe, it, expect } from 'vitest'
import {
  ProfileLimitsSchema,
  ProfileResponseSchema,
  MembershipSecuritySchema,
} from './profile.dto'

const validLimits = {
  perTxFiatMax: 50000,
  dailyFiatMax: 2000000,
  dailyTxCountMax: 20,
  dailyFiatUsed: 320000,
  dailyTxCountUsed: 3,
}

const validProfile = {
  email: 'olivia@example.com',
  fullName: 'olivia lee',
  phone: '+2348100000007',
  kycStatus: 'verified',
  kycTier: 'tier_2',
  fiatCurrency: 'NGN',
  limits: validLimits,
  payId: 'olivia',
  memberSince: '2026-07-01T00:00:00.000Z',
  security: { score: 4, label: 'strong' },
}

describe('ProfileLimitsSchema', () => {
  it('parses live daily usage alongside the static caps', () => {
    const parsed = ProfileLimitsSchema.parse(validLimits)
    expect(parsed.dailyFiatUsed).toBe(320000)
    expect(parsed.dailyTxCountUsed).toBe(3)
  })

  it('requires the usage fields', () => {
    const { dailyFiatUsed: _omit, ...withoutUsage } = validLimits
    expect(ProfileLimitsSchema.safeParse(withoutUsage).success).toBe(false)
  })
})

describe('MembershipSecuritySchema', () => {
  it('parses a score in 0..4 with a valid label', () => {
    expect(MembershipSecuritySchema.parse({ score: 0, label: 'weak' }).score).toBe(0)
    expect(MembershipSecuritySchema.parse({ score: 4, label: 'strong' }).label).toBe('strong')
  })

  it('rejects a score above 4', () => {
    expect(MembershipSecuritySchema.safeParse({ score: 5, label: 'strong' }).success).toBe(false)
  })

  it('rejects an unknown label', () => {
    expect(MembershipSecuritySchema.safeParse({ score: 3, label: 'ultra' }).success).toBe(false)
  })
})

describe('ProfileResponseSchema', () => {
  it('parses a full profile with memberSince + security + usage', () => {
    const parsed = ProfileResponseSchema.parse(validProfile)
    expect(parsed.memberSince).toBe('2026-07-01T00:00:00.000Z')
    expect(parsed.security.score).toBe(4)
    expect(parsed.limits?.dailyFiatUsed).toBe(320000)
  })

  it('allows a null memberSince and a null limits (unverified)', () => {
    const parsed = ProfileResponseSchema.parse({
      ...validProfile,
      limits: null,
      memberSince: null,
      security: { score: 1, label: 'weak' },
    })
    expect(parsed.limits).toBeNull()
    expect(parsed.memberSince).toBeNull()
  })

  it('requires the security field', () => {
    const { security: _omit, ...withoutSecurity } = validProfile
    expect(ProfileResponseSchema.safeParse(withoutSecurity).success).toBe(false)
  })
})
