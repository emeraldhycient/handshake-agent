import {
  PROVIDER_PROBE_SPECS,
  resolveProbePosture,
  type ProbeConfigReader,
  type ProbeSpec,
} from './provider-probe-registry';
import type { Env } from '../../../core/config/env.schema';

function readerFrom(env: Partial<Env>): ProbeConfigReader {
  return (key) => env[key];
}

function spec(key: string): ProbeSpec {
  const found = PROVIDER_PROBE_SPECS.find((s) => s.key === key);
  if (found === undefined) throw new Error(`no spec for ${key}`);
  return found;
}

const LIVE: Partial<Env> = {
  BLOCKRADAR_API_KEY: 'br',
  BLOCKRADAR_BASE_URL: 'https://api.blockradar.co/v1',
  RESEND_API_KEY: 're',
  RESEND_BASE_URL: 'https://api.resend.com',
  WHATSAPP_ACCESS_TOKEN: 'wa',
  WHATSAPP_GRAPH_BASE_URL: 'https://graph.facebook.com',
  ANTHROPIC_API_KEY: 'ant',
  ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
  WALLET_MOCK_MODE: 'false',
  PAYMENTS_MOCK_MODE: 'false',
};

describe('resolveProbePosture', () => {
  it('registers all five providers with a base URL each', () => {
    expect(PROVIDER_PROBE_SPECS.map((s) => s.key)).toEqual([
      'blockradar',
      'flutterwave',
      'resend',
      'whatsapp',
      'anthropic',
    ]);
    for (const s of PROVIDER_PROBE_SPECS) expect(s.baseUrlKey).not.toBeNull();
  });

  it('returns a probe posture with the resolved base URL when live (non-settling)', () => {
    expect(resolveProbePosture(spec('anthropic'), readerFrom(LIVE))).toEqual({
      kind: 'probe',
      baseUrl: 'https://api.anthropic.com',
    });
  });

  it('returns mock when the adapter mock-mode flag is "true" (settling)', () => {
    const reader = readerFrom({ ...LIVE, WALLET_MOCK_MODE: 'true' });
    expect(resolveProbePosture(spec('blockradar'), reader)).toEqual({
      kind: 'mock',
    });
  });

  it('returns not_configured when the secret is absent', () => {
    const reader = readerFrom({ ...LIVE, ANTHROPIC_API_KEY: undefined });
    expect(resolveProbePosture(spec('anthropic'), reader)).toEqual({
      kind: 'not_configured',
    });
  });

  it('returns not_configured when the base URL is absent/empty', () => {
    const reader = readerFrom({ ...LIVE, RESEND_BASE_URL: '' });
    expect(resolveProbePosture(spec('resend'), reader)).toEqual({
      kind: 'not_configured',
    });
  });
});
