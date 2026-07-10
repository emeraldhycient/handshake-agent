/**
 * Unit tests for LiveRateService — the scheduled market-rate poller. Sources are
 * hit through the injected HttpService (faked here) — there is NO mock-mode flag.
 * The money-path contract under test: fresh valid prints become trusted rates;
 * a divergent print or a down source is rejected (degraded → config fallback);
 * the kill-switch stops all fetching. The store's freshness gate is exercised
 * end-to-end so a stale tick also falls back.
 */

import { of, throwError, type Observable } from 'rxjs';
import type { AxiosResponse } from 'axios';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import type { SchedulerRegistry } from '@nestjs/schedule';

import type { Clock } from '../../../core/common/clock';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type {
  PricingConfig,
  PricingFeedConfig,
} from '../../../core/config/configuration';
import type { Env } from '../../../core/config/env.schema';
import { LiveRateStore } from '../application/live-rate.store';
import { LiveRateService, composeLiveRates } from './live-rate.service';

const T0 = new Date('2026-07-09T00:00:00.000Z');

const FEED: PricingFeedConfig = {
  enabled: true,
  pollIntervalSec: 300,
  stalenessSec: 900,
  divergenceBps: 1500,
  fiats: ['NGN', 'USD'],
  coingecko: { ids: { USDT: 'tether', TRX: 'tron' } },
  quidax: { market: 'usdtngn' },
  exchangerate: { base: 'USD' },
};

const PRICING: PricingConfig = {
  processingFeeBps: 100,
  expiresInSec: 300,
  assets: {
    USDT: {
      baseRates: { NGN: 1600, USD: 1 },
      buySpreadBps: 150,
      sellSpreadBps: 150,
      cryptoDecimals: 6,
    },
    TRX: {
      baseRates: { NGN: 520 },
      buySpreadBps: 150,
      sellSpreadBps: 150,
      cryptoDecimals: 6,
    },
  },
};

/** Route a faked HTTP GET by URL substring to a JSON body or an error. */
type Route = { match: string; data?: unknown; error?: boolean };

function makeHttp(routes: Route[]): {
  http: HttpService;
  get: jest.Mock;
} {
  const get = jest.fn((url: string): Observable<AxiosResponse> => {
    const route = routes.find((r) => url.includes(r.match));
    if (!route || route.error) {
      return throwError(() => new Error(`network error for ${url}`));
    }
    return of({ data: route.data } as AxiosResponse);
  });
  return { http: { get } as unknown as HttpService, get };
}

function makeConfig(): ConfigService<Env, true> {
  const env: Record<string, string> = {
    COINGECKO_BASE_URL: 'https://cg.test/api/v3',
    COINGECKO_API_KEY: '',
    EXCHANGERATE_BASE_URL: 'https://er.test/v6',
    QUIDAX_BASE_URL: 'https://q.test/api/v1',
  };
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService<Env, true>;
}

function makeEffectiveConfig(
  feed: PricingFeedConfig | undefined = FEED,
): EffectiveConfigService {
  const values: Record<string, unknown> = {
    'pricing.feed': feed,
    pricing: PRICING,
  };
  return {
    get: (key: string) => values[key],
  } as unknown as EffectiveConfigService;
}

const scheduler = {
  addInterval: jest.fn(),
  deleteInterval: jest.fn(),
  doesExist: jest.fn(() => false),
} as unknown as SchedulerRegistry;

function makeService(opts: {
  routes: Route[];
  feed?: PricingFeedConfig;
  store?: LiveRateStore;
}): { service: LiveRateService; store: LiveRateStore; get: jest.Mock } {
  const { http, get } = makeHttp(opts.routes);
  const store = opts.store ?? new LiveRateStore();
  const clock: Clock = { now: () => T0 };
  const service = new LiveRateService(
    http,
    makeConfig(),
    makeEffectiveConfig(opts.feed),
    store,
    scheduler,
    clock,
  );
  return { service, store, get };
}

const FRESH_ROUTES: Route[] = [
  {
    match: '/simple/price',
    data: { tether: { usd: 1.0 }, tron: { usd: 0.325 } },
  },
  {
    match: '/latest/USD',
    data: { result: 'success', rates: { NGN: 1600, USD: 1 } },
  },
  {
    match: '/markets/tickers/usdtngn',
    data: { data: { ticker: { last: '1650.0' } } },
  },
];

describe('LiveRateService.tick', () => {
  it('writes fresh, trusted rates when all sources return valid prints', async () => {
    const { service, store } = makeService({ routes: FRESH_ROUTES });

    await service.tick();

    // USDT/NGN uses the Quidax local ticker (1650), within the divergence band.
    expect(store.getFresh('USDT', 'NGN', T0, FEED.stalenessSec)).toBe(1650);
    // TRX/NGN = coingecko-USD 0.325 × er-api 1600 = 520 (matches the floor).
    expect(store.getFresh('TRX', 'NGN', T0, FEED.stalenessSec)).toBe(520);
    // USDT/USD = coingecko-USD 1 × 1 (no FX leg for USD).
    expect(store.getFresh('USDT', 'USD', T0, FEED.stalenessSec)).toBe(1);
    // TRX/USD has no config floor → no live row is produced.
    expect(store.get('TRX', 'USD')).toBeUndefined();
  });

  it('rejects a divergent print (degraded → config fallback), keeping other pairs', async () => {
    const routes: Route[] = [
      FRESH_ROUTES[0],
      FRESH_ROUTES[1],
      // Quidax prints USDT/NGN = 9000 — 462% over the 1600 floor (> 1500 bps).
      {
        match: '/markets/tickers/usdtngn',
        data: { data: { ticker: { last: '9000' } } },
      },
    ];
    const { service, store } = makeService({ routes });

    await service.tick();

    expect(store.getFresh('USDT', 'NGN', T0, FEED.stalenessSec)).toBeNull();
    expect(store.get('USDT', 'NGN')?.degraded).toBe(true);
    // A well-behaved pair is unaffected.
    expect(store.getFresh('TRX', 'NGN', T0, FEED.stalenessSec)).toBe(520);
  });

  it('marks pairs degraded and records the source down when a source fails', async () => {
    const routes: Route[] = [
      { match: '/simple/price', error: true }, // CoinGecko down
      FRESH_ROUTES[1],
      FRESH_ROUTES[2],
    ];
    const { service, store } = makeService({ routes });

    await service.tick();

    // TRX/NGN needs CoinGecko → degraded → fallback.
    expect(store.getFresh('TRX', 'NGN', T0, FEED.stalenessSec)).toBeNull();
    // USDT/NGN still comes from Quidax (up) → fresh.
    expect(store.getFresh('USDT', 'NGN', T0, FEED.stalenessSec)).toBe(1650);

    const health = store.healthSnapshot(T0, FEED.stalenessSec);
    expect(health.status).toBe('degraded');
    expect(health.sourcesDown).toContain('coingecko');
  });

  it('does nothing when the kill-switch (pricing.feed.enabled) is off', async () => {
    const { service, store, get } = makeService({
      routes: FRESH_ROUTES,
      feed: { ...FEED, enabled: false },
    });

    await service.tick();

    expect(get).not.toHaveBeenCalled();
    expect(store.getFresh('USDT', 'NGN', T0, FEED.stalenessSec)).toBeNull();
  });

  it('serves a stale rate back as null once past the staleness window', async () => {
    const { service, store } = makeService({ routes: FRESH_ROUTES });

    await service.tick();

    const wayLater = new Date(T0.getTime() + (FEED.stalenessSec + 1) * 1000);
    expect(
      store.getFresh('USDT', 'NGN', wayLater, FEED.stalenessSec),
    ).toBeNull();
  });
});

describe('LiveRateService scheduling', () => {
  const realNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = realNodeEnv;
    jest.clearAllMocks();
  });

  it('skips scheduling under NODE_ENV=test (no real network in suites)', () => {
    process.env.NODE_ENV = 'test';
    const { service } = makeService({ routes: FRESH_ROUTES });
    service.onModuleInit();
    expect(scheduler.addInterval).not.toHaveBeenCalled();
  });

  it('registers and tears down the poll interval outside test', () => {
    process.env.NODE_ENV = 'production';
    const { service } = makeService({ routes: FRESH_ROUTES });

    const addInterval = scheduler.addInterval as unknown as jest.MockedFunction<
      (name: string, id: NodeJS.Timeout) => void
    >;

    service.onModuleInit();
    expect(addInterval).toHaveBeenCalledWith(
      'pricing-feed-poll',
      expect.anything(),
    );

    // Clear the REAL interval the service created (the mock registry does not),
    // so this test does not leak a live timer into the jest process.
    const handle = addInterval.mock.calls[0][1];
    clearInterval(handle);

    (scheduler.doesExist as jest.Mock).mockReturnValue(true);
    service.onModuleDestroy();
    expect(scheduler.deleteInterval).toHaveBeenCalledWith('pricing-feed-poll');
  });
});

describe('composeLiveRates (pure)', () => {
  it('produces a row ONLY for pairs with a positive config floor', () => {
    const rows = composeLiveRates(FEED, PRICING, T0, {
      coingeckoUsd: { USDT: 1, TRX: 0.325 },
      fx: { NGN: 1600, USD: 1 },
      quidaxUsdtNgn: 1650,
    });
    const keys = rows.map((r) => `${r.asset}:${r.fiat}`).sort();
    // TRX:USD is skipped (no floor); the other three are produced.
    expect(keys).toEqual(['TRX:NGN', 'USDT:NGN', 'USDT:USD']);
  });

  it('marks a pair degraded when its source is unavailable', () => {
    const rows = composeLiveRates(FEED, PRICING, T0, {
      coingeckoUsd: null,
      fx: { NGN: 1600, USD: 1 },
      quidaxUsdtNgn: null,
    });
    // With no CoinGecko + no Quidax, every pair is degraded and falls back.
    expect(rows.every((r) => r.degraded)).toBe(true);
  });
});
