import { describe, expect, it } from 'vitest'
import {
  ChatMessageRequestSchema,
  AgentTurnOutcomeSchema,
  WebChatResponseSchema,
  AuthorizeProposalResponseSchema,
  ExecuteProposalRequestSchema,
  ExecuteProposalResponseSchema,
  TransactionStatusResponseSchema,
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

  it('rejects a not_supported outcome with an arbitrary model-emitted action string', () => {
    // Ensures raw LLM output cannot pass through as-is — only enum members are valid.
    expect(() =>
      AgentTurnOutcomeSchema.parse({
        kind: 'not_supported',
        action: 'unexpected_string',
      }),
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

describe('AuthorizeProposalResponseSchema', () => {
  const validAuthorizeResponse = {
    directiveId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    nonce: 'abc123nonce',
    expiresAt: '2026-06-29T12:00:00.000Z',
  }

  it('accepts a valid authorize response', () => {
    const result = AuthorizeProposalResponseSchema.parse(validAuthorizeResponse)
    expect(result.directiveId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    expect(result.nonce).toBe('abc123nonce')
    expect(result.expiresAt).toBe('2026-06-29T12:00:00.000Z')
  })

  it('rejects when directiveId is missing', () => {
    const { directiveId: _omitted, ...withoutDirectiveId } = validAuthorizeResponse
    expect(() => AuthorizeProposalResponseSchema.parse(withoutDirectiveId)).toThrow()
  })

  it('rejects when directiveId is not a UUID', () => {
    expect(() =>
      AuthorizeProposalResponseSchema.parse({ ...validAuthorizeResponse, directiveId: 'not-a-uuid' }),
    ).toThrow()
  })

  it('rejects when nonce is an empty string', () => {
    expect(() =>
      AuthorizeProposalResponseSchema.parse({ ...validAuthorizeResponse, nonce: '' }),
    ).toThrow()
  })

  it('rejects when expiresAt is not a valid ISO datetime string', () => {
    expect(() =>
      AuthorizeProposalResponseSchema.parse({ ...validAuthorizeResponse, expiresAt: 'not-a-date' }),
    ).toThrow()
  })

  it('rejects when expiresAt is missing', () => {
    const { expiresAt: _omitted, ...withoutExpiresAt } = validAuthorizeResponse
    expect(() => AuthorizeProposalResponseSchema.parse(withoutExpiresAt)).toThrow()
  })
})

describe('ExecuteProposalRequestSchema', () => {
  const validExecuteRequest = {
    directiveId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    nonce: 'xyz789nonce',
    pin: '1234',
    idempotencyKey: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  }

  it('accepts a valid execute request without optional deviceFingerprint', () => {
    const result = ExecuteProposalRequestSchema.parse(validExecuteRequest)
    expect(result.directiveId).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
    expect(result.nonce).toBe('xyz789nonce')
    expect(result.pin).toBe('1234')
    expect(result.idempotencyKey).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc')
    expect(result.deviceFingerprint).toBeUndefined()
  })

  it('accepts a valid execute request with optional deviceFingerprint', () => {
    const result = ExecuteProposalRequestSchema.parse({
      ...validExecuteRequest,
      deviceFingerprint: 'fp-abc123',
    })
    expect(result.deviceFingerprint).toBe('fp-abc123')
  })

  it('accepts an 8-character pin (upper boundary)', () => {
    const result = ExecuteProposalRequestSchema.parse({ ...validExecuteRequest, pin: '12345678' })
    expect(result.pin).toBe('12345678')
  })

  it('rejects when directiveId is missing', () => {
    const { directiveId: _omitted, ...withoutDirectiveId } = validExecuteRequest
    expect(() => ExecuteProposalRequestSchema.parse(withoutDirectiveId)).toThrow()
  })

  it('rejects when directiveId is not a UUID', () => {
    expect(() =>
      ExecuteProposalRequestSchema.parse({ ...validExecuteRequest, directiveId: 'bad-id' }),
    ).toThrow()
  })

  it('rejects when nonce is an empty string', () => {
    expect(() =>
      ExecuteProposalRequestSchema.parse({ ...validExecuteRequest, nonce: '' }),
    ).toThrow()
  })

  it('rejects when pin is shorter than 4 characters', () => {
    expect(() =>
      ExecuteProposalRequestSchema.parse({ ...validExecuteRequest, pin: '123' }),
    ).toThrow()
  })

  it('rejects when pin is longer than 8 characters', () => {
    expect(() =>
      ExecuteProposalRequestSchema.parse({ ...validExecuteRequest, pin: '123456789' }),
    ).toThrow()
  })

  it('rejects when idempotencyKey is not a UUID', () => {
    expect(() =>
      ExecuteProposalRequestSchema.parse({ ...validExecuteRequest, idempotencyKey: 'not-a-uuid' }),
    ).toThrow()
  })

  it('rejects when idempotencyKey is missing', () => {
    const { idempotencyKey: _omitted, ...withoutKey } = validExecuteRequest
    expect(() => ExecuteProposalRequestSchema.parse(withoutKey)).toThrow()
  })
})

describe('ExecuteProposalResponseSchema', () => {
  const validPayment = {
    accountNumber: '1234567890',
    bankName: 'Test Bank',
    providerRef: 'flw-ref-001',
    amount: '5000',
    currency: 'NGN',
  }

  const validExecuteResponse = {
    transactionId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    status: 'settling' as const,
  }

  it('accepts a valid execute response with status settling and no optional fields', () => {
    const result = ExecuteProposalResponseSchema.parse(validExecuteResponse)
    expect(result.transactionId).toBe('dddddddd-dddd-dddd-dddd-dddddddddddd')
    expect(result.status).toBe('settling')
    expect(result.payment).toBeUndefined()
    expect(result.payout).toBeUndefined()
    expect(result.onChain).toBeUndefined()
  })

  it('accepts a valid execute response with status completed', () => {
    const result = ExecuteProposalResponseSchema.parse({ ...validExecuteResponse, status: 'completed' })
    expect(result.status).toBe('completed')
  })

  it('accepts a valid execute response with optional payment field', () => {
    const result = ExecuteProposalResponseSchema.parse({ ...validExecuteResponse, payment: validPayment })
    expect(result.payment?.accountNumber).toBe('1234567890')
    expect(result.payment?.bankName).toBe('Test Bank')
  })

  it('accepts a valid execute response with optional payout field', () => {
    const result = ExecuteProposalResponseSchema.parse({
      ...validExecuteResponse,
      payout: { providerRef: 'blockradar-ref-001' },
    })
    expect(result.payout?.providerRef).toBe('blockradar-ref-001')
  })

  it('accepts a valid execute response with optional onChain field', () => {
    const result = ExecuteProposalResponseSchema.parse({
      ...validExecuteResponse,
      onChain: { providerRef: 'txhash-abc123' },
    })
    expect(result.onChain?.providerRef).toBe('txhash-abc123')
  })

  it('rejects when transactionId is missing', () => {
    const { transactionId: _omitted, ...withoutId } = validExecuteResponse
    expect(() => ExecuteProposalResponseSchema.parse(withoutId)).toThrow()
  })

  it('rejects when transactionId is not a UUID', () => {
    expect(() =>
      ExecuteProposalResponseSchema.parse({ ...validExecuteResponse, transactionId: 'not-a-uuid' }),
    ).toThrow()
  })

  it('rejects when status is an unexpected string', () => {
    expect(() =>
      ExecuteProposalResponseSchema.parse({ ...validExecuteResponse, status: 'pending' }),
    ).toThrow()
  })

  it('rejects when payment is present but missing a required subfield', () => {
    const incompletePayment = { accountNumber: '1234567890', bankName: 'Test Bank' }
    expect(() =>
      ExecuteProposalResponseSchema.parse({ ...validExecuteResponse, payment: incompletePayment }),
    ).toThrow()
  })
})

describe('TransactionStatusResponseSchema', () => {
  const validStatusResponse = {
    id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    type: 'buy',
    status: 'completed',
    createdAt: '2026-06-29T12:00:00.000Z',
  }

  it('accepts a valid status response with only required fields', () => {
    const result = TransactionStatusResponseSchema.parse(validStatusResponse)
    expect(result.id).toBe('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
    expect(result.type).toBe('buy')
    expect(result.status).toBe('completed')
    expect(result.createdAt).toBe('2026-06-29T12:00:00.000Z')
    expect(result.receiptNumber).toBeUndefined()
    expect(result.payment).toBeUndefined()
    expect(result.asset).toBeUndefined()
  })

  it('accepts a valid status response with all optional fields', () => {
    const result = TransactionStatusResponseSchema.parse({
      ...validStatusResponse,
      receiptNumber: 'RCPT-001',
      payment: {
        accountNumber: '1234567890',
        bankName: 'Test Bank',
        providerRef: 'flw-ref-001',
        amount: '5000',
        currency: 'NGN',
      },
      asset: 'USDT',
      cryptoAmount: '4.5',
      fiatAmount: '5000',
      fiatCurrency: 'NGN',
    })
    expect(result.receiptNumber).toBe('RCPT-001')
    expect(result.payment?.bankName).toBe('Test Bank')
    expect(result.asset).toBe('USDT')
    expect(result.cryptoAmount).toBe('4.5')
    expect(result.fiatAmount).toBe('5000')
    expect(result.fiatCurrency).toBe('NGN')
  })

  it('rejects when id is missing', () => {
    const { id: _omitted, ...withoutId } = validStatusResponse
    expect(() => TransactionStatusResponseSchema.parse(withoutId)).toThrow()
  })

  it('rejects when id is not a UUID', () => {
    expect(() =>
      TransactionStatusResponseSchema.parse({ ...validStatusResponse, id: 'not-a-uuid' }),
    ).toThrow()
  })

  it('rejects when type is missing', () => {
    const { type: _omitted, ...withoutType } = validStatusResponse
    expect(() => TransactionStatusResponseSchema.parse(withoutType)).toThrow()
  })

  it('rejects when status is missing', () => {
    const { status: _omitted, ...withoutStatus } = validStatusResponse
    expect(() => TransactionStatusResponseSchema.parse(withoutStatus)).toThrow()
  })

  it('rejects when createdAt is not a valid ISO datetime string', () => {
    expect(() =>
      TransactionStatusResponseSchema.parse({ ...validStatusResponse, createdAt: 'not-a-date' }),
    ).toThrow()
  })

  it('rejects when createdAt is missing', () => {
    const { createdAt: _omitted, ...withoutCreatedAt } = validStatusResponse
    expect(() => TransactionStatusResponseSchema.parse(withoutCreatedAt)).toThrow()
  })

  it('rejects when payment is present but missing required subfields', () => {
    expect(() =>
      TransactionStatusResponseSchema.parse({
        ...validStatusResponse,
        payment: { accountNumber: '1234567890' },
      }),
    ).toThrow()
  })
})
