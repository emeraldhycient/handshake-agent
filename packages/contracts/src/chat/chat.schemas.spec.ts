import { describe, expect, it } from 'vitest'
import {
  ChatMessageRequestSchema,
  AgentTurnOutcomeSchema,
  WebChatResponseSchema,
} from './chat.schemas'

// Valid BuyProposalConfirmation fixture for use in proposal/buy tests.
const validBuyConfirmation = {
  proposalId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  asset: 'USDT',
  fiatAmount: '5000',
  fiatCurrency: 'NGN',
  cryptoAmount: '4.5',
  fxRate: '1110',
  spreadBps: 50,
  processingFeeBps: 30,
  processingFeeAmount: '15',
  totalFiat: '5015',
  expiresAt: '2026-06-29T12:00:00.000Z',
}

describe('ChatMessageRequestSchema', () => {
  it('accepts a valid message with only text', () => {
    const result = ChatMessageRequestSchema.parse({ text: 'Buy 100 USDT' })
    expect(result.text).toBe('Buy 100 USDT')
    expect(result.beneficiaryId).toBeUndefined()
  })

  it('accepts an optional beneficiaryId when provided as a UUID', () => {
    const result = ChatMessageRequestSchema.parse({
      text: 'Send crypto',
      beneficiaryId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    })
    expect(result.beneficiaryId).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  })

  it('rejects an empty text string', () => {
    expect(() => ChatMessageRequestSchema.parse({ text: '' })).toThrow()
  })

  it('rejects text longer than 1000 characters', () => {
    expect(() =>
      ChatMessageRequestSchema.parse({ text: 'a'.repeat(1001) }),
    ).toThrow()
  })

  it('accepts text of exactly 1000 characters', () => {
    const result = ChatMessageRequestSchema.parse({ text: 'a'.repeat(1000) })
    expect(result.text).toHaveLength(1000)
  })

  it('rejects a non-UUID beneficiaryId', () => {
    expect(() =>
      ChatMessageRequestSchema.parse({ text: 'hello', beneficiaryId: 'not-a-uuid' }),
    ).toThrow()
  })
})

describe('AgentTurnOutcomeSchema', () => {
  it('accepts a clarification outcome', () => {
    const result = AgentTurnOutcomeSchema.parse({
      kind: 'clarification',
      text: 'Could you clarify?',
    })
    expect(result.kind).toBe('clarification')
  })

  it('accepts a needs_kyc outcome', () => {
    const result = AgentTurnOutcomeSchema.parse({ kind: 'needs_kyc' })
    expect(result.kind).toBe('needs_kyc')
  })

  it('accepts a needs_beneficiary outcome with bank_account type', () => {
    const result = AgentTurnOutcomeSchema.parse({
      kind: 'needs_beneficiary',
      beneficiaryType: 'bank_account',
    })
    expect(result.kind).toBe('needs_beneficiary')
    if (result.kind === 'needs_beneficiary') {
      expect(result.beneficiaryType).toBe('bank_account')
    }
  })

  it('accepts a needs_beneficiary outcome with crypto_address type', () => {
    const result = AgentTurnOutcomeSchema.parse({
      kind: 'needs_beneficiary',
      beneficiaryType: 'crypto_address',
    })
    if (result.kind === 'needs_beneficiary') {
      expect(result.beneficiaryType).toBe('crypto_address')
    }
  })

  it('accepts a receive outcome with minimal deposit fields', () => {
    const result = AgentTurnOutcomeSchema.parse({
      kind: 'receive',
      deposit: { asset: 'USDT', network: 'tron', address: 'TXxx' },
    })
    expect(result.kind).toBe('receive')
    if (result.kind === 'receive') {
      expect(result.deposit.address).toBe('TXxx')
      expect(result.deposit.minAmount).toBeUndefined()
      expect(result.deposit.etaText).toBeUndefined()
    }
  })

  it('accepts a receive outcome with optional deposit fields', () => {
    const result = AgentTurnOutcomeSchema.parse({
      kind: 'receive',
      deposit: {
        asset: 'USDT',
        network: 'tron',
        address: 'TXxx',
        minAmount: '10',
        etaText: '~5 minutes',
      },
    })
    if (result.kind === 'receive') {
      expect(result.deposit.minAmount).toBe('10')
      expect(result.deposit.etaText).toBe('~5 minutes')
    }
  })

  it('accepts a proposal/buy outcome', () => {
    const result = AgentTurnOutcomeSchema.parse({
      kind: 'proposal',
      txType: 'buy',
      proposalId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      confirmation: validBuyConfirmation,
    })
    expect(result.kind).toBe('proposal')
    if (result.kind === 'proposal') {
      expect(result.txType).toBe('buy')
      expect(result.proposalId).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc')
    }
  })

  it('accepts a not_supported outcome', () => {
    const result = AgentTurnOutcomeSchema.parse({
      kind: 'not_supported',
      action: 'swap',
    })
    expect(result.kind).toBe('not_supported')
    if (result.kind === 'not_supported') {
      expect(result.action).toBe('swap')
    }
  })

  it('rejects an unknown kind', () => {
    expect(() =>
      AgentTurnOutcomeSchema.parse({ kind: 'unknown_kind' }),
    ).toThrow()
  })

  it('rejects a proposal outcome missing proposalId', () => {
    expect(() =>
      AgentTurnOutcomeSchema.parse({
        kind: 'proposal',
        txType: 'buy',
        // proposalId intentionally omitted
        confirmation: validBuyConfirmation,
      }),
    ).toThrow()
  })
})

describe('WebChatResponseSchema', () => {
  it('accepts a valid WebChatResponse', () => {
    const result = WebChatResponseSchema.parse({
      reply: { text: 'Here is your quote.' },
      outcome: { kind: 'needs_kyc' },
      conversationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      messageId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    })
    expect(result.reply.text).toBe('Here is your quote.')
    expect(result.conversationId).toBe('dddddddd-dddd-dddd-dddd-dddddddddddd')
    expect(result.messageId).toBe('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
  })

  it('rejects a response with a non-UUID conversationId', () => {
    expect(() =>
      WebChatResponseSchema.parse({
        reply: { text: 'hi' },
        outcome: { kind: 'needs_kyc' },
        conversationId: 'not-a-uuid',
        messageId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      }),
    ).toThrow()
  })

  it('rejects a response with a non-UUID messageId', () => {
    expect(() =>
      WebChatResponseSchema.parse({
        reply: { text: 'hi' },
        outcome: { kind: 'needs_kyc' },
        conversationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        messageId: 'not-a-uuid',
      }),
    ).toThrow()
  })
})
