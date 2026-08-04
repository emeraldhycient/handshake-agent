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

import { mintTier1User } from './helpers/mint-verified-user';

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
    const fakePayment = {
      createCollection: jest.fn(),
      verify: jest.fn(),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      findPayoutByReference: jest.fn().mockResolvedValue(null),
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
    void phone; // legacy positional arg kept for the helper signature
    const { accessToken, userId } = await mintTier1User(app, {
      email,
      pin: '1357',
    });
    return { accessToken, userId };
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

  interface HistoryBody {
    window: { from: string; to: string; label: string };
    items: { id: string }[];
    totalCount: number;
    hasMore: boolean;
    nextCursor: string | null;
  }

  it('GET /transactions/history keyset-paginates with a stable cursor (no dup/skip)', async () => {
    const { accessToken, userId } = await onboard(
      `txpg_${Date.now()}@t.com`,
      '+2348020000009',
    );
    // 5 rows at distinct, recent timestamps so they fall in any "all" window.
    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      await seedTxn(userId, 'buy', new Date(base - i * 60_000));
    }
    const auth = `Bearer ${accessToken}`;
    const seen = new Set<string>();

    const p1 = await request(app.getHttpServer())
      .get('/transactions/history?period=all&limit=2')
      .set('Authorization', auth)
      .expect(200);
    const b1 = p1.body as HistoryBody;
    expect(b1.items).toHaveLength(2);
    expect(b1.totalCount).toBe(5);
    expect(b1.hasMore).toBe(true);
    expect(b1.nextCursor).toBeTruthy();
    b1.items.forEach((it) => seen.add(it.id));

    const win = `from=${encodeURIComponent(b1.window.from)}&to=${encodeURIComponent(b1.window.to)}&txType=all&limit=2`;

    const p2 = await request(app.getHttpServer())
      .get(
        `/transactions/history?${win}&cursor=${encodeURIComponent(b1.nextCursor!)}`,
      )
      .set('Authorization', auth)
      .expect(200);
    const b2 = p2.body as HistoryBody;
    expect(b2.items).toHaveLength(2);
    expect(b2.hasMore).toBe(true);
    expect(b2.totalCount).toBe(5); // full-window count, independent of the cursor
    b2.items.forEach((it) => {
      expect(seen.has(it.id)).toBe(false);
      seen.add(it.id);
    });

    const p3 = await request(app.getHttpServer())
      .get(
        `/transactions/history?${win}&cursor=${encodeURIComponent(b2.nextCursor!)}`,
      )
      .set('Authorization', auth)
      .expect(200);
    const b3 = p3.body as HistoryBody;
    expect(b3.items).toHaveLength(1);
    expect(b3.hasMore).toBe(false);
    expect(b3.nextCursor).toBeNull();
    b3.items.forEach((it) => seen.add(it.id));

    // Every row seen exactly once across the three pages.
    expect(seen.size).toBe(5);
  }, 120_000);

  it('GET /transactions/history resolves a relative-duration window', async () => {
    const { accessToken, userId } = await onboard(
      `txrel_${Date.now()}@t.com`,
      '+2348020000010',
    );
    // A row "now" falls inside any recent relative window.
    await seedTxn(userId, 'buy', new Date());

    const res = await request(app.getHttpServer())
      .get('/transactions/history?relativeAmount=2&relativeUnit=week')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const body = res.body as HistoryBody;
    expect(body.window.label).toBe('Last 2 weeks');
    expect(body.totalCount).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
