/**
 * Session-authenticated KYC submit — end-to-end acceptance test.
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives
 * the complete happy-path for POST /kyc/submit:
 *
 *   1. POST /auth/signup         → 202, devToken
 *   2. POST /auth/verify-email   → 200, { verified: true }
 *   3. POST /auth/login/request  → 202, devOtp
 *   4. POST /auth/login/verify   → 200, { accessToken }
 *   5. POST /kyc/submit (Bearer) → 200, { userId, status: 'verified' }
 *   6. DB assertions: User + KycProfile upgraded
 *
 * Plus: POST /kyc/submit without Bearer → 401.
 *
 * Bootstrap mirrors auth.e2e-spec.ts:
 *   - Testcontainers Postgres + prisma migrate deploy
 *   - env vars set BEFORE AppModule dynamic import
 *   - four external-edge fakes overridden via .overrideProvider()
 */

import { execSync } from 'node:child_process';
import { join } from 'node:path';

// supertest is a CommonJS module
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
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-kyc-submit';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-kyc-submit-fake';
const WA_APP_SECRET = 'e2e-kyc-submit-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-kyc-submit';

// ===========================================================================
// THE TEST SUITE
// ===========================================================================

describe('KYC submit — e2e (AppModule, Testcontainers Postgres)', () => {
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
      WHATSAPP_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: WA_ACCESS_TOKEN,
      WHATSAPP_APP_SECRET: WA_APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: WA_VERIFY_TOKEN,
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-ks-directive-key-32bytes!!xxxx',
      RECEIPT_SIGNING_KEY: 'e2e-ks-receipt-signing-key-32b!!!!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-kyc-submit',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-ks',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-kyc-submit',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-kyc-submit',
      JWT_SECRET: 'e2e-kyc-submit-jwt-secret-at-least-32-bytes!!',
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
        address: 'TKycSubmitFakeWalletAddr123456789',
        providerReference: 'fake_blockradar_ref_kyc_submit_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-kyc-submit-stub',
        status: 'pending' as const,
      }),
      getWithdrawalStatus: jest
        .fn()
        .mockResolvedValue({ status: 'pending' as const }),
    };

    fakePaymentProvider = {
      createCollection: jest.fn().mockResolvedValue({
        accountNumber: '0091234567',
        bankName: 'KYC Submit Test MFB',
        providerRef: 'flw_fake_ref_kyc_submit_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_kyc_submit_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    fakeSender = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.ks.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.ks.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.ks.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.ks.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.ks.e2e' }),
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

  // ===========================================================================
  // MAIN TEST — full KYC submit happy path
  // ===========================================================================

  it('signup → verify-email → login → POST /kyc/submit → 200 { userId, status: verified } + DB asserts', async () => {
    const email = `e2e_ks_${Date.now()}@test.com`;

    // 1. Signup returns devToken (AUTH_DEV_EXPOSE_OTP=true)
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, phone: '+2348029999000' })
      .expect(202);
    const signupBody = signup.body as { status: string; devToken: string };
    expect(signupBody.status).toBe('pending_verification');
    const devToken = signupBody.devToken;
    expect(devToken).toBeDefined();

    // 2. Verify email
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: devToken })
      .expect(200)
      .expect((r) => expect(r.body).toEqual({ verified: true }));

    // 3. Login request returns devOtp
    const lr = await request(app.getHttpServer())
      .post('/auth/login/request')
      .send({ email })
      .expect(202);
    const lrBody = lr.body as { status: string; devOtp: string };
    const otp = lrBody.devOtp;
    expect(otp).toMatch(/^[0-9]{6}$/);

    // 4. Login verify returns accessToken
    const lv = await request(app.getHttpServer())
      .post('/auth/login/verify')
      .send({ email, otp, deviceFingerprint: 'e2e-ks-fingerprint-123' })
      .expect(200);
    const lvBody = lv.body as {
      accessToken: string;
      refreshToken: string;
      user: { email: string; id: string };
    };
    expect(lvBody.accessToken).toBeDefined();
    const { accessToken } = lvBody;

    // 5. POST /kyc/submit (authenticated)
    const ks = await request(app.getHttpServer())
      .post('/kyc/submit')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Chidi',
        lastName: 'Okeke',
        nin: '11223344556',
        pin: '5678',
      })
      .expect(200);

    const ksBody = ks.body as { userId: string; status: string };
    expect(ksBody.status).toBe('verified');
    expect(ksBody.userId).toBeDefined();
    expect(typeof ksBody.userId).toBe('string');

    const userId = ksBody.userId;

    // 6. DB assertions
    const dbUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.kycStatus).toBe('verified');
    expect(dbUser!.kycTier).toBe('tier_1');
    expect(dbUser!.pinHash).not.toBeNull();
    expect(dbUser!.status).toBe('active');

    const dbKycProfile = await prisma.kycProfile.findUnique({
      where: { userId },
    });
    expect(dbKycProfile).not.toBeNull();
    expect(dbKycProfile!.status).toBe('verified');
    expect(dbKycProfile!.tier).toBe('tier_1');
    expect(dbKycProfile!.firstName).toBe('Chidi');
    expect(dbKycProfile!.lastName).toBe('Okeke');
  }, 60_000);

  // ===========================================================================
  // UNAUTHENTICATED TEST — no Bearer token → 401
  // ===========================================================================

  it('POST /kyc/submit without Bearer token → 401', async () => {
    await request(app.getHttpServer())
      .post('/kyc/submit')
      .send({
        firstName: 'Chidi',
        lastName: 'Okeke',
        nin: '11223344556',
        pin: '5678',
      })
      .expect(401);
  }, 30_000);
});
