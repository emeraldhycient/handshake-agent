import { describe, expect, it } from 'vitest'

import {
  NIGERIAN_BANKS,
  bankNameForCode,
  BankSchema,
  BankListResponseSchema,
  BankListQuerySchema,
} from './banks'
import { AddBankAccountRequestSchema } from './beneficiary.dto'

describe('NIGERIAN_BANKS', () => {
  it('is a non-empty list', () => {
    expect(NIGERIAN_BANKS.length).toBeGreaterThan(0)
  })

  it('every bank has a non-empty name and code', () => {
    for (const b of NIGERIAN_BANKS) {
      expect(b.name.length).toBeGreaterThan(0)
      expect(b.code.length).toBeGreaterThan(0)
    }
  })

  it('every code is a valid AddBankAccountRequest bankCode — so every dropdown option is submittable', () => {
    for (const b of NIGERIAN_BANKS) {
      const result = AddBankAccountRequestSchema.safeParse({
        accountNumber: '0123456789',
        bankCode: b.code,
        label: 'Test',
        currency: 'NGN',
        pin: '5731',
      })
      expect(
        result.success,
        `${b.name} (${b.code}) must pass the bankCode rule (3–10 chars)`
      ).toBe(true)
    }
  })

  it('has no duplicate codes', () => {
    const codes = NIGERIAN_BANKS.map((b) => b.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('has no duplicate names', () => {
    const names = NIGERIAN_BANKS.map((b) => b.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('is sorted alphabetically by name', () => {
    const names = NIGERIAN_BANKS.map((b) => b.name)
    const sorted = [...names].sort((a, b) => a.localeCompare(b))
    expect(names).toEqual(sorted)
  })
})

describe('bankNameForCode', () => {
  it('returns the bank name for a known code', () => {
    expect(bankNameForCode('058')).toBe('Guaranty Trust Bank (GTBank)')
    expect(bankNameForCode('044')).toBe('Access Bank')
  })

  it('returns undefined for an unknown code', () => {
    expect(bankNameForCode('000000')).toBeUndefined()
  })
})

describe('BankSchema / BankListResponseSchema', () => {
  it('accepts a { name, code } bank', () => {
    expect(BankSchema.parse({ name: 'GTBank', code: '058' })).toEqual({
      name: 'GTBank',
      code: '058',
    })
  })

  it('rejects a bank missing a code', () => {
    expect(() => BankSchema.parse({ name: 'GTBank' })).toThrow()
  })

  it('accepts a bank-list response and an empty list', () => {
    expect(
      BankListResponseSchema.parse({ banks: [{ name: 'GTBank', code: '058' }] })
        .banks,
    ).toHaveLength(1)
    expect(BankListResponseSchema.parse({ banks: [] }).banks).toEqual([])
  })

  it('every NIGERIAN_BANKS entry satisfies BankSchema', () => {
    for (const b of NIGERIAN_BANKS) {
      expect(BankSchema.safeParse(b).success).toBe(true)
    }
  })
})

describe('BankListQuerySchema', () => {
  it('accepts a 2-letter country code and trims it', () => {
    expect(BankListQuerySchema.parse({ country: ' NG ' })).toEqual({
      country: 'NG',
    })
  })

  it('rejects a country that is not exactly 2 characters', () => {
    expect(() => BankListQuerySchema.parse({ country: 'NGA' })).toThrow()
    expect(() => BankListQuerySchema.parse({ country: 'N' })).toThrow()
  })
})
