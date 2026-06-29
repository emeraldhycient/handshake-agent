/**
 * Notifications read endpoint — e2e acceptance test (Task 3).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives
 * the GET /notifications endpoint:
 *
 *   1. signup → verify-email → login → accessToken + userId
 *   2. Seed a Notification row via PrismaService for that userId
 *   3. GET /notifications (Bearer) → 200 { items: [{ eventType, eventRef, ... }] }
 *   4. GET /notifications (no token) → 401
 *
 * Bootstrap mirrors transaction-list.e2e-spec.ts:
 *   - Testcontainers Postgres + prisma migrate deploy
 *   - env vars set BEFORE dynamic import() of AppModule
 *   - Four provider overrides: LLM_PROVIDER, WALLET_PROVIDER, PAYMENT_PROVIDER, WHATSAPP_SENDER
 */

import { execSync } from 'node:child_process';
import { join } from 'node:path';

// supertest is a CommonJS module; allowSyntheticDefaultImports lets us import it
// as a default, and ts-jest's CJS interop makes it callable as a function.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { INestApplication } from '@nestjs/common';

// Port symbol imports — these do NOT transitively import AppModule or trigger
// ConfigModule.forRoot(). They export only const symbols and interfaces.
import { LLM_PROVIDER } from '../src/modules/agent/application/ports/agent.port';
import { WALLET_PROVIDER } from '../src/modules/wallets/application/ports/wallet-provider.port';
import { PAYMENT_PROVIDER } from '../src/modules/treasury/application/ports/payment-provider.port';
import { WHATSAPP_SENDER } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';
import type { LlmProvider } from '../src/modules/agent/core/ports/llm-provider.port';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';
import type { IWhatsAppSender } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_ROOT = join(__dirname, '..');

// ===========================================================================
// THE TEST SUITE
// ===========================================================================

describe('Notifications read — e2e (GET /notifications)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stopContainer: () => Promise<void>;
  let fakeLlmProvider: jest.Mocked<LlmProvider>;
  let fakeWalletProvider: jest.Mocked<IWalletProvider>;
  let fakePaymentProvider: jest.Mocked<IPaymentProvider>;
  let fakeSender: jest.Mocked<IWhatsAppSender>;

  // ── beforeAll: set env → import AppModule → boot ───────────────────────────

  beforeAll(async () => {
    // 1. Boot Postgres container and apply migrations
    const container = await new PostgreSqlContainer(
      'postgres:16-alpine',
    ).start();
    const dbUrl = container.getConnectionUri();

    execSync('node_modules/.bin/prisma migrate deploy', {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'inherit',
    });

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: dbUrl }),
    });
    await prisma.$connect();

    stopContainer = async () => {
      await prisma.$disconnect();
      await container.stop();
    };

    // 2. Set ALL required env vars BEFORE importing AppModule.
    //    CRITICAL: ConfigModule.forRoot() calls validateEnv() synchronously
    //    at module decoration time (when app.module.ts is first required).
    //    These must be in process.env BEFORE that dynamic import() happens.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: dbUrl,
      WHATSAPP_PHONE_NUMBER_ID: 'test-pnid-e2e-notif',
      WHATSAPP_ACCESS_TOKEN: 'e2e-wa-access-token-notif-fake',
      WHATSAPP_APP_SECRET: 'e2e-notif-app-secret-123',
      WHATSAPP_VERIFY_TOKEN: 'e2e-verify-token-notif',
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-notif-directive-key-32bytes!!x',
      RECEIPT_SIGNING_KEY: 'e2e-notif-receipt-signing-key-32b!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-notif',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-notif',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-notif',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-notif',
      JWT_SECRET: 'e2e-notif-jwt-secret-at-least-32-bytes!!',
      AUTH_DEV_EXPOSE_OTP: 'true',
    });
    // Ensure ANTHROPIC_API_KEY is absent (not empty string) to pass optional validation
    delete process.env.ANTHROPIC_API_KEY;

    // 3. Dynamic import of AppModule (happens AFTER env vars are set above).
    //    Deferring this import is essential: ConfigModule.forRoot() calls
    //    validateEnv() synchronously when the module file is first required.
    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    // 4. Build fake providers with correct interface shapes
    fakeLlmProvider = {
      extractIntent: jest.fn().mockResolvedValue({
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount: '5000',
        fiatCurrency: 'NGN',
      }),
    };

    fakeWalletProvider = {
      provisionAddress: jest.fn().mockResolvedValue({
        address: 'TNotifFakeWalletAddr123456789012',
        providerReference: 'fake_blockradar_ref_notif_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-notif-stub',
        status: 'pending' as const,
      }),
      getWithdrawalStatus: jest
        .fn()
        .mockResolvedValue({ status: 'pending' as const }),
    };

    fakePaymentProvider = {
      createCollection: jest.fn().mockResolvedValue({
        accountNumber: '0081234567',
        bankName: 'Notif Test MFB',
        providerRef: 'flw_fake_ref_notif_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_notif_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    fakeSender = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.notif.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.notif.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.notif.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.notif.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.notif.e2e' }),
    };

    // 5. Compile NestJS TestingModule with provider overrides
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER)
      .useValue(fakeLlmProvider)
      .overrideProvider(WALLET_PROVIDER)
      .useValue(fakeWalletProvider)
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(fakePaymentProvider)
      .overrideProvider(WHATSAPP_SENDER)
      .useValue(fakeSender)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  }, 120_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await stopContainer?.();
  });

  // ---------------------------------------------------------------------------
  // Helper: full signup → verify → login → accessToken + userId
  // ---------------------------------------------------------------------------

  async function setupVerifiedUser(
    userEmail: string,
  ): Promise<{ accessToken: string; userId: string }> {
    const deviceFingerprint = `e2e-notif-fp-${userEmail.slice(0, 16)}`;

    // 1. Signup
    const su = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: userEmail, phone: '+2348099994567' })
      .expect(202);
    const { devToken } = su.body as { status: string; devToken: string };

    // 2. Verify email
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: devToken })
      .expect(200);

    // 3. Login request
    const lr = await request(app.getHttpServer())
      .post('/auth/login/request')
      .send({ email: userEmail })
      .expect(202);
    const { devOtp } = lr.body as { status: string; devOtp: string };

    // 4. Login verify — get accessToken + userId from session
    const lv = await request(app.getHttpServer())
      .post('/auth/login/verify')
      .send({ email: userEmail, otp: devOtp, deviceFingerprint })
      .expect(200);
    const lvBody = lv.body as {
      accessToken: string;
      refreshToken: string;
      user: { userId: string; email: string };
    };

    return { accessToken: lvBody.accessToken, userId: lvBody.user.userId };
  }

  // ===========================================================================
  // Test 1: GET /notifications without token → 401
  // ===========================================================================

  it('GET /notifications without Bearer token → 401', async () => {
    await request(app.getHttpServer()).get('/notifications').expect(401);
  }, 30_000);

  // ===========================================================================
  // Test 2: Happy path — GET /notifications with seeded notification
  // ===========================================================================

  it('signup → verify → login → seed notification → GET /notifications → 200 with item', async () => {
    const email = `e2e_notif_${Date.now()}@test.com`;
    const { accessToken, userId } = await setupVerifiedUser(email);

    // Seed a notification for this user directly via PrismaClient
    await prisma.notification.create({
      data: {
        userId,
        eventType: 'transaction_completed',
        eventRef: 'tx1',
        templateVars: {},
        primaryChannel: 'whatsapp',
      },
    });

    // GET /notifications with Bearer token
    const res = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const body = res.body as {
      items: { eventType: string; eventRef: string }[];
    };
    expect(body.items[0]).toMatchObject({
      eventType: 'transaction_completed',
      eventRef: 'tx1',
    });
  }, 120_000);
});
