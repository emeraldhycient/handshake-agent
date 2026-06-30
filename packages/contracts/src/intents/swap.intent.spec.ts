/**
 * Unit tests for SwapIntentSchema and IntentSchema union membership.
 *
 * Critical invariant: SwapIntentSchema is a PLAIN z.object — no .refine().
 * A .refine()'d schema becomes ZodEffects and breaks z.discriminatedUnion at
 * module-eval time. This test file verifies both the schema itself and that it
 * participates correctly in the root IntentSchema union.
 */

import { SwapIntentSchema } from './swap.intent'
import { IntentSchema } from './index'

describe('SwapIntentSchema', () => {
  it('parses a valid swap intent (USDT → TRX)', () => {
    const result = SwapIntentSchema.parse({
      action: 'swap',
      fromAsset: 'USDT',
      toAsset: 'BTC',
      amount: '10.5',
    })
    expect(result.action).toBe('swap')
    expect(result.fromAsset).toBe('USDT')
    expect(result.toAsset).toBe('BTC')
    expect(result.amount).toBe('10.5')
  })

  it('parses a valid swap intent with integer amount', () => {
    const result = SwapIntentSchema.parse({
      action: 'swap',
      fromAsset: 'BTC',
      toAsset: 'USDT',
      amount: '1',
    })
    expect(result.fromAsset).toBe('BTC')
    expect(result.toAsset).toBe('USDT')
    expect(result.amount).toBe('1')
  })

  it('allows fromAsset === toAsset at the schema level (engine enforces distinctness)', () => {
    // The schema must NOT .refine() fromAsset !== toAsset because .refine()
    // produces ZodEffects which breaks z.discriminatedUnion. Enforcement is
    // done by createSwapProposal in the execution engine.
    const result = SwapIntentSchema.parse({
      action: 'swap',
      fromAsset: 'USDT',
      toAsset: 'USDT',
      amount: '5',
    })
    expect(result.fromAsset).toBe('USDT')
    expect(result.toAsset).toBe('USDT')
  })

  it('rejects an unknown fromAsset', () => {
    expect(() =>
      SwapIntentSchema.parse({
        action: 'swap',
        fromAsset: 'ETH',
        toAsset: 'USDT',
        amount: '1',
      }),
    ).toThrow()
  })

  it('rejects an unknown toAsset', () => {
    expect(() =>
      SwapIntentSchema.parse({
        action: 'swap',
        fromAsset: 'USDT',
        toAsset: 'ETH',
        amount: '1',
      }),
    ).toThrow()
  })

  it('rejects an amount with more than 8 decimal places', () => {
    expect(() =>
      SwapIntentSchema.parse({
        action: 'swap',
        fromAsset: 'USDT',
        toAsset: 'BTC',
        amount: '1.123456789', // 9 d.p. — violates CryptoAmountSchema
      }),
    ).toThrow()
  })

  it('rejects a missing amount', () => {
    expect(() =>
      SwapIntentSchema.parse({
        action: 'swap',
        fromAsset: 'USDT',
        toAsset: 'BTC',
      }),
    ).toThrow()
  })

  it('rejects a missing fromAsset', () => {
    expect(() =>
      SwapIntentSchema.parse({
        action: 'swap',
        toAsset: 'BTC',
        amount: '1',
      }),
    ).toThrow()
  })

  it('rejects a missing toAsset', () => {
    expect(() =>
      SwapIntentSchema.parse({
        action: 'swap',
        fromAsset: 'USDT',
        amount: '1',
      }),
    ).toThrow()
  })

  it('rejects wrong action literal', () => {
    expect(() =>
      SwapIntentSchema.parse({
        action: 'sell_crypto',
        fromAsset: 'USDT',
        toAsset: 'BTC',
        amount: '1',
      }),
    ).toThrow()
  })
})

describe('IntentSchema — swap discriminated union membership', () => {
  it('parses a swap intent through the root union', () => {
    // This is the critical regression test: if SwapIntentSchema has a .refine()
    // this throws "Cannot read properties of undefined (reading 'action')" at
    // module import time, not here. Reaching this assertion proves the union is intact.
    const result = IntentSchema.parse({
      action: 'swap',
      fromAsset: 'USDT',
      toAsset: 'BTC',
      amount: '5',
    })
    expect(result.action).toBe('swap')
  })

  it('narrows to SwapIntent on action === swap', () => {
    const intent = IntentSchema.parse({
      action: 'swap',
      fromAsset: 'USDT',
      toAsset: 'BTC',
      amount: '5',
    })
    if (intent.action === 'swap') {
      expect(intent.fromAsset).toBe('USDT')
      expect(intent.toAsset).toBe('BTC')
      expect(intent.amount).toBe('5')
    } else {
      throw new Error('Expected swap action')
    }
  })

  it('still parses other intent actions after SwapIntentSchema is in the union', () => {
    // Regression: adding SwapIntentSchema must not break the union for other actions.
    const buy = IntentSchema.parse({
      action: 'buy_crypto',
      asset: 'USDT',
      fiatAmount: '5000',
      fiatCurrency: 'NGN',
    })
    expect(buy.action).toBe('buy_crypto')

    const sell = IntentSchema.parse({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '3.0',
      fiatCurrency: 'NGN',
    })
    expect(sell.action).toBe('sell_crypto')
  })
})
