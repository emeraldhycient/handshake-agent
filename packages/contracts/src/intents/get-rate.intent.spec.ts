import { describe, expect, it } from 'vitest'
import { GetRateIntentSchema } from './get-rate.intent'

describe('GetRateIntentSchema', () => {
  it('accepts a rate question with an asset and an explicit fiat', () => {
    const result = GetRateIntentSchema.parse({
      action: 'get_rate',
      asset: 'USDT',
      fiatCurrency: 'NGN',
    })
    expect(result.action).toBe('get_rate')
    expect(result.asset).toBe('USDT')
    expect(result.fiatCurrency).toBe('NGN')
  })

  it('accepts a rate question with no fiat (calling layer defaults it)', () => {
    const result = GetRateIntentSchema.parse({
      action: 'get_rate',
      asset: 'USDT',
    })
    expect(result.fiatCurrency).toBeUndefined()
  })

  it('rejects a rate question with no asset (a single-pair query names one)', () => {
    expect(() => GetRateIntentSchema.parse({ action: 'get_rate' })).toThrow()
  })

  it('rejects an asset outside the supported set', () => {
    expect(() =>
      GetRateIntentSchema.parse({ action: 'get_rate', asset: 'DOGE' }),
    ).toThrow()
  })

  it('rejects a wrong action literal', () => {
    expect(() =>
      GetRateIntentSchema.parse({ action: 'buy_crypto', asset: 'USDT' }),
    ).toThrow()
  })
})
