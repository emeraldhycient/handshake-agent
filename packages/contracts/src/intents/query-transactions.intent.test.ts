import { describe, it, expect } from 'vitest'
import { IntentSchema } from './index'
import { QueryTransactionsIntentSchema } from './query-transactions.intent'

describe('QueryTransactionsIntent', () => {
  it('parses a period-only query and defaults download=false', () => {
    const parsed = QueryTransactionsIntentSchema.parse({
      action: 'query_transactions',
      period: 'last_week',
    })
    expect(parsed).toEqual({ action: 'query_transactions', period: 'last_week', download: false })
  })

  it('parses an explicit date range with a type filter and download', () => {
    const parsed = QueryTransactionsIntentSchema.parse({
      action: 'query_transactions',
      from: '2026-06-01',
      to: '2026-06-15',
      txType: 'send',
      download: true,
    })
    expect(parsed.from).toBe('2026-06-01')
    expect(parsed.to).toBe('2026-06-15')
    expect(parsed.txType).toBe('send')
    expect(parsed.download).toBe(true)
  })

  it('rejects a malformed date', () => {
    const r = QueryTransactionsIntentSchema.safeParse({ action: 'query_transactions', from: '06/01/2026' })
    expect(r.success).toBe(false)
  })

  it('is a member of the Intent discriminated union', () => {
    const r = IntentSchema.safeParse({ action: 'query_transactions', period: 'today' })
    expect(r.success).toBe(true)
  })
})
