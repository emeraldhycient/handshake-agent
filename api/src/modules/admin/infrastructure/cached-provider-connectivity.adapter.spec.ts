import { CachedProviderConnectivityAdapter } from './cached-provider-connectivity.adapter';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../core/config/env.schema';
import type { Clock } from '../../../core/common/clock';
import type { IProviderProbe } from '../application/ports/provider-probe.port';

const LIVE_ENV: Partial<Env> = {
  BLOCKRADAR_API_KEY: 'br',
  BLOCKRADAR_BASE_URL: 'https://api.blockradar.co/v1',
  FLUTTERWAVE_SECRET_KEY: 'flw',
  FLUTTERWAVE_BASE_URL: 'https://api.flutterwave.com/v3',
  RESEND_API_KEY: 're',
  RESEND_BASE_URL: 'https://api.resend.com',
  WHATSAPP_ACCESS_TOKEN: 'wa',
  WHATSAPP_GRAPH_BASE_URL: 'https://graph.facebook.com',
  ANTHROPIC_API_KEY: 'ant',
  ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
  WALLET_MOCK_MODE: 'false',
  PAYMENTS_MOCK_MODE: 'false',
};

function makeConfig(env: Partial<Env>): ConfigService<Env, true> {
  return { get: (k: keyof Env) => env[k] } as unknown as ConfigService<
    Env,
    true
  >;
}

function makeProbe(): jest.Mocked<IProviderProbe> {
  return {
    probe: jest.fn().mockResolvedValue({ reachability: 'ok', latencyMs: 120 }),
  };
}

function makeClock(startMs: number): {
  clock: Clock;
  set: (ms: number) => void;
} {
  let nowMs = startMs;
  return { clock: { now: () => new Date(nowMs) }, set: (ms) => (nowMs = ms) };
}

describe('CachedProviderConnectivityAdapter', () => {
  it('returns an observed status + latency for a probeable provider', async () => {
    const probe = makeProbe();
    const a = new CachedProviderConnectivityAdapter(
      makeConfig(LIVE_ENV),
      probe,
      makeClock(0).clock,
    );
    const res = await a.statusFor('resend');
    expect(res).toEqual({ status: 'ok', latencyMs: 120, observed: true });
    // credential-free: probe called with EXACTLY the base URL — never the secret.
    expect(probe.probe).toHaveBeenCalledWith('https://api.resend.com');
  });

  it('maps a down reachability to null latency, still observed', async () => {
    const probe = makeProbe();
    probe.probe.mockResolvedValue({ reachability: 'down', latencyMs: 4000 });
    const a = new CachedProviderConnectivityAdapter(
      makeConfig(LIVE_ENV),
      probe,
      makeClock(0).clock,
    );
    expect(await a.statusFor('whatsapp')).toEqual({
      status: 'down',
      latencyMs: null,
      observed: true,
    });
  });

  it('is unobserved (no probe) when a provider is not_configured', async () => {
    const probe = makeProbe();
    const env = { ...LIVE_ENV, ANTHROPIC_API_KEY: undefined };
    const a = new CachedProviderConnectivityAdapter(
      makeConfig(env),
      probe,
      makeClock(0).clock,
    );
    const res = await a.statusFor('anthropic');
    expect(res).toEqual({ status: 'ok', latencyMs: null, observed: false });
    // anthropic was skipped; only the other four (configured) providers were probed
    const probedUrls = probe.probe.mock.calls.map((c) => c[0]);
    expect(probedUrls).not.toContain('https://api.anthropic.com');
  });

  it('is unobserved (no probe) when a settling adapter is in mock mode', async () => {
    const probe = makeProbe();
    const a = new CachedProviderConnectivityAdapter(
      makeConfig({ ...LIVE_ENV, WALLET_MOCK_MODE: 'true' }),
      probe,
      makeClock(0).clock,
    );
    expect(await a.statusFor('blockradar')).toEqual({
      status: 'ok',
      latencyMs: null,
      observed: false,
    });
  });

  it('single-flights: concurrent calls trigger exactly one probe per provider', async () => {
    const probe = makeProbe();
    const a = new CachedProviderConnectivityAdapter(
      makeConfig(LIVE_ENV),
      probe,
      makeClock(0).clock,
    );
    await Promise.all([
      a.statusFor('resend'),
      a.statusFor('whatsapp'),
      a.statusFor('anthropic'),
    ]);
    // 5 providers, each probed once — not once-per-caller
    expect(probe.probe).toHaveBeenCalledTimes(5);
  });

  it('serves the cache within the TTL and re-probes after it expires', async () => {
    const probe = makeProbe();
    const c = makeClock(0);
    const a = new CachedProviderConnectivityAdapter(
      makeConfig(LIVE_ENV),
      probe,
      c.clock,
    );

    await a.statusFor('resend');
    expect(probe.probe).toHaveBeenCalledTimes(5);

    c.set(44_000); // < 45s TTL → cache hit, no new probes
    await a.statusFor('resend');
    expect(probe.probe).toHaveBeenCalledTimes(5);

    c.set(46_000); // > TTL → refresh
    await a.statusFor('resend');
    expect(probe.probe).toHaveBeenCalledTimes(10);
  });
});
