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
import {
  liveStoreWhenEnabled,
  resolveBaseRate,
  resolveEffectiveBaseRate,
  type LiveRateReader,
} from './resolve-base-rate';

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

/**
 * resolveEffectiveBaseRate — the seam that layers the live feed over the config
 * fallback. Parity: an absent / empty / stale store must reproduce
 * resolveBaseRate exactly (config fallback), so quote and execution agree.
 */
describe('resolveEffectiveBaseRate', () => {
  const NOW = new Date('2026-07-09T00:00:00.000Z');
  const STALENESS = 900;

  const reader = (rate: number | null): LiveRateReader => ({
    getFresh: () => rate,
  });

  it('falls back to the config baseRate when the store is null (parity)', () => {
    expect(
      resolveEffectiveBaseRate(
        pricing({ NGN: 1600 }),
        null,
        'USDT',
        'NGN',
        NOW,
        STALENESS,
      ),
    ).toBe(1600);
  });

  it('falls back to the config baseRate when the store returns null (stale/degraded)', () => {
    expect(
      resolveEffectiveBaseRate(
        pricing({ NGN: 1600 }),
        reader(null),
        'USDT',
        'NGN',
        NOW,
        STALENESS,
      ),
    ).toBe(1600);
  });

  it('uses the fresh live rate over the config fallback', () => {
    expect(
      resolveEffectiveBaseRate(
        pricing({ NGN: 1600 }),
        reader(1712),
        'USDT',
        'NGN',
        NOW,
        STALENESS,
      ),
    ).toBe(1712);
  });

  it('ignores a non-positive live rate and falls back to config (never zero the gate)', () => {
    expect(
      resolveEffectiveBaseRate(
        pricing({ NGN: 1600 }),
        reader(0),
        'USDT',
        'NGN',
        NOW,
        STALENESS,
      ),
    ).toBe(1600);
  });

  it('still fails closed when neither a live rate nor a config baseRate exists', () => {
    expect(() =>
      resolveEffectiveBaseRate(
        pricing({ USD: 1 }),
        reader(null),
        'USDT',
        'NGN',
        NOW,
        STALENESS,
      ),
    ).toThrow(BaseRateMisconfiguredError);
  });

  it('passes the pair + staleness window through to the reader', () => {
    const getFresh = jest.fn().mockReturnValue(1650);
    resolveEffectiveBaseRate(
      pricing({ NGN: 1600 }),
      { getFresh },
      'USDT',
      'NGN',
      NOW,
      STALENESS,
    );
    expect(getFresh).toHaveBeenCalledWith('USDT', 'NGN', NOW, STALENESS);
  });
});

/**
 * liveStoreWhenEnabled — the admin kill-switch honoured on the READ side. When
 * `pricing.feed.enabled` is false the money path must revert to the config floor
 * IMMEDIATELY (config is hot-reloaded), not stalenessSec later once the last
 * live entries the poller wrote age out. This is the seam that makes the
 * documented contract ("Off → the money path uses the config baseRates") true.
 */
describe('liveStoreWhenEnabled', () => {
  const NOW = new Date('2026-07-09T00:00:00.000Z');
  const STALENESS = 900;
  const reader: LiveRateReader = { getFresh: () => 1712 };

  it('passes the store through when the feed is enabled', () => {
    expect(liveStoreWhenEnabled(reader, { enabled: true })).toBe(reader);
  });

  it('passes the store through when the feed block is absent (parity)', () => {
    expect(liveStoreWhenEnabled(reader, undefined)).toBe(reader);
  });

  it('returns null the moment the kill-switch flips to enabled=false', () => {
    expect(liveStoreWhenEnabled(reader, { enabled: false })).toBeNull();
  });

  it('returns null when there is no store to gate', () => {
    expect(liveStoreWhenEnabled(undefined, { enabled: true })).toBeNull();
    expect(liveStoreWhenEnabled(null, { enabled: false })).toBeNull();
  });

  it('makes the base-rate seam serve config when the feed is disabled, even with a fresh live rate', () => {
    // A fresh, in-band live rate is cached (1712), but the operator disabled the
    // feed — the resolved base rate must be the config floor (1600), not 1712.
    const gated = liveStoreWhenEnabled(reader, { enabled: false });
    expect(
      resolveEffectiveBaseRate(
        pricing({ NGN: 1600 }),
        gated,
        'USDT',
        'NGN',
        NOW,
        STALENESS,
      ),
    ).toBe(1600);
  });

  it('serves the live rate through the seam when the feed is enabled', () => {
    const gated = liveStoreWhenEnabled(reader, { enabled: true });
    expect(
      resolveEffectiveBaseRate(
        pricing({ NGN: 1600 }),
        gated,
        'USDT',
        'NGN',
        NOW,
        STALENESS,
      ),
    ).toBe(1712);
  });
});
