import { describe, expect, it } from 'vitest'
import { FiatCurrencySchema, SupportedAssetSchema } from './common'

describe('FiatCurrencySchema', () => {
  it('accepts NGN (the only live currency at launch)', () => {
    expect(FiatCurrencySchema.parse('NGN')).toBe('NGN')
  })

  it('accepts GHS (supported but not yet live)', () => {
    expect(FiatCurrencySchema.parse('GHS')).toBe('GHS')
  })

  it('accepts KES', () => {
    expect(FiatCurrencySchema.parse('KES')).toBe('KES')
  })

  it('accepts UGX', () => {
    expect(FiatCurrencySchema.parse('UGX')).toBe('UGX')
  })

  it('accepts TZS', () => {
    expect(FiatCurrencySchema.parse('TZS')).toBe('TZS')
  })

  it('accepts RWF', () => {
    expect(FiatCurrencySchema.parse('RWF')).toBe('RWF')
  })

  it('accepts ZAR', () => {
    expect(FiatCurrencySchema.parse('ZAR')).toBe('ZAR')
  })

  it('accepts USD', () => {
    expect(FiatCurrencySchema.parse('USD')).toBe('USD')
  })

  it('rejects junk values', () => {
    expect(() => FiatCurrencySchema.parse('XYZ')).toThrow()
  })

  it('rejects an empty string', () => {
    expect(() => FiatCurrencySchema.parse('')).toThrow()
  })

  it('rejects a numeric value', () => {
    expect(() => FiatCurrencySchema.parse(42)).toThrow()
  })
})

describe('SupportedAssetSchema', () => {
  it('accepts USDT', () => {
    expect(SupportedAssetSchema.parse('USDT')).toBe('USDT')
  })

  it('accepts BTC', () => {
    expect(SupportedAssetSchema.parse('BTC')).toBe('BTC')
  })

  it('accepts TRX (TRON native — primary swap target)', () => {
    expect(SupportedAssetSchema.parse('TRX')).toBe('TRX')
  })

  it('rejects ETH', () => {
    expect(() => SupportedAssetSchema.parse('ETH')).toThrow()
  })
})
