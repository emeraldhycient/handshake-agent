/**
 * Integration-light compile test for WhatsAppModule.
 *
 * Sets required env vars before the module compiles so the env validation
 * schema passes. No network calls are made.
 */

import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import configuration from '../../core/config/configuration';
import { validateEnv } from '../../core/config/env.schema';
import {
  INBOUND_HANDLER,
  type IInboundHandler,
} from './application/ports/inbound-handler.port';
import { WhatsAppWebhookController } from './presentation/whatsapp-webhook.controller';
import { WhatsAppModule } from './whatsapp.module';

// Set required env vars before the module compiles (env validation runs at
// ConfigModule load time). These are test-only dummy values — no network is hit.
beforeAll(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-number-id';
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
  process.env.BLOCKRADAR_API_KEY = 'test-blockradar-key';
  process.env.BLOCKRADAR_MASTER_WALLET_ID = 'test-master-wallet-id';
  process.env.FLUTTERWAVE_SECRET_KEY = 'test-flutterwave-key';
  // ANTHROPIC_API_KEY is optional in prod but .min(1) means empty string fails.
  // Ensure it is absent (not empty string) so the optional() branch is used.
  delete process.env.ANTHROPIC_API_KEY;
});

describe('WhatsAppModule (compile)', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          // Do not load the .env file in tests — use process.env set in beforeAll.
          // This prevents .env values (e.g. ANTHROPIC_API_KEY='') from causing
          // env validation failures.
          ignoreEnvFile: true,
          load: [configuration],
          validate: (raw: Record<string, unknown>) => validateEnv(raw),
        }),
        WhatsAppModule,
      ],
    }).compile();
  });

  afterEach(async () => {
    await module.close();
  });

  it('compiles the module without error', () => {
    expect(module).toBeDefined();
  });

  it('resolves WhatsAppWebhookController', () => {
    const controller = module.get(WhatsAppWebhookController);
    expect(controller).toBeDefined();
  });

  it('resolves the INBOUND_HANDLER provider', () => {
    // module.get with a Symbol token returns `any`; cast to the port interface.
    const handler = module.get<IInboundHandler>(INBOUND_HANDLER);
    expect(handler).toBeDefined();
  });
});
