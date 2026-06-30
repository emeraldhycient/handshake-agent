import { describe, expect, it } from 'vitest'
import { CheckBalanceIntentSchema } from './check-balance.intent'

describe('CheckBalanceIntentSchema', () => {
  it('accepts a balance check with no asset (all assets)', () => {
    const result = CheckBalanceIntentSchema.parse({ action: 'check_balance' })
    expect(result.action).toBe('check_balance')
    expect(result.asset).toBeUndefined()
  })

  it('accepts a balance check scoped to a specific supported asset', () => {
    const result = CheckBalanceIntentSchema.parse({
      action: 'check_balance',
      asset: 'USDT',
    })
    expect(result.asset).toBe('USDT')
  })

  it('rejects an asset outside the supported set', () => {
    expect(() =>
      CheckBalanceIntentSchema.parse({ action: 'check_balance', asset: 'DOGE' }),
    ).toThrow()
  })

  it('rejects a wrong action literal', () => {
    expect(() =>
      CheckBalanceIntentSchema.parse({ action: 'buy_crypto' }),
    ).toThrow()
  })
})
