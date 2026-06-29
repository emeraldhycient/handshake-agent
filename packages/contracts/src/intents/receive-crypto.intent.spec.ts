import { describe, expect, it } from 'vitest'
import { ReceiveCryptoIntentSchema } from './receive-crypto.intent'

describe('ReceiveCryptoIntentSchema', () => {
  it('accepts a receive_crypto intent with an explicit asset (USDT)', () => {
    const result = ReceiveCryptoIntentSchema.parse({
      action: 'receive_crypto',
      asset: 'USDT',
      network: 'TRON',
    })
    expect(result.asset).toBe('USDT')
    expect(result.network).toBe('TRON')
  })

  it('accepts a receive_crypto intent with TRX as the requested asset', () => {
    const result = ReceiveCryptoIntentSchema.parse({
      action: 'receive_crypto',
      asset: 'TRX',
      network: 'TRON',
    })
    expect(result.asset).toBe('TRX')
  })

  it('accepts a receive_crypto intent with no asset (model did not name one)', () => {
    // asset is optional — the service falls back to the registry default
    const result = ReceiveCryptoIntentSchema.parse({
      action: 'receive_crypto',
    })
    expect(result.asset).toBeUndefined()
    expect(result.network).toBe('TRON') // network still defaults
  })

  it('rejects an unsupported asset', () => {
    expect(() =>
      ReceiveCryptoIntentSchema.parse({
        action: 'receive_crypto',
        asset: 'DOGE',
      }),
    ).toThrow()
  })

  it('rejects a wrong action literal', () => {
    expect(() =>
      ReceiveCryptoIntentSchema.parse({ action: 'buy_crypto', asset: 'USDT' }),
    ).toThrow()
  })
})
