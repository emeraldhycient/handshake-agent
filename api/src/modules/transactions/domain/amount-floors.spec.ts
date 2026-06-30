/**
 * Tests for the config-driven amount-floor resolver (findings #3/#4).
 *
 * The resolver returns the admin-tunable minimum for each operation, falling
 * back to a documented default when the config key is absent. Minimums are
 * decimal strings (BigInt-safe), never floats.
 *
 * TDD: written before the resolver exists (red → green).
 */

import {
  DEFAULT_MIN_BUY_FIAT,
  DEFAULT_MIN_CRYPTO,
  resolveMinBuyFiat,
  resolveMinCryptoAmount,
} from './amount-floors';

describe('resolveMinBuyFiat', () => {
  it('falls back to the documented default when pricing config is absent', () => {
    expect(resolveMinBuyFiat(undefined, 'NGN')).toBe(DEFAULT_MIN_BUY_FIAT);
  });

  it('falls back to the default when no per-fiat minimum is configured', () => {
    expect(resolveMinBuyFiat({ minBuyFiat: {} }, 'NGN')).toBe(
      DEFAULT_MIN_BUY_FIAT,
    );
  });

  it('returns the configured per-fiat minimum as a decimal string', () => {
    expect(resolveMinBuyFiat({ minBuyFiat: { NGN: 500 } }, 'NGN')).toBe('500');
  });

  it('is keyed by fiat — an unconfigured currency falls back to the default', () => {
    expect(resolveMinBuyFiat({ minBuyFiat: { NGN: 500 } }, 'GHS')).toBe(
      DEFAULT_MIN_BUY_FIAT,
    );
  });
});

describe('resolveMinCryptoAmount', () => {
  it('falls back to the documented default when pricing config is absent', () => {
    expect(resolveMinCryptoAmount(undefined, 'send', 'USDT')).toBe(
      DEFAULT_MIN_CRYPTO,
    );
  });

  it('returns the per-operation, per-asset configured minimum', () => {
    const cfg = { minCryptoAmount: { send: { USDT: 0.5 } } };
    expect(resolveMinCryptoAmount(cfg, 'send', 'USDT')).toBe('0.5');
  });

  it('falls back to the default for an unconfigured operation/asset pair', () => {
    const cfg = { minCryptoAmount: { send: { USDT: 0.5 } } };
    expect(resolveMinCryptoAmount(cfg, 'sell', 'USDT')).toBe(
      DEFAULT_MIN_CRYPTO,
    );
    expect(resolveMinCryptoAmount(cfg, 'send', 'TRX')).toBe(DEFAULT_MIN_CRYPTO);
  });
});
