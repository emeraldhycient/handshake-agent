/**
 * Unit tests for resolveBaseRate — the single fail-closed money-gate guard that
 * resolves a per-fiat baseRate and rejects a missing / zero / negative rate.
 *
 * Shared by ProposalService.createSendProposal and ExecutionService.executeSend
 * so the KYC / velocity / Travel-Rule gate can never be bypassed by a 0-valued
 * fiat-equivalent on misconfiguration (root CLAUDE.md §3.1 / §3.3).
 */

import type { PricingConfig } from '../../../core/config/configuration';
import { BaseRateMisconfiguredError } from '../domain/execution-errors';
import { resolveBaseRate } from './resolve-base-rate';

function pricing(baseRates: Record<string, number>): PricingConfig {
  return {
    processingFeeBps: 50,
    expiresInSec: 60,
    assets: {
      USDT: {
        baseRates,
        buySpreadBps: 100,
        sellSpreadBps: 100,
        cryptoDecimals: 6,
      },
    },
  };
}

describe('resolveBaseRate', () => {
  it('returns a strictly-positive baseRate', () => {
    expect(resolveBaseRate(pricing({ NGN: 1600 }), 'USDT', 'NGN')).toBe(1600);
  });

  it('returns a fractional baseRate unchanged (no rounding)', () => {
    expect(resolveBaseRate(pricing({ NGN: 1600.45 }), 'USDT', 'NGN')).toBe(
      1600.45,
    );
  });

  it('throws BaseRateMisconfiguredError on a 0 rate (money-gate bypass guard)', () => {
    expect(() => resolveBaseRate(pricing({ NGN: 0 }), 'USDT', 'NGN')).toThrow(
      BaseRateMisconfiguredError,
    );
  });

  it('throws BaseRateMisconfiguredError on a negative rate', () => {
    expect(() =>
      resolveBaseRate(pricing({ NGN: -1600 }), 'USDT', 'NGN'),
    ).toThrow(BaseRateMisconfiguredError);
  });

  it('throws when the fiat key is absent for the asset', () => {
    expect(() => resolveBaseRate(pricing({ USD: 1 }), 'USDT', 'NGN')).toThrow(
      BaseRateMisconfiguredError,
    );
  });

  it('throws when the asset has no pricing entry', () => {
    const cfg: PricingConfig = {
      processingFeeBps: 50,
      expiresInSec: 60,
      assets: {},
    };
    expect(() => resolveBaseRate(cfg, 'USDT', 'NGN')).toThrow(
      BaseRateMisconfiguredError,
    );
  });

  it('throws when the pricing config is undefined', () => {
    expect(() => resolveBaseRate(undefined, 'USDT', 'NGN')).toThrow(
      BaseRateMisconfiguredError,
    );
  });

  it('throws BaseRateMisconfiguredError on a NaN rate', () => {
    // NaN is falsy, so the `!baseRate` clause catches it — a corrupt rate must
    // never reach the money gate.
    expect(() => resolveBaseRate(pricing({ NGN: NaN }), 'USDT', 'NGN')).toThrow(
      BaseRateMisconfiguredError,
    );
  });

  it('looks up by the requested asset (param-driven, not a hardcoded key)', () => {
    const cfg: PricingConfig = {
      processingFeeBps: 50,
      expiresInSec: 60,
      assets: {
        USDT: {
          baseRates: { NGN: 1600 },
          buySpreadBps: 100,
          sellSpreadBps: 100,
          cryptoDecimals: 6,
        },
        BTC: {
          baseRates: { NGN: 100_000_000 },
          buySpreadBps: 100,
          sellSpreadBps: 100,
          cryptoDecimals: 8,
        },
      },
    };
    expect(resolveBaseRate(cfg, 'BTC', 'NGN')).toBe(100_000_000);
  });

  it('error message names the asset, the fiat, and the baseRates path', () => {
    try {
      resolveBaseRate(pricing({ NGN: 0 }), 'USDT', 'NGN');
      throw new Error('expected resolveBaseRate to throw, but it returned');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseRateMisconfiguredError);
      const message = (err as Error).message;
      expect(message).toContain('baseRates.NGN');
      expect(message).toContain('USDT');
    }
  });
});
