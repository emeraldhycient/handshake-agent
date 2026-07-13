/**
 * Session-authenticated Sumsub token minting — end-to-end acceptance test
 * (task 3.4).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives
 * the tier-prerequisite ladder for POST /kyc/sumsub/token:
 *
 *   1. POST /auth/signup         → 202, devToken
 *   2. POST /auth/verify-email   → 200, { verified: true }
 *   3. POST /auth/login/request  → 202, devOtp
 *   4. POST /auth/login/verify   → 200, { accessToken }
 *   5. POST /kyc/submit (Bearer) → 200 — upgrades the account to tier_1
 *   6. POST /kyc/sumsub/token { level: 'tier_2' } (Bearer) → 200, { token, userId }
 *      — the deterministic MockKycProvider token/applicantId (KYC_MOCK_MODE
 *      defaults to 'true' — no env override needed), plus DB assertion that
 *      KycProfile.sumsubApplicantId was persisted and kycTier/kycStatus were
 *      NOT touched (the webhook, a later task, owns those transitions).
 *   7. POST /kyc/sumsub/token { level: 'tier_3' } (Bearer) → 403 — the account
 *      is still tier_1, so the tier_2 prerequisite for tier_3 is unmet.
 *
 * Plus: POST /kyc/sumsub/token without Bearer → 401.
 *
 * Bootstrap mirrors kyc-submit.e2e-spec.ts:
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
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-sumsub-token';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-sumsub-token-fake';
const WA_APP_SECRET = 'e2e-sumsub-token-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-sumsub-token';

// ===========================================================================
// THE TEST SUITE
// ===========================================================================

describe('KYC Sumsub token — e2e (AppModule, Testcontainers Postgres)', () => {
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
    //    KYC_MOCK_MODE is intentionally left unset — its schema default is
    //    'true', so MockKycProvider (deterministic token/applicantId) is the
    //    bound KYC_PROVIDER, exactly as the task brief requires.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: dbUrl,
      WHATSAPP_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: WA_ACCESS_TOKEN,
      WHATSAPP_APP_SECRET: WA_APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: WA_VERIFY_TOKEN,
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-st-directive-key-32bytes!!xxxx',
      RECEIPT_SIGNING_KEY: 'e2e-st-receipt-signing-key-32b!!!!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-sumsub-token',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-st',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-sumsub-token',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-sumsub-token',
      JWT_SECRET: 'e2e-sumsub-token-jwt-secret-at-least-32-bytes!!',
      AUTH_DEV_EXPOSE_OTP: 'true',
    });
    // Ensure ANTHROPIC_API_KEY is absent (not empty string) to pass optional validation
    delete process.env.ANTHROPIC_API_KEY;

    // 3. Dynamic import of AppModule (happens AFTER env vars are set above).
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
        address: 'TSumsubTokenFakeWalletAddr123456789',
        providerReference: 'fake_blockradar_ref_sumsub_token_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-sumsub-token-stub',
        status: 'pending' as const,
      }),
      getWithdrawalStatus: jest
        .fn()
        .mockResolvedValue({ status: 'pending' as const }),
      listWalletAssets: jest.fn().mockResolvedValue([
        {
          assetId: 'e2e-usdt-tron-asset-id',
          symbol: 'USDT',
          name: 'Tether USD',
          network: 'TRON',
          contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
          decimals: 6,
          isMainnet: false,
        },
      ]),
    };

    fakePaymentProvider = {
      createCollection: jest.fn().mockResolvedValue({
        accountNumber: '0091234567',
        bankName: 'Sumsub Token Test MFB',
        providerRef: 'flw_fake_ref_sumsub_token_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_sumsub_token_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    fakeSender = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.st.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.st.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.st.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.st.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.st.e2e' }),
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

  /**
   * Signs up + verifies + logs in a fresh user, returning their accessToken.
   * Each call uses a fresh email AND a fresh device fingerprint — User.pinnedDeviceId
   * is globally unique, so reusing one fingerprint across two different users in
   * the same suite would collide on device-bind (unrelated to this task).
   */
  async function signUpAndLogin(): Promise<string> {
    const unique = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const email = `e2e_st_${unique}@test.com`;

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, phone: '+2348029999001' })
      .expect(202);
    const signupBody = signup.body as { devToken: string };

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: signupBody.devToken })
      .expect(200);

    const lr = await request(app.getHttpServer())
      .post('/auth/login/request')
      .send({ email })
      .expect(202);
    const lrBody = lr.body as { devOtp: string };

    const lv = await request(app.getHttpServer())
      .post('/auth/login/verify')
      .send({
        email,
        otp: lrBody.devOtp,
        deviceFingerprint: `e2e-st-fingerprint-${unique}`,
      })
      .expect(200);
    const lvBody = lv.body as { accessToken: string };

    return lvBody.accessToken;
  }

  /** Upgrades the signed-in user to tier_1 via /kyc/submit. Returns their userId. */
  async function upgradeToTier1(accessToken: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/kyc/submit')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Tunde',
        lastName: 'Balogun',
        nin: '11223344557',
        pin: '1357',
      })
      .expect(200);
    return (res.body as { userId: string }).userId;
  }

  // ===========================================================================
  // MAIN TEST — tier_1 → tier_2 mint happy path + DB assertions
  // ===========================================================================

  it('tier_1 user: POST /kyc/sumsub/token { level: tier_2 } → 200 { token, userId }; persists applicantId; does not touch kycStatus/kycTier', async () => {
    const accessToken = await signUpAndLogin();
    const userId = await upgradeToTier1(accessToken);

    const res = await request(app.getHttpServer())
      .post('/kyc/sumsub/token')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ level: 'tier_2' })
      .expect(200);

    const body = res.body as { token: string; userId: string };
    expect(body.userId).toBe(userId);
    // MockKycProvider (KYC_MOCK_MODE default 'true') is deterministic.
    expect(body.token).toBe(`mock-${userId}-tier_2`);

    // DB: applicantId persisted, but kycStatus/kycTier untouched by this endpoint
    // — the Sumsub webhook (a later task) owns those transitions.
    const dbProfile = await prisma.kycProfile.findUnique({ where: { userId } });
    expect(dbProfile).not.toBeNull();
    expect(dbProfile!.sumsubApplicantId).toBe(`mock-app-${userId}`);
    expect(dbProfile!.status).toBe('verified'); // set by /kyc/submit, unchanged here
    expect(dbProfile!.tier).toBe('tier_1'); // set by /kyc/submit, unchanged here

    const dbUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(dbUser!.kycStatus).toBe('verified');
    expect(dbUser!.kycTier).toBe('tier_1');
  }, 60_000);

  // ===========================================================================
  // PREREQUISITE-UNMET TEST — tier_1 requesting tier_3 → 403
  // ===========================================================================

  it('tier_1 user: POST /kyc/sumsub/token { level: tier_3 } → 403 (needs tier_2 first)', async () => {
    const accessToken = await signUpAndLogin();
    await upgradeToTier1(accessToken);

    const res = await request(app.getHttpServer())
      .post('/kyc/sumsub/token')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ level: 'tier_3' })
      .expect(403);

    const body = res.body as { code?: string };
    expect(body.code).toBe('SUMSUB_PREREQUISITE_NOT_MET');
  }, 60_000);

  // ===========================================================================
  // UNAUTHENTICATED TEST — no Bearer token → 401
  // ===========================================================================

  it('POST /kyc/sumsub/token without Bearer token → 401', async () => {
    await request(app.getHttpServer())
      .post('/kyc/sumsub/token')
      .send({ level: 'tier_2' })
      .expect(401);
  }, 30_000);
});
