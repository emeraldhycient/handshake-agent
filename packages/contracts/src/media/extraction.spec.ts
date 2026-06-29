import { describe, expect, it } from 'vitest'
import { DocumentExtractionResultSchema } from './extraction'

describe('DocumentExtractionResultSchema', () => {
  it('accepts a crypto_address result', () => {
    const r = DocumentExtractionResultSchema.parse({
      kind: 'crypto_address',
      address: 'TXYZ1234567890abcdefghijklmnopqrst',
      network: 'tron',
    })
    expect(r.kind).toBe('crypto_address')
  })

  it('accepts a bank_account result with only an account number', () => {
    const r = DocumentExtractionResultSchema.parse({
      kind: 'bank_account',
      accountNumber: '0123456789',
    })
    expect(r).toMatchObject({
      kind: 'bank_account',
      accountNumber: '0123456789',
    })
  })

  it('accepts a none result', () => {
    expect(DocumentExtractionResultSchema.parse({ kind: 'none' }).kind).toBe('none')
  })

  it('rejects an unknown kind', () => {
    expect(() => DocumentExtractionResultSchema.parse({ kind: 'passport' })).toThrow()
  })

  it('rejects crypto_address without an address', () => {
    expect(() => DocumentExtractionResultSchema.parse({ kind: 'crypto_address' })).toThrow()
  })
})
