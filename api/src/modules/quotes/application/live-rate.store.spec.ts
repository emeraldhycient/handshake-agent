/**
 * Unit tests for LiveRateStore — the in-memory, per-process cache of live
 * market rates that the base-rate resolution seam (resolveEffectiveBaseRate)
 * reads. Pure state: no framework, no I/O. The freshness gate here is the ONLY
 * thing that decides whether a live rate is trusted over the admin config
 * fallback on the money path (§3.1), so it is tested exhaustively.
 */

import { LiveRateStore } from './live-rate.store';

const T0 = new Date('2026-07-09T00:00:00.000Z');
const at = (msFromT0: number): Date => new Date(T0.getTime() + msFromT0);

describe('LiveRateStore', () => {
  describe('getFresh', () => {
    it('returns null for an unknown pair (cold store → config fallback)', () => {
      const store = new LiveRateStore();
      expect(store.getFresh('USDT', 'NGN', T0, 900)).toBeNull();
    });

    it('returns a fresh, non-degraded, positive rate', () => {
      const store = new LiveRateStore();
      store.setRates([
        {
          asset: 'USDT',
          fiat: 'NGN',
          rate: 1650,
          fetchedAt: T0,
          source: 'quidax',
          degraded: false,
        },
      ]);
      expect(store.getFresh('USDT', 'NGN', at(1000), 900)).toBe(1650);
    });

    it('returns null once the rate is older than stalenessSec (stale → fallback)', () => {
      const store = new LiveRateStore();
      store.setRates([
        {
          asset: 'USDT',
          fiat: 'NGN',
          rate: 1650,
          fetchedAt: T0,
          source: 'quidax',
          degraded: false,
        },
      ]);
      // 900s = 900_000ms; 901s later is stale.
      expect(store.getFresh('USDT', 'NGN', at(900_001), 900)).toBeNull();
      // exactly at the boundary is still fresh.
      expect(store.getFresh('USDT', 'NGN', at(900_000), 900)).toBe(1650);
    });

    it('returns null for a degraded entry even when fresh (fail-closed to fallback)', () => {
      const store = new LiveRateStore();
      store.setRates([
        {
          asset: 'USDT',
          fiat: 'NGN',
          rate: 1650,
          fetchedAt: T0,
          source: 'quidax',
          degraded: true,
        },
      ]);
      expect(store.getFresh('USDT', 'NGN', at(1000), 900)).toBeNull();
    });

    it('returns null for a zero / negative / NaN rate (never zero the money gate)', () => {
      const store = new LiveRateStore();
      store.setRates([
        {
          asset: 'A',
          fiat: 'NGN',
          rate: 0,
          fetchedAt: T0,
          source: 's',
          degraded: false,
        },
        {
          asset: 'B',
          fiat: 'NGN',
          rate: -5,
          fetchedAt: T0,
          source: 's',
          degraded: false,
        },
        {
          asset: 'C',
          fiat: 'NGN',
          rate: NaN,
          fetchedAt: T0,
          source: 's',
          degraded: false,
        },
      ]);
      expect(store.getFresh('A', 'NGN', at(1000), 900)).toBeNull();
      expect(store.getFresh('B', 'NGN', at(1000), 900)).toBeNull();
      expect(store.getFresh('C', 'NGN', at(1000), 900)).toBeNull();
    });

    it('bulk set overwrites a prior entry for the same pair', () => {
      const store = new LiveRateStore();
      store.setRates([
        {
          asset: 'USDT',
          fiat: 'NGN',
          rate: 1600,
          fetchedAt: T0,
          source: 's',
          degraded: false,
        },
      ]);
      store.setRates([
        {
          asset: 'USDT',
          fiat: 'NGN',
          rate: 1700,
          fetchedAt: at(1000),
          source: 's',
          degraded: false,
        },
      ]);
      expect(store.getFresh('USDT', 'NGN', at(2000), 900)).toBe(1700);
    });

    it('keys are (asset, fiat) — same asset in a different fiat is independent', () => {
      const store = new LiveRateStore();
      store.setRates([
        {
          asset: 'USDT',
          fiat: 'NGN',
          rate: 1600,
          fetchedAt: T0,
          source: 's',
          degraded: false,
        },
        {
          asset: 'USDT',
          fiat: 'USD',
          rate: 1,
          fetchedAt: T0,
          source: 's',
          degraded: false,
        },
      ]);
      expect(store.getFresh('USDT', 'NGN', at(1000), 900)).toBe(1600);
      expect(store.getFresh('USDT', 'USD', at(1000), 900)).toBe(1);
    });
  });

  describe('healthSnapshot', () => {
    it('reports down when the store has never been populated', () => {
      const store = new LiveRateStore();
      const h = store.healthSnapshot(T0, 900);
      expect(h.status).toBe('down');
      expect(h.totalCount).toBe(0);
      expect(h.lastFetchedAt).toBeNull();
    });

    it('reports ok when all entries are fresh and no source is down', () => {
      const store = new LiveRateStore();
      store.setRates([
        {
          asset: 'USDT',
          fiat: 'NGN',
          rate: 1650,
          fetchedAt: T0,
          source: 'quidax',
          degraded: false,
        },
        {
          asset: 'TRX',
          fiat: 'NGN',
          rate: 520,
          fetchedAt: T0,
          source: 'coingecko+erapi',
          degraded: false,
        },
      ]);
      store.setSourceHealth([
        { source: 'coingecko', ok: true, checkedAt: T0 },
        { source: 'erapi', ok: true, checkedAt: T0 },
        { source: 'quidax', ok: true, checkedAt: T0 },
      ]);
      const h = store.healthSnapshot(at(1000), 900);
      expect(h.status).toBe('ok');
      expect(h.freshCount).toBe(2);
      expect(h.totalCount).toBe(2);
      expect(h.sourcesDown).toEqual([]);
      expect(h.lastFetchAgeMs).toBe(1000);
    });

    it('reports degraded when a source is down but some rates are still fresh', () => {
      const store = new LiveRateStore();
      store.setRates([
        {
          asset: 'USDT',
          fiat: 'NGN',
          rate: 1650,
          fetchedAt: T0,
          source: 'quidax',
          degraded: false,
        },
        {
          asset: 'TRX',
          fiat: 'NGN',
          rate: 520,
          fetchedAt: T0,
          source: 'coingecko+erapi',
          degraded: true,
        },
      ]);
      store.setSourceHealth([
        { source: 'coingecko', ok: false, checkedAt: T0, error: 'timeout' },
        { source: 'quidax', ok: true, checkedAt: T0 },
      ]);
      const h = store.healthSnapshot(at(1000), 900);
      expect(h.status).toBe('degraded');
      expect(h.degradedCount).toBe(1);
      expect(h.sourcesDown).toContain('coingecko');
    });

    it('reports down when every entry is stale (nothing fresh)', () => {
      const store = new LiveRateStore();
      store.setRates([
        {
          asset: 'USDT',
          fiat: 'NGN',
          rate: 1650,
          fetchedAt: T0,
          source: 'quidax',
          degraded: false,
        },
      ]);
      const h = store.healthSnapshot(at(1_000_000), 900);
      expect(h.status).toBe('down');
      expect(h.freshCount).toBe(0);
    });
  });
});
