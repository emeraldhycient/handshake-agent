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

  it('parses a relative-duration spec (last 2 weeks)', () => {
    const parsed = QueryTransactionsIntentSchema.parse({
      action: 'query_transactions',
      relativeAmount: 2,
      relativeUnit: 'week',
    })
    expect(parsed.relativeAmount).toBe(2)
    expect(parsed.relativeUnit).toBe('week')
    expect(parsed.download).toBe(false)
  })

  it('parses a sub-day relative spec (an hour ago / last 24 hours)', () => {
    expect(
      QueryTransactionsIntentSchema.parse({
        action: 'query_transactions',
        relativeAmount: 1,
        relativeUnit: 'hour',
      }).relativeUnit,
    ).toBe('hour')
    expect(
      QueryTransactionsIntentSchema.parse({
        action: 'query_transactions',
        relativeAmount: 24,
        relativeUnit: 'hour',
      }).relativeAmount,
    ).toBe(24)
  })

  it('rejects a non-positive relativeAmount', () => {
    const r = QueryTransactionsIntentSchema.safeParse({
      action: 'query_transactions',
      relativeAmount: 0,
      relativeUnit: 'day',
    })
    expect(r.success).toBe(false)
  })

  it('rejects an unsupported relativeUnit', () => {
    const r = QueryTransactionsIntentSchema.safeParse({
      action: 'query_transactions',
      relativeAmount: 2,
      relativeUnit: 'fortnight',
    })
    expect(r.success).toBe(false)
  })

  it('keeps the relative spec a member of the Intent discriminated union', () => {
    const r = IntentSchema.safeParse({
      action: 'query_transactions',
      relativeAmount: 6,
      relativeUnit: 'month',
    })
    expect(r.success).toBe(true)
  })
})
