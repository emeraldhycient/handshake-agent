/**
 * Profile read end-to-end acceptance test (Task 4).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) and drives GET /profile:
 *   1. signup → verify-email → login → kyc/submit → accessToken
 *   2. GET /profile (Bearer) → 200 with email, fullName, phone, tier + limits
 *   3. GET /profile (no token) → 401
 *
 * Bootstrap mirrors wallet-reads.e2e-spec.ts.
 */

import { execSync } from 'node:child_process';
import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { INestApplication } from '@nestjs/common';

import { LLM_PROVIDER } from '../src/modules/agent/application/ports/agent.port';
import { WALLET_PROVIDER } from '../src/modules/wallets/application/ports/wallet-provider.port';
import { PAYMENT_PROVIDER } from '../src/modules/treasury/application/ports/payment-provider.port';
import { WHATSAPP_SENDER } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';
import type { LlmProvider } from '../src/modules/agent/core/ports/llm-provider.port';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';
import type { IWhatsAppSender } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';

jest.setTimeout(180_000);

const API_ROOT = join(__dirname, '..');
const SIGNUP_PHONE = '+2348099995678';

describe('Profile — e2e (GET /profile)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stopContainer: () => Promise<void>;

  beforeAll(async () => {
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

    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: dbUrl,
      WHATSAPP_PHONE_NUMBER_ID: 'test-pnid-e2e-profile',
      WHATSAPP_ACCESS_TOKEN: 'e2e-wa-access-token-profile-fake',
      WHATSAPP_APP_SECRET: 'e2e-profile-app-secret-123',
      WHATSAPP_VERIFY_TOKEN: 'e2e-verify-token-profile',
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-profile-directive-key-32bytes!',
      RECEIPT_SIGNING_KEY: 'e2e-profile-receipt-key-32bytes!!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-profile',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-profile',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-profile',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-profile',
      JWT_SECRET: 'e2e-profile-jwt-secret-at-least-32-bytes!!',
      AUTH_DEV_EXPOSE_OTP: 'true',
    });
    delete process.env.ANTHROPIC_API_KEY;

    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    const fakeLlmProvider: jest.Mocked<LlmProvider> = {
      extractIntent: jest.fn().mockResolvedValue({
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount: '5000',
        fiatCurrency: 'NGN',
      }),
    };
    const fakeWalletProvider: jest.Mocked<IWalletProvider> = {
      provisionAddress: jest.fn().mockResolvedValue({
        address: 'TPROFILEADDR...',
        providerReference: 'pr',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'stub',
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
    const fakePaymentProvider: jest.Mocked<IPaymentProvider> = {
      createCollection: jest.fn(),
      verify: jest.fn(),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };
    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.profile.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.profile.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.profile.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.profile.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.profile.e2e' }),
    };

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

  async function setupVerifiedUser(userEmail: string): Promise<string> {
    const deviceFingerprint = `e2e-profile-fp-${userEmail.slice(0, 16)}`;
    const su = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: userEmail, phone: SIGNUP_PHONE })
      .expect(202);
    const { devToken } = su.body as { devToken: string };
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: devToken })
      .expect(200);
    const lr = await request(app.getHttpServer())
      .post('/auth/login/request')
      .send({ email: userEmail })
      .expect(202);
    const { devOtp } = lr.body as { devOtp: string };
    const lv = await request(app.getHttpServer())
      .post('/auth/login/verify')
      .send({ email: userEmail, otp: devOtp, deviceFingerprint })
      .expect(200);
    const { accessToken } = lv.body as { accessToken: string };
    await request(app.getHttpServer())
      .post('/kyc/submit')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Eze',
        lastName: 'Nweke',
        nin: '12345678901',
        pin: '1357',
      })
      .expect(200);
    return accessToken;
  }

  it('signup → verify → login → kyc → GET /profile returns identity + tier limits', async () => {
    const email = `e2e_profile_${Date.now()}@test.com`;
    const accessToken = await setupVerifiedUser(email);

    const res = await request(app.getHttpServer())
      .get('/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const body = res.body as {
      email: string;
      fullName: string | null;
      phone: string | null;
      kycStatus: string;
      kycTier: string;
      fiatCurrency: string;
      limits: {
        perTxFiatMax: number;
        dailyFiatMax: number;
        dailyTxCountMax: number;
      } | null;
    };

    expect(body.email).toBe(email);
    expect(body.fullName).toBe('Eze Nweke');
    expect(body.kycStatus).toBe('verified');
    expect(body.kycTier).toBe('tier_1');
    expect(body.fiatCurrency).toBe('NGN');
    expect(body.limits).not.toBeNull();
    expect(body.limits?.dailyFiatMax).toBe(200000);
    expect(typeof body.phone === 'string' || body.phone === null).toBe(true);
  }, 120_000);

  it('GET /profile without a Bearer token → 401', async () => {
    await request(app.getHttpServer()).get('/profile').expect(401);
  });
});
