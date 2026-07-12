/**
 * Schema contract tests for quote-sell and execute-sell tools.
 *
 * TDD: validates that valid payloads parse and invalid ones are rejected.
 * Mirrors the quote-send.tool spec (task N1) for the sell vertical. Tests run
 * inside the contracts package — no NestJS, no HTTP.
 */

import { QuoteSellInputSchema, QuoteSellOutputSchema } from './quote-sell.tool'
import { SellProposalConfirmationSchema } from './execute-sell.tool'

// ---------------------------------------------------------------------------
// QuoteSellInputSchema
// ---------------------------------------------------------------------------

describe('QuoteSellInputSchema', () => {
  it('accepts a valid sell-quote input', () => {
    const result = QuoteSellInputSchema.safeParse({
      asset: 'USDT',
      cryptoAmount: '10.5',
      fiatCurrency: 'NGN',
    })
    expect(result.success).toBe(true)
  })

  it('defaults fiatCurrency to NGN when omitted', () => {
    const parsed = QuoteSellInputSchema.parse({
      asset: 'USDT',
      cryptoAmount: '10.5',
    })
    expect(parsed.fiatCurrency).toBe('NGN')
  })

  it('accepts a cryptoAmount with eight decimal places', () => {
    const result = QuoteSellInputSchema.safeParse({
      asset: 'USDT',
      cryptoAmount: '1.12345678', // 8 d.p.
      fiatCurrency: 'NGN',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unsupported asset', () => {
    const result = QuoteSellInputSchema.safeParse({
      asset: 'DOGE',
      cryptoAmount: '10.5',
      fiatCurrency: 'NGN',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a cryptoAmount with more than eight decimal places', () => {
    const result = QuoteSellInputSchema.safeParse({
      asset: 'USDT',
      cryptoAmount: '1.123456789', // 9 d.p.
      fiatCurrency: 'NGN',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-numeric cryptoAmount', () => {
    const result = QuoteSellInputSchema.safeParse({
      asset: 'USDT',
      cryptoAmount: 'abc',
      fiatCurrency: 'NGN',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a lowercase (non-uppercase) fiatCurrency', () => {
    const result = QuoteSellInputSchema.safeParse({
      asset: 'USDT',
      cryptoAmount: '10.5',
      fiatCurrency: 'ngn',
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// QuoteSellOutputSchema
// ---------------------------------------------------------------------------

describe('QuoteSellOutputSchema', () => {
  const VALID_OUTPUT = {
    asset: 'USDT',
    cryptoAmount: '10.5',
    fiatCurrency: 'NGN',
    netFiatAmount: '15800',
    baseRate: '1520',
    fxRate: '1504.76',
    spreadBps: 100,
    processingFeeBps: 50,
    processingFeeAmount: '80',
    quotedAt: '2026-06-23T00:00:00.000Z',
    expiresInSec: 30,
  }

  it('accepts a valid sell-quote output', () => {
    const result = QuoteSellOutputSchema.safeParse(VALID_OUTPUT)
    expect(result.success).toBe(true)
  })

  it('rejects a missing netFiatAmount field', () => {
    const { netFiatAmount: _removed, ...rest } = VALID_OUTPUT
    const result = QuoteSellOutputSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects a missing processingFeeAmount field', () => {
    const { processingFeeAmount: _removed, ...rest } = VALID_OUTPUT
    const result = QuoteSellOutputSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects a non-positive expiresInSec', () => {
    const result = QuoteSellOutputSchema.safeParse({ ...VALID_OUTPUT, expiresInSec: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects a non-datetime quotedAt', () => {
    const result = QuoteSellOutputSchema.safeParse({ ...VALID_OUTPUT, quotedAt: 'not-a-date' })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SellProposalConfirmationSchema
// ---------------------------------------------------------------------------

describe('SellProposalConfirmationSchema', () => {
  const VALID_CONFIRMATION = {
    proposalId: '550e8400-e29b-41d4-a716-446655440000',
    asset: 'USDT',
    cryptoAmount: '10.5',
    fiatCurrency: 'NGN',
    netFiatAmount: '15800',
    fxRate: '1504.76',
    processingFeeAmount: '80',
    expiresAt: '2026-06-23T00:00:30.000Z',
  }

  it('accepts a valid sell confirmation without beneficiaryLabel', () => {
    const result = SellProposalConfirmationSchema.safeParse(VALID_CONFIRMATION)
    expect(result.success).toBe(true)
  })

  it('accepts a valid sell confirmation with beneficiaryLabel', () => {
    const result = SellProposalConfirmationSchema.safeParse({
      ...VALID_CONFIRMATION,
      beneficiaryLabel: 'GTBank •••• 4821',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-UUID proposalId', () => {
    const result = SellProposalConfirmationSchema.safeParse({
      ...VALID_CONFIRMATION,
      proposalId: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing netFiatAmount', () => {
    const { netFiatAmount: _removed, ...rest } = VALID_CONFIRMATION
    const result = SellProposalConfirmationSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects a non-datetime expiresAt', () => {
    const result = SellProposalConfirmationSchema.safeParse({
      ...VALID_CONFIRMATION,
      expiresAt: '2026-06-23',
    })
    expect(result.success).toBe(false)
  })
})
