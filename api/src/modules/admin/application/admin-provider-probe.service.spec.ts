import { AdminProviderProbeService } from './admin-provider-probe.service';
import { AdminNotFoundError } from '../domain/admin-errors';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../core/config/env.schema';
import type { IProviderProbe } from './ports/provider-probe.port';

function makeConfig(env: Partial<Env>): ConfigService<Env, true> {
  return {
    get<K extends keyof Env>(key: K): Env[K] {
      return env[key] as Env[K];
    },
  } as unknown as ConfigService<Env, true>;
}

function makeProbe(): jest.Mocked<IProviderProbe> {
  return {
    probe: jest.fn().mockResolvedValue({ reachability: 'ok', latencyMs: 120 }),
  };
}

const LIVE_ENV: Partial<Env> = {
  BLOCKRADAR_API_KEY: 'br-key',
  BLOCKRADAR_BASE_URL: 'https://api.blockradar.co/v1',
  FLUTTERWAVE_SECRET_KEY: 'flw-key',
  FLUTTERWAVE_BASE_URL: 'https://api.flutterwave.com/v3',
  RESEND_API_KEY: 're-key',
  WHATSAPP_ACCESS_TOKEN: 'wa-token',
  ANTHROPIC_API_KEY: 'ant-key',
  WALLET_MOCK_MODE: 'false',
  PAYMENTS_MOCK_MODE: 'false',
};

describe('AdminProviderProbeService', () => {
  let probe: jest.Mocked<IProviderProbe>;

  beforeEach(() => {
    probe = makeProbe();
  });

  function build(env: Partial<Env>): AdminProviderProbeService {
    return new AdminProviderProbeService(makeConfig(env), probe);
  }

  it('probes a live provider and reports ok + measured latency', async () => {
    const res = await build(LIVE_ENV).test('blockradar');

    expect(probe.probe).toHaveBeenCalledWith('https://api.blockradar.co/v1');
    expect(res.key).toBe('blockradar');
    expect(res.result).toBe('ok');
    expect(res.latencyMs).toBe(120);
    expect(typeof res.checkedAt).toBe('string');
  });

  it('returns mock (no probe) when the adapter is in mock mode', async () => {
    const res = await build({ ...LIVE_ENV, WALLET_MOCK_MODE: 'true' }).test(
      'blockradar',
    );

    expect(probe.probe).not.toHaveBeenCalled();
    expect(res.result).toBe('mock');
    expect(res.latencyMs).toBeNull();
  });

  it('returns not_configured (no probe) when the secret is absent', async () => {
    const res = await build({
      ...LIVE_ENV,
      BLOCKRADAR_API_KEY: undefined,
    }).test('blockradar');

    expect(probe.probe).not.toHaveBeenCalled();
    expect(res.result).toBe('not_configured');
    expect(res.latencyMs).toBeNull();
  });

  it('maps a down reachability to a down result with null latency', async () => {
    probe.probe.mockResolvedValue({ reachability: 'down', latencyMs: 0 });
    const res = await build(LIVE_ENV).test('flutterwave');
    expect(res.result).toBe('down');
    expect(res.latencyMs).toBeNull();
  });

  it('maps a degraded reachability through with its latency', async () => {
    probe.probe.mockResolvedValue({ reachability: 'degraded', latencyMs: 900 });
    const res = await build(LIVE_ENV).test('flutterwave');
    expect(res.result).toBe('degraded');
    expect(res.latencyMs).toBe(900);
  });

  it('NEVER passes a secret to the probe — only the base URL', async () => {
    await build(LIVE_ENV).test('blockradar');
    const arg = probe.probe.mock.calls[0][0];
    expect(arg).toBe('https://api.blockradar.co/v1');
    expect(arg).not.toContain('br-key');
  });

  it('rejects an unknown provider key (fail-closed)', async () => {
    await expect(build(LIVE_ENV).test('no-such')).rejects.toBeInstanceOf(
      AdminNotFoundError,
    );
    expect(probe.probe).not.toHaveBeenCalled();
  });

  it('treats a provider with no probe endpoint (whatsapp/anthropic) as not_configured for probe', async () => {
    // WhatsApp/Anthropic have no configured base URL in this spec env → the probe
    // cannot run credential-free against a known host, so it is not_configured.
    const res = await build(LIVE_ENV).test('anthropic');
    expect(probe.probe).not.toHaveBeenCalled();
    expect(res.result).toBe('not_configured');
  });
});
