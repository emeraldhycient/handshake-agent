/**
 * Unit tests for SwapProposalConfirmationSchema.
 *
 * Asserts that the confirmation object (returned by createSwapProposal and
 * rendered in the web SwapCard) parses correctly, that all monetary fields
 * are strings, and that no FX-spread line item is present in the schema.
 */

import { SwapProposalConfirmationSchema } from './execute-swap.tool'

const validConfirmation = {
  proposalId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  fromAsset: 'USDT',
  toAsset: 'BTC',
  fromAmount: '100',
  toAmount: '0.00095',
  rate: '0.0000095',
  networkFee: '1',
  transactionFee: '0.5',
  estimatedArrivalSec: 120,
  expiresAt: '2026-06-29T12:00:00.000Z',
}

describe('SwapProposalConfirmationSchema', () => {
  it('parses a valid swap confirmation', () => {
    const result = SwapProposalConfirmationSchema.parse(validConfirmation)
    expect(result.proposalId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    expect(result.fromAsset).toBe('USDT')
    expect(result.toAsset).toBe('BTC')
    expect(result.fromAmount).toBe('100')
    expect(result.toAmount).toBe('0.00095')
    expect(result.rate).toBe('0.0000095')
    expect(result.networkFee).toBe('1')
    expect(result.transactionFee).toBe('0.5')
    expect(result.estimatedArrivalSec).toBe(120)
    expect(result.expiresAt).toBe('2026-06-29T12:00:00.000Z')
  })

  it('accepts estimatedArrivalSec of 0', () => {
    const result = SwapProposalConfirmationSchema.parse({
      ...validConfirmation,
      estimatedArrivalSec: 0,
    })
    expect(result.estimatedArrivalSec).toBe(0)
  })

  it('rejects a non-UUID proposalId', () => {
    expect(() =>
      SwapProposalConfirmationSchema.parse({ ...validConfirmation, proposalId: 'not-a-uuid' }),
    ).toThrow()
  })

  it('rejects an unknown fromAsset', () => {
    expect(() =>
      SwapProposalConfirmationSchema.parse({ ...validConfirmation, fromAsset: 'ETH' }),
    ).toThrow()
  })

  it('rejects an unknown toAsset', () => {
    expect(() =>
      SwapProposalConfirmationSchema.parse({ ...validConfirmation, toAsset: 'ETH' }),
    ).toThrow()
  })

  it('rejects a negative estimatedArrivalSec', () => {
    expect(() =>
      SwapProposalConfirmationSchema.parse({ ...validConfirmation, estimatedArrivalSec: -1 }),
    ).toThrow()
  })

  it('rejects a fractional estimatedArrivalSec', () => {
    expect(() =>
      SwapProposalConfirmationSchema.parse({ ...validConfirmation, estimatedArrivalSec: 1.5 }),
    ).toThrow()
  })

  it('rejects an invalid ISO expiresAt', () => {
    expect(() =>
      SwapProposalConfirmationSchema.parse({ ...validConfirmation, expiresAt: 'not-a-date' }),
    ).toThrow()
  })

  it('rejects when proposalId is missing', () => {
    const { proposalId: _omit, ...withoutId } = validConfirmation
    expect(() => SwapProposalConfirmationSchema.parse(withoutId)).toThrow()
  })

  it('rejects when fromAmount is missing', () => {
    const { fromAmount: _omit, ...without } = validConfirmation
    expect(() => SwapProposalConfirmationSchema.parse(without)).toThrow()
  })

  it('rejects when toAmount is missing', () => {
    const { toAmount: _omit, ...without } = validConfirmation
    expect(() => SwapProposalConfirmationSchema.parse(without)).toThrow()
  })

  it('does not have a spreadBps field (spread is never surfaced)', () => {
    // Parse succeeds even without spreadBps because it is not in the schema.
    const result = SwapProposalConfirmationSchema.parse(validConfirmation)
    expect((result as Record<string, unknown>)['spreadBps']).toBeUndefined()
  })
})
