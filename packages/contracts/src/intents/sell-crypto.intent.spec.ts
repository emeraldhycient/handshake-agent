/**
 * Unit tests for SellCryptoIntentSchema and IntentSchema narrowing (task S4a).
 */

import { SellCryptoIntentSchema } from './sell-crypto.intent'
import { IntentSchema } from './index'

describe('SellCryptoIntentSchema', () => {
  it('parses a valid sell_crypto intent', () => {
    const result = SellCryptoIntentSchema.parse({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '5.0',
      fiatCurrency: 'NGN',
    })
    expect(result.action).toBe('sell_crypto')
    expect(result.asset).toBe('USDT')
    expect(result.cryptoAmount).toBe('5.0')
    expect(result.fiatCurrency).toBe('NGN')
  })

  it('defaults fiatCurrency to NGN when omitted', () => {
    const result = SellCryptoIntentSchema.parse({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '1.5',
    })
    expect(result.fiatCurrency).toBe('NGN')
  })

  it('rejects an unknown asset', () => {
    expect(() =>
      SellCryptoIntentSchema.parse({
        action: 'sell_crypto',
        asset: 'ETH',
        cryptoAmount: '1.0',
        fiatCurrency: 'NGN',
      }),
    ).toThrow()
  })

  it('rejects a cryptoAmount with more than 8 decimal places', () => {
    expect(() =>
      SellCryptoIntentSchema.parse({
        action: 'sell_crypto',
        asset: 'USDT',
        cryptoAmount: '1.123456789', // 9 d.p. — violates CryptoAmountSchema
        fiatCurrency: 'NGN',
      }),
    ).toThrow()
  })

  it('rejects missing cryptoAmount', () => {
    expect(() =>
      SellCryptoIntentSchema.parse({
        action: 'sell_crypto',
        asset: 'USDT',
        fiatCurrency: 'NGN',
      }),
    ).toThrow()
  })

  it('rejects wrong action literal', () => {
    expect(() =>
      SellCryptoIntentSchema.parse({
        action: 'buy_crypto',
        asset: 'USDT',
        cryptoAmount: '1.0',
        fiatCurrency: 'NGN',
      }),
    ).toThrow()
  })
})

describe('SellCryptoIntentSchema — recipientNickname (server-resolved lookup key)', () => {
  const base = {
    action: 'sell_crypto',
    asset: 'USDT',
    cryptoAmount: '5.0',
    fiatCurrency: 'NGN',
  }

  it('accepts an intent without recipientNickname (optional)', () => {
    const result = SellCryptoIntentSchema.parse(base)
    expect(result.recipientNickname).toBeUndefined()
  })

  it('accepts a recipientNickname and trims surrounding whitespace', () => {
    const result = SellCryptoIntentSchema.parse({
      ...base,
      recipientNickname: '  mum  ',
    })
    expect(result.recipientNickname).toBe('mum')
  })

  it('rejects an empty recipientNickname', () => {
    expect(() =>
      SellCryptoIntentSchema.parse({ ...base, recipientNickname: '' }),
    ).toThrow()
  })

  it('rejects a whitespace-only recipientNickname (trims to empty)', () => {
    expect(() =>
      SellCryptoIntentSchema.parse({ ...base, recipientNickname: '   ' }),
    ).toThrow()
  })

  it('accepts a recipientNickname of exactly 60 characters', () => {
    const result = SellCryptoIntentSchema.parse({
      ...base,
      recipientNickname: 'a'.repeat(60),
    })
    expect(result.recipientNickname).toHaveLength(60)
  })

  it('rejects a recipientNickname longer than 60 characters', () => {
    expect(() =>
      SellCryptoIntentSchema.parse({
        ...base,
        recipientNickname: 'a'.repeat(61),
      }),
    ).toThrow()
  })
})

describe('IntentSchema — sell_crypto discriminated union narrowing', () => {
  it('parses a sell_crypto intent through the root union', () => {
    const result = IntentSchema.parse({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '3.0',
      fiatCurrency: 'NGN',
    })
    expect(result.action).toBe('sell_crypto')
  })

  it('narrows to SellCryptoIntent on action === sell_crypto', () => {
    const intent = IntentSchema.parse({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '3.0',
      fiatCurrency: 'NGN',
    })
    if (intent.action === 'sell_crypto') {
      // TypeScript should narrow; accessing cryptoAmount must be valid here.
      expect(intent.cryptoAmount).toBe('3.0')
    } else {
      throw new Error('Expected sell_crypto action')
    }
  })
})
