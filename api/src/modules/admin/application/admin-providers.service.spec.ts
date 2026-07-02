import { AdminProvidersService } from './admin-providers.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../core/config/env.schema';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';

// A minimal ConfigService stand-in driven by an in-memory env map.
function makeConfig(env: Partial<Env>): ConfigService<Env, true> {
  return {
    get<K extends keyof Env>(key: K): Env[K] {
      return env[key] as Env[K];
    },
  } as unknown as ConfigService<Env, true>;
}

// A minimal EffectiveConfigService stand-in returning a fixed catalog snapshot.
function makeEffectiveConfig(
  capabilities: Record<string, boolean>,
): EffectiveConfigService {
  return {
    get<T>(key: string): T {
      if (key === 'catalog.capabilities') return capabilities as T;
      return undefined as T;
    },
  } as unknown as EffectiveConfigService;
}

// A fully-live env: every provider secret present, all mock modes off, webhook
// secret present, swap live.
const LIVE_ENV: Partial<Env> = {
  BLOCKRADAR_API_KEY: 'br-key',
  FLUTTERWAVE_SECRET_KEY: 'flw-key',
  FLUTTERWAVE_WEBHOOK_SECRET: 'flw-webhook',
  RESEND_API_KEY: 're-key',
  WHATSAPP_ACCESS_TOKEN: 'wa-token',
  ANTHROPIC_API_KEY: 'ant-key',
  WALLET_MOCK_MODE: 'false',
  PAYMENTS_MOCK_MODE: 'false',
  SANCTIONS_MOCK_MODE: 'false',
  NAME_ENQUIRY_MOCK_MODE: 'false',
  SWAP_MOCK_MODE: 'false',
};

const ALL_CAPS: Record<string, boolean> = {
  'crypto.buy': true,
  'crypto.sell': true,
  'crypto.send': true,
  'crypto.swap': true,
};

function build(
  env: Partial<Env>,
  caps: Record<string, boolean> = ALL_CAPS,
): AdminProvidersService {
  return new AdminProvidersService(makeConfig(env), makeEffectiveConfig(caps));
}

describe('AdminProvidersService', () => {
  describe('provider cards', () => {
    it('surfaces the five registered providers', () => {
      const view = build(LIVE_ENV).getRegistry();
      expect(view.providers.map((p) => p.key)).toEqual([
        'blockradar',
        'flutterwave',
        'resend',
        'whatsapp',
        'anthropic',
      ]);
    });

    it('marks status ok when live with the secret present', () => {
      const blockradar = build(LIVE_ENV)
        .getRegistry()
        .providers.find((p) => p.key === 'blockradar');
      expect(blockradar).toMatchObject({
        status: 'ok',
        mock: false,
        hasSecret: true,
        latencyMs: null,
      });
    });

    it('marks status mock when the adapter runs in mock mode', () => {
      const view = build({
        ...LIVE_ENV,
        WALLET_MOCK_MODE: 'true',
      }).getRegistry();
      const blockradar = view.providers.find((p) => p.key === 'blockradar');
      expect(blockradar?.status).toBe('mock');
      expect(blockradar?.mock).toBe(true);
    });

    it('marks status down when live but the required secret is absent', () => {
      const view = build({
        ...LIVE_ENV,
        FLUTTERWAVE_SECRET_KEY: '',
      }).getRegistry();
      const flutterwave = view.providers.find((p) => p.key === 'flutterwave');
      expect(flutterwave?.status).toBe('down');
      expect(flutterwave?.hasSecret).toBe(false);
    });

    it('reports mock=false for providers without a mock-mode flag', () => {
      const view = build(LIVE_ENV).getRegistry();
      const resend = view.providers.find((p) => p.key === 'resend');
      expect(resend?.mock).toBe(false);
      expect(resend?.status).toBe('ok');
    });

    it('never returns any secret VALUE, only presence', () => {
      const serialized = JSON.stringify(build(LIVE_ENV).getRegistry());
      expect(serialized).not.toContain('br-key');
      expect(serialized).not.toContain('flw-key');
      expect(serialized).not.toContain('ant-key');
      expect(serialized).not.toContain('wa-token');
    });

    it('drops a disabled crypto capability from the bound list', () => {
      const view = build(LIVE_ENV, {
        ...ALL_CAPS,
        'crypto.swap': false,
      }).getRegistry();
      const blockradar = view.providers.find((p) => p.key === 'blockradar');
      expect(blockradar?.capabilities).toEqual([
        'crypto.buy',
        'crypto.sell',
        'crypto.send',
      ]);
    });

    it('passes through non-catalog capabilities regardless of flags', () => {
      const view = build(LIVE_ENV, {}).getRegistry();
      const flutterwave = view.providers.find((p) => p.key === 'flutterwave');
      expect(flutterwave?.capabilities).toEqual(['payout', 'collection']);
    });
  });

  describe('readiness checklist', () => {
    it('reports every gate done under a fully-live posture', () => {
      const readiness = build(LIVE_ENV).getRegistry().readiness;
      expect(readiness.map((r) => r.key)).toEqual([
        'live-keys',
        'mock-off',
        'webhooks',
        'recon',
        'swap',
      ]);
      expect(readiness.every((r) => r.done)).toBe(true);
    });

    it('fails live-keys when any provider secret is missing', () => {
      const readiness = build({ ...LIVE_ENV, RESEND_API_KEY: '' }).getRegistry()
        .readiness;
      expect(readiness.find((r) => r.key === 'live-keys')?.done).toBe(false);
    });

    it('fails mock-off when any money-path mock flag is on', () => {
      const readiness = build({
        ...LIVE_ENV,
        SANCTIONS_MOCK_MODE: 'true',
      }).getRegistry().readiness;
      expect(readiness.find((r) => r.key === 'mock-off')?.done).toBe(false);
    });

    it('fails webhooks when the Flutterwave webhook secret is absent', () => {
      const readiness = build({
        ...LIVE_ENV,
        FLUTTERWAVE_WEBHOOK_SECRET: '',
      }).getRegistry().readiness;
      expect(readiness.find((r) => r.key === 'webhooks')?.done).toBe(false);
    });

    it('fails recon while the wallet adapter is mocked', () => {
      const readiness = build({
        ...LIVE_ENV,
        WALLET_MOCK_MODE: 'true',
      }).getRegistry().readiness;
      expect(readiness.find((r) => r.key === 'recon')?.done).toBe(false);
    });

    it('fails swap when the swap mock is on', () => {
      const readiness = build({
        ...LIVE_ENV,
        SWAP_MOCK_MODE: 'true',
      }).getRegistry().readiness;
      expect(readiness.find((r) => r.key === 'swap')?.done).toBe(false);
    });

    it('fails swap when the crypto.swap capability is disabled', () => {
      const readiness = build(LIVE_ENV, {
        ...ALL_CAPS,
        'crypto.swap': false,
      }).getRegistry().readiness;
      expect(readiness.find((r) => r.key === 'swap')?.done).toBe(false);
    });
  });
});
