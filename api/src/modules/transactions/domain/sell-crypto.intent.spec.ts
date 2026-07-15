/**
 * Unit tests for SellCryptoIntentSchema and IntentSchema narrowing (task S4a).
 *
 * These tests exercise the @handshake-agent/contracts package from the api
 * Jest suite (which has the moduleNameMapper wired for the source-only package).
 * The contracts package itself does not yet have a standalone test runner.
 */

import {
  SellCryptoIntentSchema,
  IntentSchema,
} from '@handshake-agent/contracts';

describe('SellCryptoIntentSchema', () => {
  it('parses a valid sell_crypto intent', () => {
    const result = SellCryptoIntentSchema.parse({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '5.0',
      fiatCurrency: 'NGN',
    });
    expect(result.action).toBe('sell_crypto');
    expect(result.asset).toBe('USDT');
    expect(result.cryptoAmount).toBe('5.0');
    expect(result.fiatCurrency).toBe('NGN');
  });

  it('accepts a sell_crypto intent with no fiat (calling layer defaults it)', () => {
    const result = SellCryptoIntentSchema.parse({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '1.5',
    });
    expect(result.fiatCurrency).toBeUndefined();
  });

  it('rejects an unknown asset', () => {
    expect(() =>
      SellCryptoIntentSchema.parse({
        action: 'sell_crypto',
        asset: 'ETH',
        cryptoAmount: '1.0',
        fiatCurrency: 'NGN',
      }),
    ).toThrow();
  });

  it('rejects a cryptoAmount with more than 8 decimal places', () => {
    expect(() =>
      SellCryptoIntentSchema.parse({
        action: 'sell_crypto',
        asset: 'USDT',
        cryptoAmount: '1.123456789', // 9 d.p. — violates CryptoAmountSchema
        fiatCurrency: 'NGN',
      }),
    ).toThrow();
  });

  it('rejects missing cryptoAmount', () => {
    expect(() =>
      SellCryptoIntentSchema.parse({
        action: 'sell_crypto',
        asset: 'USDT',
        fiatCurrency: 'NGN',
      }),
    ).toThrow();
  });

  it('rejects wrong action literal', () => {
    expect(() =>
      SellCryptoIntentSchema.parse({
        action: 'buy_crypto',
        asset: 'USDT',
        cryptoAmount: '1.0',
        fiatCurrency: 'NGN',
      }),
    ).toThrow();
  });
});

describe('IntentSchema — sell_crypto discriminated union narrowing', () => {
  it('parses a sell_crypto intent through the root union', () => {
    const result = IntentSchema.parse({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '3.0',
      fiatCurrency: 'NGN',
    });
    expect(result.action).toBe('sell_crypto');
  });

  it('narrows to SellCryptoIntent on action === sell_crypto', () => {
    const intent = IntentSchema.parse({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '3.0',
      fiatCurrency: 'NGN',
    });
    if (intent.action === 'sell_crypto') {
      // TypeScript narrows here — accessing cryptoAmount is type-safe.
      expect(intent.cryptoAmount).toBe('3.0');
    } else {
      throw new Error('Expected sell_crypto action');
    }
  });
});
