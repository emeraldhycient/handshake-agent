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
import { mintTier1User } from './helpers/mint-verified-user';
import type { LlmProvider } from '../src/modules/agent/core/ports/llm-provider.port';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';
import type { IWhatsAppSender } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';

jest.setTimeout(180_000);

const API_ROOT = join(__dirname, '..');

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
      findPayoutByReference: jest.fn().mockResolvedValue(null),
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
    const { accessToken } = await mintTier1User(app, {
      email: userEmail,
      pin: '1357',
    });
    // The retired /kyc/submit captured the display name; on the new path the
    // pre-KYC name is set via POST /profile/name (writable while not_started).
    await request(app.getHttpServer())
      .post('/profile/name')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Eze', lastName: 'Nweke' })
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
        dailyFiatUsed: number;
        dailyTxCountUsed: number;
      } | null;
      memberSince: string | null;
      security: { score: number; label: string };
    };

    expect(body.email).toBe(email);
    expect(body.fullName).toBe('Eze Nweke');
    // New onboarding path: email-OTP grants tier_1 with kycStatus still
    // 'not_started' (full KYC is a later Sumsub step) — not 'verified'.
    expect(body.kycStatus).toBe('not_started');
    expect(body.kycTier).toBe('tier_1');
    expect(body.fiatCurrency).toBe('NGN');
    expect(body.limits).not.toBeNull();
    expect(body.limits?.dailyFiatMax).toBe(200000);
    // Live membership data: usage folded into limits (0 with no settled tx),
    // memberSince is the account-creation ISO, security is a real 0..4 score.
    expect(body.limits?.dailyFiatUsed).toBe(0);
    expect(body.limits?.dailyTxCountUsed).toBe(0);
    expect(typeof body.memberSince).toBe('string');
    expect(Number.isNaN(Date.parse(body.memberSince as string))).toBe(false);
    expect(body.security.score).toBeGreaterThanOrEqual(0);
    expect(body.security.score).toBeLessThanOrEqual(4);
    expect(['weak', 'fair', 'good', 'strong']).toContain(body.security.label);
    expect(typeof body.phone === 'string' || body.phone === null).toBe(true);
  }, 120_000);

  it('GET /profile without a Bearer token → 401', async () => {
    await request(app.getHttpServer()).get('/profile').expect(401);
  });
});

describe('Profile — e2e (POST /profile/name)', () => {
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
      WHATSAPP_PHONE_NUMBER_ID: 'test-pnid-e2e-profile-name',
      WHATSAPP_ACCESS_TOKEN: 'e2e-wa-access-token-profile-name-fake',
      WHATSAPP_APP_SECRET: 'e2e-profile-name-app-secret-123',
      WHATSAPP_VERIFY_TOKEN: 'e2e-verify-token-profile-name',
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-profile-name-directive-key-32byte',
      RECEIPT_SIGNING_KEY: 'e2e-profile-name-receipt-key-32bytes',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-profile-name',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-profile-name',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-profile-name',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-profile-name',
      JWT_SECRET: 'e2e-profile-name-jwt-secret-at-least-32-bytes!!',
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
        address: 'TPROFILENAMEADDR...',
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
      findPayoutByReference: jest.fn().mockResolvedValue(null),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };
    const fakeSender: jest.Mocked<IWhatsAppSender> = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.profile.name.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.profile.name.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.profile.name.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.profile.name.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.profile.name.e2e' }),
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

  /** email-OTP signup → a tier_1 session with NO KycProfile / PIN yet. */
  async function setupTier1UserWithNoKycProfile(
    userEmail: string,
  ): Promise<string> {
    const { accessToken } = await mintTier1User(app, { email: userEmail });
    return accessToken;
  }

  it('tier_1 user with no KycProfile: POST creates it, GET /auth/me reflects it, re-POST updates it', async () => {
    const email = `e2e_profile_name_${Date.now()}@test.com`;
    const accessToken = await setupTier1UserWithNoKycProfile(email);

    // Confirm the precondition: no KycProfile yet (fullName null on /profile).
    const before = await request(app.getHttpServer())
      .get('/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect((before.body as { fullName: string | null }).fullName).toBeNull();

    const create = await request(app.getHttpServer())
      .post('/profile/name')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Ada', lastName: 'Obi' })
      .expect(200);
    expect(create.body).toEqual({ firstName: 'Ada', lastName: 'Obi' });

    const meAfterCreate = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(
      (meAfterCreate.body as { firstName: string; lastName: string }).firstName,
    ).toBe('Ada');
    expect(
      (meAfterCreate.body as { firstName: string; lastName: string }).lastName,
    ).toBe('Obi');

    // Idempotent re-post updates the existing KycProfile row (no duplicate).
    const update = await request(app.getHttpServer())
      .post('/profile/name')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Adaeze', lastName: 'Obiora' })
      .expect(200);
    expect(update.body).toEqual({ firstName: 'Adaeze', lastName: 'Obiora' });

    const meAfterUpdate = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(
      (meAfterUpdate.body as { firstName: string; lastName: string }).firstName,
    ).toBe('Adaeze');
    expect(
      (meAfterUpdate.body as { firstName: string; lastName: string }).lastName,
    ).toBe('Obiora');
  }, 120_000);

  it('POST /profile/name without a Bearer token → 401', async () => {
    await request(app.getHttpServer())
      .post('/profile/name')
      .send({ firstName: 'Ada', lastName: 'Obi' })
      .expect(401);
  });

  it('POST /profile/name with an empty firstName → 400 (validation, not a partial write)', async () => {
    const email = `e2e_profile_name_invalid_${Date.now()}@test.com`;
    const accessToken = await setupTier1UserWithNoKycProfile(email);

    await request(app.getHttpServer())
      .post('/profile/name')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: '', lastName: 'Obi' })
      .expect(400);
  }, 120_000);

  /**
   * Critical-review fix: the KYC-verified name is relied on as the immutable
   * FATF Travel-Rule originator identity — POST /profile/name is pre-KYC name
   * capture ONLY. A verified user (or anyone holding their session) attempting
   * to overwrite it must be rejected 409, and the stored name must be
   * unchanged.
   */
  it('a KYC-verified user posting /profile/name → 409, stored name unchanged', async () => {
    const email = `e2e_profile_name_verified_${Date.now()}@test.com`;
    const { accessToken, userId } = await mintTier1User(app, {
      email,
      pin: '1357',
    });

    // Capture the pre-KYC name while it is still writable (kycStatus
    // 'not_started'), then simulate a completed KYC verification by seeding
    // kycStatus='verified' directly — the new-onboarding equivalent of the
    // state the retired /kyc/submit produced, which makes the name the
    // immutable Travel-Rule originator identity. Direct kycStatus seeding is
    // the established e2e pattern across the money-path suites.
    await request(app.getHttpServer())
      .post('/profile/name')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Eze', lastName: 'Nweke' })
      .expect(200);
    await prisma.user.update({
      where: { id: userId },
      data: { kycStatus: 'verified', kycTier: 'tier_2' },
    });

    // Precondition: KYC verification has started (kycStatus=verified).
    const before = await request(app.getHttpServer())
      .get('/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect((before.body as { kycStatus: string }).kycStatus).toBe('verified');
    expect((before.body as { fullName: string | null }).fullName).toBe(
      'Eze Nweke',
    );

    await request(app.getHttpServer())
      .post('/profile/name')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Spoofed', lastName: 'Originator' })
      .expect(409);

    // The stored (verified) name must be unchanged — no partial/silent write.
    const after = await request(app.getHttpServer())
      .get('/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect((after.body as { fullName: string | null }).fullName).toBe(
      'Eze Nweke',
    );
  }, 120_000);
});
