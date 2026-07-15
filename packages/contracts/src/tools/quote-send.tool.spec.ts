/**
 * Schema contract tests for quote-send and execute-send tools (task N1).
 *
 * TDD: validates that valid payloads parse and invalid ones are rejected.
 * Tests run inside the contracts package — no NestJS, no HTTP.
 */

import { QuoteSendInputSchema, QuoteSendOutputSchema } from './quote-send.tool'
import { SendProposalConfirmationSchema } from './execute-send.tool'

// ---------------------------------------------------------------------------
// QuoteSendInputSchema
// ---------------------------------------------------------------------------

describe('QuoteSendInputSchema', () => {
  it('accepts a valid send-quote input', () => {
    const result = QuoteSendInputSchema.safeParse({
      asset: 'USDT',
      cryptoAmount: '10.5',
      network: 'TRON',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unsupported asset', () => {
    const result = QuoteSendInputSchema.safeParse({
      asset: 'DOGE',
      cryptoAmount: '10.5',
      network: 'TRON',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unsupported network', () => {
    const result = QuoteSendInputSchema.safeParse({
      asset: 'USDT',
      cryptoAmount: '10.5',
      network: 'ETHEREUM',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-numeric cryptoAmount', () => {
    const result = QuoteSendInputSchema.safeParse({
      asset: 'USDT',
      cryptoAmount: 'abc',
      network: 'TRON',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a cryptoAmount with more than 8 decimal places', () => {
    const result = QuoteSendInputSchema.safeParse({
      asset: 'USDT',
      cryptoAmount: '1.123456789', // 9 d.p.
      network: 'TRON',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a whole-number cryptoAmount', () => {
    const result = QuoteSendInputSchema.safeParse({
      asset: 'USDT',
      cryptoAmount: '100',
      network: 'TRON',
    })
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// QuoteSendOutputSchema
// ---------------------------------------------------------------------------

describe('QuoteSendOutputSchema', () => {
  const VALID_OUTPUT = {
    asset: 'USDT',
    cryptoAmount: '10.5',
    network: 'TRON',
    networkFeeCrypto: '1',
    totalDebit: '11.5',
    quotedAt: '2026-06-23T00:00:00.000Z',
    expiresInSec: 30,
  }

  it('accepts a valid send-quote output', () => {
    const result = QuoteSendOutputSchema.safeParse(VALID_OUTPUT)
    expect(result.success).toBe(true)
  })

  it('rejects a missing networkFeeCrypto field', () => {
    const { networkFeeCrypto: _removed, ...rest } = VALID_OUTPUT
    const result = QuoteSendOutputSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects a missing totalDebit field', () => {
    const { totalDebit: _removed, ...rest } = VALID_OUTPUT
    const result = QuoteSendOutputSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects a non-positive expiresInSec', () => {
    const result = QuoteSendOutputSchema.safeParse({ ...VALID_OUTPUT, expiresInSec: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects a non-datetime quotedAt', () => {
    const result = QuoteSendOutputSchema.safeParse({ ...VALID_OUTPUT, quotedAt: 'not-a-date' })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SendProposalConfirmationSchema
// ---------------------------------------------------------------------------

describe('SendProposalConfirmationSchema', () => {
  const VALID_CONFIRMATION = {
    proposalId: '550e8400-e29b-41d4-a716-446655440000',
    asset: 'USDT',
    cryptoAmount: '10.5',
    network: 'TRON',
    networkFeeCrypto: '1',
    totalDebit: '11.5',
    toAddressMasked: 'TRX123...abcd',
    expiresAt: '2026-06-23T00:00:30.000Z',
  }

  it('accepts a valid send confirmation without beneficiaryLabel', () => {
    const result = SendProposalConfirmationSchema.safeParse(VALID_CONFIRMATION)
    expect(result.success).toBe(true)
  })

  it('accepts a valid send confirmation with beneficiaryLabel', () => {
    const result = SendProposalConfirmationSchema.safeParse({
      ...VALID_CONFIRMATION,
      beneficiaryLabel: 'Alice',
    })
    expect(result.success).toBe(true)
  })

  it('accepts an internal-transfer shape (no toAddressMasked, instant:true)', () => {
    // An internal (PayID) transfer has no on-chain address — it carries the
    // recipient's display name + handle and settles instantly (Task 6).
    const { toAddressMasked: _omit, ...rest } = VALID_CONFIRMATION
    const result = SendProposalConfirmationSchema.safeParse({
      ...rest,
      networkFeeCrypto: '0',
      totalDebit: rest.cryptoAmount,
      recipientDisplayName: 'Alice A.',
      recipientHandle: 'alice',
      instant: true,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-UUID proposalId', () => {
    const result = SendProposalConfirmationSchema.safeParse({
      ...VALID_CONFIRMATION,
      proposalId: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a confirmation without toAddressMasked (internal transfer has no address)', () => {
    // toAddressMasked is now optional: an on-chain send sets it, an internal
    // (PayID) transfer omits it (Task 6). A normal send still validates with it
    // present (see the VALID_CONFIRMATION cases above).
    const { toAddressMasked: _removed, ...rest } = VALID_CONFIRMATION
    const result = SendProposalConfirmationSchema.safeParse(rest)
    expect(result.success).toBe(true)
  })

  it('rejects a non-datetime expiresAt', () => {
    const result = SendProposalConfirmationSchema.safeParse({
      ...VALID_CONFIRMATION,
      expiresAt: '2026-06-23',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing networkFeeCrypto', () => {
    const { networkFeeCrypto: _removed, ...rest } = VALID_CONFIRMATION
    const result = SendProposalConfirmationSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects a missing totalDebit', () => {
    const { totalDebit: _removed, ...rest } = VALID_CONFIRMATION
    const result = SendProposalConfirmationSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })
})
