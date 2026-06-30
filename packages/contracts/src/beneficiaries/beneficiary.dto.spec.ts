import { describe, expect, it } from 'vitest'
import {
  BeneficiaryTypeSchema,
  ListBeneficiariesQuerySchema,
  BeneficiarySchema,
  BeneficiaryListResponseSchema,
  AddBankAccountRequestSchema,
  AddCryptoAddressRequestSchema,
  DeleteBeneficiaryResponseSchema,
} from './beneficiary.dto'

// ─── BeneficiaryTypeSchema ──────────────────────────────────────────────────

describe('BeneficiaryTypeSchema', () => {
  it('accepts bank_account and crypto_address', () => {
    expect(BeneficiaryTypeSchema.parse('bank_account')).toBe('bank_account')
    expect(BeneficiaryTypeSchema.parse('crypto_address')).toBe('crypto_address')
  })

  it('rejects an unknown type', () => {
    expect(() => BeneficiaryTypeSchema.parse('paypal')).toThrow()
  })
})

// ─── ListBeneficiariesQuerySchema ───────────────────────────────────────────

describe('ListBeneficiariesQuerySchema', () => {
  it('requires a valid type', () => {
    expect(ListBeneficiariesQuerySchema.parse({ type: 'bank_account' })).toEqual(
      { type: 'bank_account' },
    )
  })

  it('rejects a missing or invalid type', () => {
    expect(() => ListBeneficiariesQuerySchema.parse({})).toThrow()
    expect(() => ListBeneficiariesQuerySchema.parse({ type: 'x' })).toThrow()
  })
})

// ─── BeneficiarySchema (response item) ──────────────────────────────────────

const validBankBeneficiary = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  type: 'bank_account',
  label: 'My GTB',
  accountNumber: '0123456789',
  accountHolderName: 'ADA LOVELACE',
  bankCode: '058',
  cryptoAddress: null,
  cryptoAsset: null,
  cryptoNetwork: null,
  verificationStatus: 'verified',
  isDefault: true,
  firstUseLockedUntil: null,
  createdAt: '2026-06-29T12:00:00.000Z',
}

const validCryptoBeneficiary = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  type: 'crypto_address',
  label: 'Cold wallet',
  accountNumber: null,
  accountHolderName: null,
  bankCode: null,
  cryptoAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
  cryptoAsset: 'USDT',
  cryptoNetwork: 'TRON',
  verificationStatus: 'verified',
  isDefault: false,
  firstUseLockedUntil: '2026-06-30T12:00:00.000Z',
  createdAt: '2026-06-29T12:00:00.000Z',
}

describe('BeneficiarySchema', () => {
  it('accepts a valid bank-account beneficiary', () => {
    expect(BeneficiarySchema.parse(validBankBeneficiary)).toEqual(
      validBankBeneficiary,
    )
  })

  it('accepts a valid crypto-address beneficiary with cooling-off', () => {
    expect(BeneficiarySchema.parse(validCryptoBeneficiary)).toEqual(
      validCryptoBeneficiary,
    )
  })

  it('rejects a non-uuid id', () => {
    expect(() =>
      BeneficiarySchema.parse({ ...validBankBeneficiary, id: 'not-a-uuid' }),
    ).toThrow()
  })

  it('rejects a non-ISO createdAt', () => {
    expect(() =>
      BeneficiarySchema.parse({ ...validBankBeneficiary, createdAt: 'nope' }),
    ).toThrow()
  })
})

// ─── BeneficiaryListResponseSchema ──────────────────────────────────────────

describe('BeneficiaryListResponseSchema', () => {
  it('accepts a list of beneficiaries', () => {
    const parsed = BeneficiaryListResponseSchema.parse({
      beneficiaries: [validBankBeneficiary, validCryptoBeneficiary],
    })
    expect(parsed.beneficiaries).toHaveLength(2)
  })

  it('accepts an empty list', () => {
    expect(
      BeneficiaryListResponseSchema.parse({ beneficiaries: [] }).beneficiaries,
    ).toEqual([])
  })
})

// ─── AddBankAccountRequestSchema ────────────────────────────────────────────

describe('AddBankAccountRequestSchema', () => {
  it('accepts a 10-digit NUBAN with bank code and label', () => {
    const parsed = AddBankAccountRequestSchema.parse({
      accountNumber: '0123456789',
      bankCode: '058',
      label: 'My GTB',
    })
    expect(parsed.accountNumber).toBe('0123456789')
  })

  it('rejects a non-10-digit account number', () => {
    expect(() =>
      AddBankAccountRequestSchema.parse({
        accountNumber: '12345',
        bankCode: '058',
        label: 'My GTB',
      }),
    ).toThrow()
  })

  it('rejects an empty label', () => {
    expect(() =>
      AddBankAccountRequestSchema.parse({
        accountNumber: '0123456789',
        bankCode: '058',
        label: '',
      }),
    ).toThrow()
  })

  it('rejects an empty bank code', () => {
    expect(() =>
      AddBankAccountRequestSchema.parse({
        accountNumber: '0123456789',
        bankCode: '',
        label: 'My GTB',
      }),
    ).toThrow()
  })
})

// ─── AddCryptoAddressRequestSchema ──────────────────────────────────────────

describe('AddCryptoAddressRequestSchema', () => {
  it('accepts a valid TRON USDT address payload', () => {
    const parsed = AddCryptoAddressRequestSchema.parse({
      address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
      network: 'TRON',
      asset: 'USDT',
      label: 'Cold wallet',
    })
    expect(parsed.network).toBe('TRON')
    expect(parsed.asset).toBe('USDT')
  })

  it('rejects an unsupported network', () => {
    expect(() =>
      AddCryptoAddressRequestSchema.parse({
        address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
        network: 'SOLANA',
        asset: 'USDT',
        label: 'Cold wallet',
      }),
    ).toThrow()
  })

  it('rejects an empty address', () => {
    expect(() =>
      AddCryptoAddressRequestSchema.parse({
        address: '',
        network: 'TRON',
        asset: 'USDT',
        label: 'Cold wallet',
      }),
    ).toThrow()
  })
})

// ─── DeleteBeneficiaryResponseSchema ────────────────────────────────────────

describe('DeleteBeneficiaryResponseSchema', () => {
  it('accepts a soft-delete acknowledgement with the removed id', () => {
    const parsed = DeleteBeneficiaryResponseSchema.parse({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      deleted: true,
    })
    expect(parsed).toEqual({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      deleted: true,
    })
  })

  it('rejects a non-uuid id', () => {
    expect(() =>
      DeleteBeneficiaryResponseSchema.parse({ id: 'nope', deleted: true }),
    ).toThrow()
  })

  it('rejects deleted: false (the endpoint only ever acks a deletion)', () => {
    expect(() =>
      DeleteBeneficiaryResponseSchema.parse({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        deleted: false,
      }),
    ).toThrow()
  })
})
