/**
 * Transaction-history — end-to-end (real AppModule + Testcontainers Postgres).
 *  - seed Transactions for a user, drive POST /chat/messages → transactions outcome
 *  - GET /transactions/history (JWT) returns the window + items; another user → empty
 *  - GET /transactions/statement/download?token=... → 200 application/pdf
 *  - tampered token → 401
 * Bootstrap mirrors web-chat.e2e-spec.ts (env set BEFORE AppModule import; fakes overridden).
 */
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// supertest is a CommonJS module
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

jest.setTimeout(180_000);
const API_ROOT = join(__dirname, '..');

describe('Transaction history — e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

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
    stop = async () => {
      await prisma.$disconnect();
      await container.stop();
    };

    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: dbUrl,
      WHATSAPP_PHONE_NUMBER_ID: 'test-pnid-e2e-txhist',
      WHATSAPP_ACCESS_TOKEN: 'e2e-wa-token-txhist',
      WHATSAPP_APP_SECRET: 'e2e-txhist-app-secret-123',
      WHATSAPP_VERIFY_TOKEN: 'e2e-txhist-verify',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-txhist-directive-key-32bytes!!x',
      RECEIPT_SIGNING_KEY: 'e2e-txhist-receipt-key-32bytes!!!!',
      STATEMENT_SIGNING_KEY: 'e2e-txhist-statement-key-32bytes!!',
      PUBLIC_API_BASE_URL: 'http://localhost:3001',
      BLOCKRADAR_API_KEY: 'fake-blockradar-txhist',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-txhist',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-txhist',
      JWT_SECRET: 'e2e-txhist-jwt-secret-at-least-32-bytes!!',
      AUTH_DEV_EXPOSE_OTP: 'true',
    });
    delete process.env.ANTHROPIC_API_KEY;

    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    const fakeLlm: jest.Mocked<LlmProvider> = {
      extractIntent: jest.fn().mockResolvedValue({
        action: 'query_transactions',
        period: 'all',
        download: true,
      }),
    };
    const noopSender = {
      sendText: jest.fn().mockResolvedValue({ externalMessageId: 'x' }),
      sendTemplate: jest.fn().mockResolvedValue({ externalMessageId: 'x' }),
      sendCtaUrl: jest.fn().mockResolvedValue({ externalMessageId: 'x' }),
      sendFlow: jest.fn().mockResolvedValue({ externalMessageId: 'x' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'x' }),
    };
    const fakeWallet = {
      provisionAddress: jest
        .fn()
        .mockResolvedValue({ address: 'Tfake', providerReference: 'r' }),
      getBalance: jest.fn().mockResolvedValue({ balances: [] }),
      withdraw: jest.fn(),
      getWithdrawalStatus: jest.fn(),
    };
    const fakePayment = {
      createCollection: jest.fn(),
      verify: jest.fn(),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER)
      .useValue(fakeLlm)
      .overrideProvider(WALLET_PROVIDER)
      .useValue(fakeWallet)
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(fakePayment)
      .overrideProvider(WHATSAPP_SENDER)
      .useValue(noopSender)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  }, 120_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await stop?.();
  });

  async function onboard(
    email: string,
    phone: string,
  ): Promise<{ accessToken: string; userId: string }> {
    const su = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, phone })
      .expect(202);
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: (su.body as { devToken: string }).devToken })
      .expect(200);
    const lr = await request(app.getHttpServer())
      .post('/auth/login/request')
      .send({ email })
      .expect(202);
    const lv = await request(app.getHttpServer())
      .post('/auth/login/verify')
      .send({
        email,
        otp: (lr.body as { devOtp: string }).devOtp,
        deviceFingerprint: `fp-${phone}`,
      })
      .expect(200);
    const accessToken = (lv.body as { accessToken: string }).accessToken;
    const ks = await request(app.getHttpServer())
      .post('/kyc/submit')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'A', lastName: 'B', nin: '22334455667', pin: '1234' })
      .expect(200);
    return { accessToken, userId: (ks.body as { userId: string }).userId };
  }

  async function seedTxn(
    userId: string,
    type: string,
    createdAt: Date,
  ): Promise<void> {
    await prisma.transaction.create({
      data: {
        userId,
        type: type as never,
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: 'chk',
        metadata: {
          asset: 'USDT',
          cryptoAmount: '10',
          fiatAmount: '16000',
          fiatCurrency: 'NGN',
        },
        createdAt,
      },
    });
  }

  it('POST /chat/messages → transactions outcome with a downloadUrl', async () => {
    const { accessToken, userId } = await onboard(
      `txh_${Date.now()}@t.com`,
      '+2348020000001',
    );
    await seedTxn(userId, 'buy', new Date('2026-06-10T10:00:00.000Z'));
    await seedTxn(userId, 'send', new Date('2026-06-12T10:00:00.000Z'));

    const chat = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'show my transactions' })
      .expect(200);

    const body = chat.body as {
      outcome: {
        kind: string;
        items: unknown[];
        totalCount: number;
        downloadUrl: string;
      };
    };
    expect(body.outcome.kind).toBe('transactions');
    expect(body.outcome.items.length).toBe(2);
    expect(body.outcome.totalCount).toBe(2);
    expect(body.outcome.downloadUrl).toContain(
      '/transactions/statement/download?token=',
    );
  }, 120_000);

  it('GET /transactions/history scopes to the user (other user → empty)', async () => {
    const a = await onboard(`txa_${Date.now()}@t.com`, '+2348020000002');
    await seedTxn(a.userId, 'buy', new Date('2026-06-10T10:00:00.000Z'));
    const b = await onboard(`txb_${Date.now()}@t.com`, '+2348020000003');

    const mine = await request(app.getHttpServer())
      .get('/transactions/history?period=all')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    expect(
      (mine.body as { totalCount: number }).totalCount,
    ).toBeGreaterThanOrEqual(1);

    const theirs = await request(app.getHttpServer())
      .get('/transactions/history?period=all')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    expect((theirs.body as { totalCount: number }).totalCount).toBe(0);
  }, 120_000);

  it('GET /transactions/statement/download streams a PDF; tampered token → 401', async () => {
    const { accessToken, userId } = await onboard(
      `txd_${Date.now()}@t.com`,
      '+2348020000004',
    );
    await seedTxn(userId, 'buy', new Date('2026-06-10T10:00:00.000Z'));

    const hist = await request(app.getHttpServer())
      .get('/transactions/history?period=all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const url = (hist.body as { downloadUrl: string }).downloadUrl;
    const token = new URL(url).searchParams.get('token')!;

    const pdf = await request(app.getHttpServer())
      .get(
        `/transactions/statement/download?token=${encodeURIComponent(token)}`,
      )
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((pdf.headers as Record<string, string>)['content-type']).toContain(
      'application/pdf',
    );
    const buf = pdf.body as Buffer;
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    await request(app.getHttpServer())
      .get(
        `/transactions/statement/download?token=${encodeURIComponent(token.slice(0, -2) + 'zz')}`,
      )
      .expect(401);
  }, 120_000);

  it('GET /transactions/:id still resolves (no route collision with /history)', async () => {
    const { accessToken } = await onboard(
      `txc_${Date.now()}@t.com`,
      '+2348020000005',
    );
    await request(app.getHttpServer())
      .get('/transactions/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404); // not found, NOT a history payload
  }, 120_000);
});
