import { describe, it, expect } from 'vitest'
import { TransactionHistoryResponseSchema } from './transaction-history.schema'
import { AgentTurnOutcomeSchema } from '../chat/chat.schemas'

const sample = {
  window: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-29T00:00:00.000Z', label: 'This month' },
  items: [
    { id: 't1', type: 'buy', status: 'completed', direction: 'in',
      asset: 'USDT', cryptoAmount: '29.97 USDT', fiatAmount: '₦50,000.00', fiatCurrency: 'NGN',
      createdAt: '2026-06-10T10:00:00.000Z', receiptNumber: 'HS-2026-000001' },
  ],
  totalCount: 1,
  truncated: false,
  downloadUrl: 'http://localhost:3001/transactions/statement/download?token=abc.def',
}

describe('TransactionHistoryResponse', () => {
  it('parses a valid response', () => {
    expect(TransactionHistoryResponseSchema.parse(sample)).toEqual(sample)
  })
  it('is a valid transactions AgentTurnOutcome member', () => {
    const r = AgentTurnOutcomeSchema.safeParse({ kind: 'transactions', ...sample })
    expect(r.success).toBe(true)
  })
})
