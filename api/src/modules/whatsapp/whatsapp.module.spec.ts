/**
 * Integration-light compile test for WhatsAppModule.
 *
 * Sets required env vars before the module compiles so the env validation
 * schema passes. No network calls are made.
 *
 * WhatsAppModule now imports ConversationsModule (which pulls in AgentModule,
 * IdentityModule, TransactionsModule, and WhatsAppSenderModule). The full
 * dependency tree includes PrismaService (DB) and AnthropicLlmProvider (LLM).
 *
 * Strategy: import PrismaModule (which is @Global so it satisfies all child
 * module PrismaService injections) and override PrismaService with a noop
 * stub. Also override INBOUND_HANDLER with a noop stub to keep the test lean.
 */

import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import configuration from '../../core/config/configuration';
import { validateEnv } from '../../core/config/env.schema';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CatalogModule } from '../../core/catalog/catalog.module';
import { ProposalService } from '../transactions/application/proposal.service';
import {
  INBOUND_HANDLER,
  type IInboundHandler,
} from './application/ports/inbound-handler.port';
import { WhatsAppWebhookController } from './presentation/whatsapp-webhook.controller';
import { WhatsAppModule } from './whatsapp.module';

// Stub implementations used to override real providers that require
// external resources (DB, LLM API, HTTP) in the compiled module graph.
const noopInboundHandler: IInboundHandler = {
  handleInbound: () => Promise.resolve(),
};

// Noop PrismaService stub — no DB connection attempted.
// All methods return sensible no-op values so repositories can be instantiated
// without connecting to a real database.
const noopPrismaService = {
  $connect: () => Promise.resolve(),
  $disconnect: () => Promise.resolve(),
  onModuleInit: () => Promise.resolve(),
  onModuleDestroy: () => Promise.resolve(),
} as unknown as PrismaService;

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
        // PrismaModule is @Global — importing it here makes PrismaService available
        // to all child modules (IdentityModule, TransactionsModule, etc.) without
        // connecting to a real DB (we override PrismaService below).
        PrismaModule,
        // CatalogModule is @Global in the full app — import here so AssetRegistry
        // is available to ConversationsModule's ConversationService.
        CatalogModule,
        WhatsAppModule,
      ],
    })
      // Override INBOUND_HANDLER so ConversationsModule's full orchestration
      // (DB writes, LLM calls, proposal creation) does not execute in a compile test.
      .overrideProvider(INBOUND_HANDLER)
      .useValue(noopInboundHandler)
      // Override PrismaService so infrastructure repositories can be instantiated
      // without an actual DB connection.
      .overrideProvider(PrismaService)
      .useValue(noopPrismaService)
      // Override ProposalService: it injects QuotesService via reflected type
      // metadata (not a symbol token). The type import in proposal.service.ts
      // emits `Object` in the compiled output, which Nest cannot resolve by type
      // when the module is loaded in a unit test context without the real
      // QuotesModule DI sub-tree. A noop stub avoids the resolution failure.
      .overrideProvider(ProposalService)
      .useValue({ createBuyProposal: jest.fn() })
      .compile();
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
