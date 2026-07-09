/**
 * Schema contract tests for the rate-discovery tools (Wave K).
 *
 * TDD: valid payloads parse, invalid ones are rejected. Runs inside the
 * contracts package — no NestJS, no HTTP.
 */

import {
  EffectiveRateSchema,
  GetRateInputSchema,
  ListRatesInputSchema,
  RateListResponseSchema,
} from './rates.tool'

// ---------------------------------------------------------------------------
// GetRateInputSchema
// ---------------------------------------------------------------------------

describe('GetRateInputSchema', () => {
  it('accepts a valid pair', () => {
    const result = GetRateInputSchema.safeParse({
      asset: 'USDT',
      fiatCurrency: 'NGN',
    })
    expect(result.success).toBe(true)
  })

  it('defaults fiatCurrency to NGN when omitted', () => {
    const result = GetRateInputSchema.parse({ asset: 'USDT' })
    expect(result.fiatCurrency).toBe('NGN')
  })

  it('rejects an unsupported asset', () => {
    const result = GetRateInputSchema.safeParse({
      asset: 'DOGE',
      fiatCurrency: 'NGN',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a malformed fiat code', () => {
    const result = GetRateInputSchema.safeParse({
      asset: 'USDT',
      fiatCurrency: 'ngn',
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ListRatesInputSchema
// ---------------------------------------------------------------------------

describe('ListRatesInputSchema', () => {
  it('accepts an empty object', () => {
    expect(ListRatesInputSchema.safeParse({}).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// EffectiveRateSchema
// ---------------------------------------------------------------------------

describe('EffectiveRateSchema', () => {
  const VALID_RATE = {
    asset: 'USDT',
    fiatCurrency: 'NGN',
    buyRate: '1624',
    sellRate: '1568',
    source: 'live',
    asOf: '2026-07-09T00:00:00.000Z',
  }

  it('accepts a valid folded rate (integer and fractional)', () => {
    expect(EffectiveRateSchema.safeParse(VALID_RATE).success).toBe(true)
    expect(
      EffectiveRateSchema.safeParse({ ...VALID_RATE, sellRate: '1546.72' })
        .success,
    ).toBe(true)
  })

  it("accepts source 'config'", () => {
    expect(
      EffectiveRateSchema.safeParse({ ...VALID_RATE, source: 'config' }).success,
    ).toBe(true)
  })

  it('rejects an unknown source value', () => {
    expect(
      EffectiveRateSchema.safeParse({ ...VALID_RATE, source: 'stale' }).success,
    ).toBe(false)
  })

  it('rejects a non-string (numeric) buyRate — money must be a string', () => {
    expect(
      EffectiveRateSchema.safeParse({ ...VALID_RATE, buyRate: 1624 }).success,
    ).toBe(false)
  })

  it('rejects a non-numeric rate string', () => {
    expect(
      EffectiveRateSchema.safeParse({ ...VALID_RATE, buyRate: 'abc' }).success,
    ).toBe(false)
  })

  it('rejects a rate with more than 8 decimal places', () => {
    expect(
      EffectiveRateSchema.safeParse({
        ...VALID_RATE,
        buyRate: '1624.123456789',
      }).success,
    ).toBe(false)
  })

  it('does NOT carry a raw spread field (folded numbers only)', () => {
    const parsed = EffectiveRateSchema.parse(VALID_RATE)
    expect(parsed).not.toHaveProperty('spreadBps')
    expect(parsed).not.toHaveProperty('buySpreadBps')
    expect(parsed).not.toHaveProperty('sellSpreadBps')
  })

  it('rejects a non-datetime asOf', () => {
    expect(
      EffectiveRateSchema.safeParse({ ...VALID_RATE, asOf: '2026-07-09' })
        .success,
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// RateListResponseSchema
// ---------------------------------------------------------------------------

describe('RateListResponseSchema', () => {
  it('accepts an array of rates', () => {
    const result = RateListResponseSchema.safeParse({
      rates: [
        {
          asset: 'USDT',
          fiatCurrency: 'NGN',
          buyRate: '1624',
          sellRate: '1568',
          source: 'live',
          asOf: '2026-07-09T00:00:00.000Z',
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('accepts an empty rates array', () => {
    expect(RateListResponseSchema.safeParse({ rates: [] }).success).toBe(true)
  })

  it('rejects a missing rates array', () => {
    expect(RateListResponseSchema.safeParse({}).success).toBe(false)
  })
})
