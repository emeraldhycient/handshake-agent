/**
 * Transaction list end-to-end acceptance test (Task 2).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives
 * the GET /transactions list endpoint:
 *
 *   1. signup → verify-email → login → kyc/submit → accessToken + userId
 *   2. Seed a transaction via PrismaService for that userId
 *   3. GET /transactions (Bearer) → 200 { items: [{ type: 'buy', asset: 'USDT', ... }] }
 *   4. GET /transactions (no token) → 401
 *
 * Bootstrap mirrors wallet-reads.e2e-spec.ts:
 *   - Testcontainers Postgres + prisma migrate deploy
 *   - env vars set BEFORE dynamic import() of AppModule
 *   - Four provider overrides: LLM_PROVIDER, WALLET_PROVIDER, PAYMENT_PROVIDER, WHATSAPP_SENDER
 */

import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

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

describe('Transaction list — e2e (GET /transactions)', () => {
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
      WHATSAPP_PHONE_NUMBER_ID: 'test-pnid-e2e-txn-list',
      WHATSAPP_ACCESS_TOKEN: 'e2e-wa-access-token-txn-list-fake',
      WHATSAPP_APP_SECRET: 'e2e-txn-list-app-secret-123',
      WHATSAPP_VERIFY_TOKEN: 'e2e-verify-token-txn-list',
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-txn-list-directive-key-32bytes!',
      RECEIPT_SIGNING_KEY: 'e2e-txn-list-receipt-key-32bytes!!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-txn-list',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-txn-list',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-txn-list',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-txn-list',
      JWT_SECRET: 'e2e-txn-list-jwt-secret-at-least-32-bytes!!',
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
        address: 'TTxnListFakeWalletAddr1234567890',
        providerReference: 'fake_blockradar_ref_txn_list_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-txn-list-stub',
        status: 'pending' as const,
      }),
      getWithdrawalStatus: jest
        .fn()
        .mockResolvedValue({ status: 'pending' as const }),
    };

    fakePaymentProvider = {
      createCollection: jest.fn().mockResolvedValue({
        accountNumber: '0081234567',
        bankName: 'Txn List Test MFB',
        providerRef: 'flw_fake_ref_txn_list_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_txn_list_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    fakeSender = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.tl.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.tl.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.tl.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.tl.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.tl.e2e' }),
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
  // Helper: full signup → verify → login → kyc → accessToken + userId
  // ---------------------------------------------------------------------------

  async function setupVerifiedUser(
    userEmail: string,
  ): Promise<{ accessToken: string; userId: string }> {
    const deviceFingerprint = `e2e-txn-list-fp-${userEmail.slice(0, 16)}`;

    // 1. Signup
    const su = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: userEmail, phone: '+2348099991234' })
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

    // 4. Login verify
    const lv = await request(app.getHttpServer())
      .post('/auth/login/verify')
      .send({ email: userEmail, otp: devOtp, deviceFingerprint })
      .expect(200);
    const { accessToken } = lv.body as {
      accessToken: string;
      refreshToken: string;
      user: { email: string; id: string };
    };

    // 5. KYC submit (sets PIN + provisions wallet)
    const ks = await request(app.getHttpServer())
      .post('/kyc/submit')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Eze',
        lastName: 'Nweke',
        nin: '12345678901',
        pin: '1234',
      })
      .expect(200);
    const { userId } = ks.body as { userId: string; status: string };

    return { accessToken, userId };
  }

  // ===========================================================================
  // Test 1: GET /transactions without token → 401
  // ===========================================================================

  it('GET /transactions without Bearer token → 401', async () => {
    await request(app.getHttpServer()).get('/transactions').expect(401);
  }, 30_000);

  // ===========================================================================
  // Test 2: Happy path — GET /transactions with seeded transaction
  // ===========================================================================

  it('signup → verify → login → kyc → seed tx → GET /transactions → 200 with item', async () => {
    const email = `e2e_tl_${Date.now()}@test.com`;
    const { accessToken, userId } = await setupVerifiedUser(email);

    // Seed a transaction for this user directly via PrismaService
    await prisma.transaction.create({
      data: {
        userId,
        type: 'buy',
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: 'a'.repeat(64),
        metadata: {
          asset: 'USDT',
          cryptoAmount: '29.97',
          fiatAmount: '50000',
          fiatCurrency: 'NGN',
        },
      },
    });

    // GET /transactions with Bearer token
    const res = await request(app.getHttpServer())
      .get('/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const body = res.body as {
      items: { type: string; asset?: string; status: string }[];
      nextCursor?: string;
    };

    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items[0]).toMatchObject({ type: 'buy', asset: 'USDT' });
  }, 120_000);
});
