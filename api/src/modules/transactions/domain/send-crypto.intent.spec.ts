/**
 * Unit tests for SendCryptoIntentSchema and IntentSchema narrowing (task N3a).
 *
 * These tests exercise the @handshake-agent/contracts package from the api
 * Jest suite (which has the moduleNameMapper wired for the source-only package).
 *
 * Security note (CLAUDE.md §3.1): the intent carries NO destination address —
 * the address is resolved server-side from the saved beneficiary record. The
 * `beneficiaryId` is supplied by the calling tool layer, not by the NLU model.
 */

import {
  SendCryptoIntentSchema,
  IntentSchema,
} from '@handshake-agent/contracts';

describe('SendCryptoIntentSchema', () => {
  it('parses a valid send_crypto intent', () => {
    const result = SendCryptoIntentSchema.parse({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '10.5',
      network: 'TRON',
    });
    expect(result.action).toBe('send_crypto');
    expect(result.asset).toBe('USDT');
    expect(result.cryptoAmount).toBe('10.5');
    expect(result.network).toBe('TRON');
  });

  it('defaults network to TRON when omitted', () => {
    const result = SendCryptoIntentSchema.parse({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '5.0',
    });
    expect(result.network).toBe('TRON');
  });

  it('rejects an unknown asset', () => {
    expect(() =>
      SendCryptoIntentSchema.parse({
        action: 'send_crypto',
        asset: 'ETH',
        cryptoAmount: '1.0',
        network: 'TRON',
      }),
    ).toThrow();
  });

  it('rejects a cryptoAmount with more than 8 decimal places', () => {
    expect(() =>
      SendCryptoIntentSchema.parse({
        action: 'send_crypto',
        asset: 'USDT',
        cryptoAmount: '1.123456789', // 9 d.p. — violates CryptoAmountSchema
        network: 'TRON',
      }),
    ).toThrow();
  });

  it('rejects missing cryptoAmount', () => {
    expect(() =>
      SendCryptoIntentSchema.parse({
        action: 'send_crypto',
        asset: 'USDT',
        network: 'TRON',
      }),
    ).toThrow();
  });

  it('rejects wrong action literal', () => {
    expect(() =>
      SendCryptoIntentSchema.parse({
        action: 'buy_crypto',
        asset: 'USDT',
        cryptoAmount: '1.0',
        network: 'TRON',
      }),
    ).toThrow();
  });

  it('does NOT allow a destination address field (§3.1 — address is never an NLU parameter)', () => {
    // Zod's .object() strips unknown keys by default when using .parse().
    // The schema must NOT have a `toAddress` / `destinationAddress` field.
    const schema = SendCryptoIntentSchema;
    const keys = Object.keys(schema.shape);
    expect(keys).not.toContain('toAddress');
    expect(keys).not.toContain('destinationAddress');
    expect(keys).not.toContain('address');
  });
});

describe('IntentSchema — send_crypto discriminated union narrowing', () => {
  it('parses a send_crypto intent through the root union', () => {
    const result = IntentSchema.parse({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '3.0',
      network: 'TRON',
    });
    expect(result.action).toBe('send_crypto');
  });

  it('narrows to SendCryptoIntent on action === send_crypto', () => {
    const intent = IntentSchema.parse({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '3.0',
      network: 'TRON',
    });
    if (intent.action === 'send_crypto') {
      // TypeScript narrows here — accessing cryptoAmount is type-safe.
      expect(intent.cryptoAmount).toBe('3.0');
      expect(intent.network).toBe('TRON');
    } else {
      throw new Error('Expected send_crypto action');
    }
  });
});
