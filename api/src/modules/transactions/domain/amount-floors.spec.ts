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
  resolveFiatMax,
  resolveFiatMin,
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

describe('resolveFiatMin (per capability × currency, enforce-when-present)', () => {
  const bounds = { minFiat: { buy: { NGN: 100 }, sell: { NGN: 200 } } };

  it('returns null when the asset pricing is absent (no per-row bound configured)', () => {
    expect(resolveFiatMin(undefined, 'buy', 'NGN')).toBeNull();
  });

  it('returns the configured minimum for the (capability, currency) as a decimal string', () => {
    expect(resolveFiatMin(bounds, 'buy', 'NGN')).toBe('100');
    expect(resolveFiatMin(bounds, 'sell', 'NGN')).toBe('200');
  });

  it('is keyed by BOTH capability and currency — a mismatch is null (unbounded)', () => {
    expect(resolveFiatMin(bounds, 'buy', 'GHS')).toBeNull();
    expect(resolveFiatMin({ minFiat: { buy: { NGN: 100 } } }, 'sell', 'NGN')).toBeNull();
  });
});

describe('resolveFiatMax (per capability × currency, enforce-when-present)', () => {
  const bounds = { maxFiat: { buy: { NGN: 5_000_000 }, sell: { NGN: 4_000_000 } } };

  it('returns null when unset (no cap = unbounded)', () => {
    expect(resolveFiatMax(undefined, 'buy', 'NGN')).toBeNull();
    expect(resolveFiatMax({ maxFiat: { buy: {} } }, 'buy', 'NGN')).toBeNull();
  });

  it('returns the configured maximum for the (capability, currency)', () => {
    expect(resolveFiatMax(bounds, 'buy', 'NGN')).toBe('5000000');
    expect(resolveFiatMax(bounds, 'sell', 'NGN')).toBe('4000000');
  });
});
