import { describe, expect, it } from 'vitest'
import { ListRatesIntentSchema } from './list-rates.intent'

describe('ListRatesIntentSchema', () => {
  it('accepts the parameterless list-rates intent', () => {
    const result = ListRatesIntentSchema.parse({ action: 'list_rates' })
    expect(result.action).toBe('list_rates')
  })

  it('ignores any extra fields (no parameters carried)', () => {
    const result = ListRatesIntentSchema.parse({
      action: 'list_rates',
      asset: 'USDT',
    })
    expect(result).not.toHaveProperty('asset')
  })

  it('rejects a wrong action literal', () => {
    expect(() =>
      ListRatesIntentSchema.parse({ action: 'get_rate' }),
    ).toThrow()
  })
})
