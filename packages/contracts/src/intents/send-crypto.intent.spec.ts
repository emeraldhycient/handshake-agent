/**
 * Unit tests for SendCryptoIntentSchema (Wave B — beneficiary nicknames).
 *
 * SECURITY (CLAUDE.md §3.1): `recipientNickname` is a LOOKUP KEY resolved
 * server-side against the user's own saved beneficiaries — NEVER a destination
 * address. These fixtures pin that the schema carries no address field and the
 * nickname is bounded + trimmed.
 */

import { SendCryptoIntentSchema } from './send-crypto.intent'
import { IntentSchema } from './index'

const base = {
  action: 'send_crypto',
  asset: 'USDT',
  cryptoAmount: '10.5',
  network: 'TRON',
}

describe('SendCryptoIntentSchema', () => {
  it('parses a valid send_crypto intent', () => {
    const result = SendCryptoIntentSchema.parse(base)
    expect(result.action).toBe('send_crypto')
    expect(result.asset).toBe('USDT')
    expect(result.cryptoAmount).toBe('10.5')
    expect(result.network).toBe('TRON')
  })

  it('defaults network to TRON when omitted', () => {
    const result = SendCryptoIntentSchema.parse({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '1',
    })
    expect(result.network).toBe('TRON')
  })

  it('rejects missing cryptoAmount', () => {
    expect(() =>
      SendCryptoIntentSchema.parse({
        action: 'send_crypto',
        asset: 'USDT',
      }),
    ).toThrow()
  })
})

describe('SendCryptoIntentSchema — recipientNickname (server-resolved lookup key)', () => {
  it('accepts an intent without recipientNickname (optional)', () => {
    const result = SendCryptoIntentSchema.parse(base)
    expect(result.recipientNickname).toBeUndefined()
  })

  it('accepts a recipientNickname and trims surrounding whitespace', () => {
    const result = SendCryptoIntentSchema.parse({
      ...base,
      recipientNickname: '  mum  ',
    })
    expect(result.recipientNickname).toBe('mum')
  })

  it('rejects an empty recipientNickname', () => {
    expect(() =>
      SendCryptoIntentSchema.parse({ ...base, recipientNickname: '' }),
    ).toThrow()
  })

  it('rejects a whitespace-only recipientNickname (trims to empty)', () => {
    expect(() =>
      SendCryptoIntentSchema.parse({ ...base, recipientNickname: '   ' }),
    ).toThrow()
  })

  it('accepts a recipientNickname of exactly 60 characters', () => {
    const result = SendCryptoIntentSchema.parse({
      ...base,
      recipientNickname: 'a'.repeat(60),
    })
    expect(result.recipientNickname).toHaveLength(60)
  })

  it('rejects a recipientNickname longer than 60 characters', () => {
    expect(() =>
      SendCryptoIntentSchema.parse({
        ...base,
        recipientNickname: 'a'.repeat(61),
      }),
    ).toThrow()
  })

  it('carries no destination-address field (address extraction is forbidden)', () => {
    // The schema must strip an address the model wrongly emits — it can never
    // surface as a financial parameter (CLAUDE.md §3.1).
    const result = SendCryptoIntentSchema.parse({
      ...base,
      toAddress: 'TQn9Y2khDD3VHKZ2GRdmKXD8bNkRuaBP2p',
    }) as Record<string, unknown>
    expect(result.toAddress).toBeUndefined()
  })
})

describe('IntentSchema — send_crypto discriminated union narrowing', () => {
  it('parses a send_crypto intent with recipientNickname through the root union', () => {
    const intent = IntentSchema.parse({
      ...base,
      recipientNickname: 'mum',
    })
    expect(intent.action).toBe('send_crypto')
    if (intent.action === 'send_crypto') {
      expect(intent.recipientNickname).toBe('mum')
    } else {
      throw new Error('Expected send_crypto action')
    }
  })
})
