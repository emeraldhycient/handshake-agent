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
  currency: 'NGN',
  country: 'NG',
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
  currency: null,
  country: null,
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

  it('rejects a country that is not 2 letters', () => {
    expect(() =>
      BeneficiarySchema.parse({ ...validBankBeneficiary, country: 'NGA' }),
    ).toThrow()
  })

  it('rejects a currency that is not a 3-letter code', () => {
    expect(() =>
      BeneficiarySchema.parse({ ...validBankBeneficiary, currency: 'naira' }),
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
  const validAddBank = {
    accountNumber: '0123456789',
    bankCode: '058',
    label: 'My GTB',
    currency: 'NGN',
    pin: '5731',
  }

  it('accepts a 10-digit NUBAN with bank code, label, currency and PIN', () => {
    const parsed = AddBankAccountRequestSchema.parse(validAddBank)
    expect(parsed.accountNumber).toBe('0123456789')
    expect(parsed.currency).toBe('NGN')
    expect(parsed.pin).toBe('5731')
  })

  it('accepts an optional accountHolderName and deviceFingerprint', () => {
    const parsed = AddBankAccountRequestSchema.parse({
      ...validAddBank,
      accountHolderName: 'KOFI MENSAH',
      deviceFingerprint: 'device-abc',
    })
    expect(parsed.accountHolderName).toBe('KOFI MENSAH')
    expect(parsed.deviceFingerprint).toBe('device-abc')
  })

  it('rejects a non-10-digit account number', () => {
    expect(() =>
      AddBankAccountRequestSchema.parse({ ...validAddBank, accountNumber: '12345' }),
    ).toThrow()
  })

  it('rejects an empty label', () => {
    expect(() =>
      AddBankAccountRequestSchema.parse({ ...validAddBank, label: '' }),
    ).toThrow()
  })

  it('rejects an empty bank code', () => {
    expect(() =>
      AddBankAccountRequestSchema.parse({ ...validAddBank, bankCode: '' }),
    ).toThrow()
  })

  it('rejects a missing currency', () => {
    const { currency: _omit, ...noCurrency } = validAddBank
    expect(() => AddBankAccountRequestSchema.parse(noCurrency)).toThrow()
  })

  it('rejects a missing PIN (step-up on add is mandatory, R2)', () => {
    const { pin: _omit, ...noPin } = validAddBank
    expect(() => AddBankAccountRequestSchema.parse(noPin)).toThrow()
  })

  it('rejects a weak PIN (all-same / trivial sequence)', () => {
    expect(() =>
      AddBankAccountRequestSchema.parse({ ...validAddBank, pin: '1111' }),
    ).toThrow()
    expect(() =>
      AddBankAccountRequestSchema.parse({ ...validAddBank, pin: '1234' }),
    ).toThrow()
  })
})

// ─── AddCryptoAddressRequestSchema ──────────────────────────────────────────

describe('AddCryptoAddressRequestSchema', () => {
  const validAddCrypto = {
    address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
    network: 'TRON',
    asset: 'USDT',
    label: 'Cold wallet',
    pin: '5731',
  }

  it('accepts a valid TRON USDT address payload with a PIN', () => {
    const parsed = AddCryptoAddressRequestSchema.parse(validAddCrypto)
    expect(parsed.network).toBe('TRON')
    expect(parsed.asset).toBe('USDT')
    expect(parsed.pin).toBe('5731')
  })

  it('accepts an optional deviceFingerprint', () => {
    const parsed = AddCryptoAddressRequestSchema.parse({
      ...validAddCrypto,
      deviceFingerprint: 'device-xyz',
    })
    expect(parsed.deviceFingerprint).toBe('device-xyz')
  })

  it('rejects an unsupported network', () => {
    expect(() =>
      AddCryptoAddressRequestSchema.parse({ ...validAddCrypto, network: 'SOLANA' }),
    ).toThrow()
  })

  it('rejects an empty address', () => {
    expect(() =>
      AddCryptoAddressRequestSchema.parse({ ...validAddCrypto, address: '' }),
    ).toThrow()
  })

  it('rejects a missing PIN (step-up on add is mandatory, R2)', () => {
    const { pin: _omit, ...noPin } = validAddCrypto
    expect(() => AddCryptoAddressRequestSchema.parse(noPin)).toThrow()
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
