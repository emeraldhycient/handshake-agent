import { AdminWhatsAppConfigService } from './admin-whatsapp-config.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../core/config/env.schema';

// A minimal ConfigService stand-in driven by an in-memory env map.
function makeConfig(env: Partial<Env>): ConfigService<Env, true> {
  return {
    get<K extends keyof Env>(key: K): Env[K] {
      return env[key] as Env[K];
    },
  } as unknown as ConfigService<Env, true>;
}

describe('AdminWhatsAppConfigService', () => {
  it('returns the non-secret config values with secret-presence booleans', () => {
    const svc = new AdminWhatsAppConfigService(
      makeConfig({
        WHATSAPP_GRAPH_VERSION: 'v25.0',
        WHATSAPP_GRAPH_BASE_URL: 'https://graph.facebook.com',
        WHATSAPP_PHONE_NUMBER_ID: 'pnid-123',
        WHATSAPP_FLOW_ID: 'flow-1',
        WHATSAPP_BENEFICIARY_FLOW_ID: 'flow-2',
        WHATSAPP_WABA_ID: 'waba-1',
        WHATSAPP_APP_ID: 'app-1',
        WHATSAPP_APP_SECRET: 'super-secret-value',
        WHATSAPP_FLOW_PRIVATE_KEY: '-----BEGIN KEY-----',
        WHATSAPP_VERIFY_TOKEN: 'verify-token',
      }),
    );

    const config = svc.getConfig();

    expect(config).toEqual({
      graphVersion: 'v25.0',
      graphBaseUrl: 'https://graph.facebook.com',
      phoneNumberId: 'pnid-123',
      flowId: 'flow-1',
      beneficiaryFlowId: 'flow-2',
      wabaId: 'waba-1',
      appId: 'app-1',
      hasAppSecret: true,
      hasFlowPrivateKey: true,
      hasVerifyToken: true,
    });
  });

  it('never returns the secret VALUES (only boolean presence)', () => {
    const svc = new AdminWhatsAppConfigService(
      makeConfig({
        WHATSAPP_GRAPH_VERSION: 'v25.0',
        WHATSAPP_GRAPH_BASE_URL: 'https://graph.facebook.com',
        WHATSAPP_PHONE_NUMBER_ID: 'pnid-123',
        WHATSAPP_FLOW_ID: '',
        WHATSAPP_BENEFICIARY_FLOW_ID: '',
        WHATSAPP_WABA_ID: '',
        WHATSAPP_APP_ID: '',
        WHATSAPP_APP_SECRET: 'top-secret-app-secret',
        WHATSAPP_FLOW_PRIVATE_KEY: 'top-secret-private-key',
        WHATSAPP_VERIFY_TOKEN: 'top-secret-verify',
      }),
    );

    const serialized = JSON.stringify(svc.getConfig());
    expect(serialized).not.toContain('top-secret-app-secret');
    expect(serialized).not.toContain('top-secret-private-key');
    expect(serialized).not.toContain('top-secret-verify');
  });

  it('reports false presence flags when secrets are empty', () => {
    const svc = new AdminWhatsAppConfigService(
      makeConfig({
        WHATSAPP_GRAPH_VERSION: 'v25.0',
        WHATSAPP_GRAPH_BASE_URL: 'https://graph.facebook.com',
        WHATSAPP_PHONE_NUMBER_ID: 'pnid-123',
        WHATSAPP_FLOW_ID: '',
        WHATSAPP_BENEFICIARY_FLOW_ID: '',
        WHATSAPP_WABA_ID: '',
        WHATSAPP_APP_ID: '',
        WHATSAPP_APP_SECRET: '',
        WHATSAPP_FLOW_PRIVATE_KEY: '',
        WHATSAPP_VERIFY_TOKEN: '',
      }),
    );

    const config = svc.getConfig();
    expect(config.hasAppSecret).toBe(false);
    expect(config.hasFlowPrivateKey).toBe(false);
    expect(config.hasVerifyToken).toBe(false);
  });
});
