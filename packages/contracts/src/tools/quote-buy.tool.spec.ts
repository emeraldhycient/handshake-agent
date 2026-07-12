/**
 * Schema contract tests for quote-buy and execute-buy tools.
 *
 * TDD: validates that valid payloads parse and invalid ones are rejected.
 * Mirrors the quote-send.tool spec (task N1) for the buy vertical. Tests run
 * inside the contracts package — no NestJS, no HTTP.
 */

import { QuoteBuyInputSchema, QuoteBuyOutputSchema } from './quote-buy.tool'
import { BuyProposalConfirmationSchema } from './execute-buy.tool'

// ---------------------------------------------------------------------------
// QuoteBuyInputSchema
// ---------------------------------------------------------------------------

describe('QuoteBuyInputSchema', () => {
  it('accepts a valid buy-quote input', () => {
    const result = QuoteBuyInputSchema.safeParse({
      asset: 'USDT',
      fiatAmount: '50000',
      fiatCurrency: 'NGN',
    })
    expect(result.success).toBe(true)
  })

  it('defaults fiatCurrency to NGN when omitted', () => {
    const parsed = QuoteBuyInputSchema.parse({
      asset: 'USDT',
      fiatAmount: '50000',
    })
    expect(parsed.fiatCurrency).toBe('NGN')
  })

  it('accepts a fiatAmount with two decimal places', () => {
    const result = QuoteBuyInputSchema.safeParse({
      asset: 'USDT',
      fiatAmount: '50000.50',
      fiatCurrency: 'NGN',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unsupported asset', () => {
    const result = QuoteBuyInputSchema.safeParse({
      asset: 'DOGE',
      fiatAmount: '50000',
      fiatCurrency: 'NGN',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a fiatAmount with more than two decimal places', () => {
    const result = QuoteBuyInputSchema.safeParse({
      asset: 'USDT',
      fiatAmount: '10.123', // 3 d.p.
      fiatCurrency: 'NGN',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-numeric fiatAmount', () => {
    const result = QuoteBuyInputSchema.safeParse({
      asset: 'USDT',
      fiatAmount: 'abc',
      fiatCurrency: 'NGN',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a lowercase (non-uppercase) fiatCurrency', () => {
    const result = QuoteBuyInputSchema.safeParse({
      asset: 'USDT',
      fiatAmount: '50000',
      fiatCurrency: 'ngn',
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// QuoteBuyOutputSchema
// ---------------------------------------------------------------------------

describe('QuoteBuyOutputSchema', () => {
  const VALID_OUTPUT = {
    asset: 'USDT',
    fiatAmount: '50000',
    fiatCurrency: 'NGN',
    cryptoAmount: '32.5',
    baseRate: '1540',
    fxRate: '1538.46',
    spreadBps: 150,
    processingFeeBps: 50,
    quotedAt: '2026-06-23T00:00:00.000Z',
    expiresInSec: 30,
  }

  it('accepts a valid buy-quote output', () => {
    const result = QuoteBuyOutputSchema.safeParse(VALID_OUTPUT)
    expect(result.success).toBe(true)
  })

  it('rejects a missing baseRate field', () => {
    const { baseRate: _removed, ...rest } = VALID_OUTPUT
    const result = QuoteBuyOutputSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects a negative spreadBps', () => {
    const result = QuoteBuyOutputSchema.safeParse({ ...VALID_OUTPUT, spreadBps: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects a non-integer processingFeeBps', () => {
    const result = QuoteBuyOutputSchema.safeParse({ ...VALID_OUTPUT, processingFeeBps: 12.5 })
    expect(result.success).toBe(false)
  })

  it('rejects a non-positive expiresInSec', () => {
    const result = QuoteBuyOutputSchema.safeParse({ ...VALID_OUTPUT, expiresInSec: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects a non-datetime quotedAt', () => {
    const result = QuoteBuyOutputSchema.safeParse({ ...VALID_OUTPUT, quotedAt: 'not-a-date' })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// BuyProposalConfirmationSchema
// ---------------------------------------------------------------------------

describe('BuyProposalConfirmationSchema', () => {
  const VALID_CONFIRMATION = {
    proposalId: '550e8400-e29b-41d4-a716-446655440000',
    asset: 'USDT',
    fiatAmount: '50000',
    fiatCurrency: 'NGN',
    cryptoAmount: '32.5',
    fxRate: '1538.46',
    spreadBps: 150,
    processingFeeBps: 50,
    processingFeeAmount: '250',
    totalFiat: '50250',
    expiresAt: '2026-06-23T00:00:30.000Z',
  }

  it('accepts a valid buy confirmation', () => {
    const result = BuyProposalConfirmationSchema.safeParse(VALID_CONFIRMATION)
    expect(result.success).toBe(true)
  })

  it('rejects a non-UUID proposalId', () => {
    const result = BuyProposalConfirmationSchema.safeParse({
      ...VALID_CONFIRMATION,
      proposalId: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing processingFeeAmount', () => {
    const { processingFeeAmount: _removed, ...rest } = VALID_CONFIRMATION
    const result = BuyProposalConfirmationSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects a missing totalFiat', () => {
    const { totalFiat: _removed, ...rest } = VALID_CONFIRMATION
    const result = BuyProposalConfirmationSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects a non-datetime expiresAt', () => {
    const result = BuyProposalConfirmationSchema.safeParse({
      ...VALID_CONFIRMATION,
      expiresAt: '2026-06-23',
    })
    expect(result.success).toBe(false)
  })
})
