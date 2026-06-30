import { describe, it, expect } from 'vitest'
import {
  TransactionHistoryResponseSchema,
  TransactionHistoryQuerySchema,
} from './transaction-history.schema'
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
  hasMore: false,
  nextCursor: null,
  txType: 'all',
  downloadUrl: 'http://localhost:3001/transactions/statement/download?token=abc.def',
}

describe('TransactionHistoryResponse', () => {
  it('parses a valid response', () => {
    expect(TransactionHistoryResponseSchema.parse(sample)).toEqual(sample)
  })

  it('carries hasMore + nextCursor + txType when present', () => {
    const parsed = TransactionHistoryResponseSchema.parse({
      ...sample,
      hasMore: true,
      nextCursor: 'MjAyNi0wNi0xMHwwMQ',
      txType: 'send',
    })
    expect(parsed.hasMore).toBe(true)
    expect(parsed.nextCursor).toBe('MjAyNi0wNi0xMHwwMQ')
    expect(parsed.txType).toBe('send')
  })

  it('defaults pagination fields for legacy persisted rows (back-compat)', () => {
    const legacy = {
      window: sample.window,
      items: [],
      totalCount: 0,
      truncated: false,
      downloadUrl: sample.downloadUrl,
    }
    const parsed = TransactionHistoryResponseSchema.parse(legacy)
    expect(parsed.hasMore).toBe(false)
    expect(parsed.nextCursor).toBeNull()
    expect(parsed.txType).toBe('all')
  })

  it('is a valid transactions AgentTurnOutcome member', () => {
    const r = AgentTurnOutcomeSchema.safeParse({ kind: 'transactions', ...sample })
    expect(r.success).toBe(true)
  })
})

describe('TransactionHistoryQuerySchema', () => {
  it('coerces limit + relativeAmount from URL strings', () => {
    const parsed = TransactionHistoryQuerySchema.parse({
      relativeAmount: '2',
      relativeUnit: 'week',
      limit: '25',
    })
    expect(parsed.limit).toBe(25)
    expect(parsed.relativeAmount).toBe(2)
    expect(parsed.relativeUnit).toBe('week')
  })

  it('accepts an empty query (all fields optional)', () => {
    expect(TransactionHistoryQuerySchema.parse({})).toEqual({})
  })

  it('rejects a limit below 1 or above 100', () => {
    expect(TransactionHistoryQuerySchema.safeParse({ limit: '0' }).success).toBe(false)
    expect(TransactionHistoryQuerySchema.safeParse({ limit: '101' }).success).toBe(false)
  })

  it('rejects an invalid txType', () => {
    expect(
      TransactionHistoryQuerySchema.safeParse({ txType: 'gift' }).success,
    ).toBe(false)
  })

  it('passes through a cursor + absolute ISO window', () => {
    const parsed = TransactionHistoryQuerySchema.parse({
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-29T10:00:00.000Z',
      cursor: 'abc',
      txType: 'send',
    })
    expect(parsed.cursor).toBe('abc')
    expect(parsed.from).toBe('2026-06-01T00:00:00.000Z')
  })
})
