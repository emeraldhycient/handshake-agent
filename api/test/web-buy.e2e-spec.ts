/**
 * Web-buy end-to-end acceptance test (Task 3 / Phase 4).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives
 * the complete web authorize→execute→settle→status buy path:
 *
 *   1. signup → verify-email → login → kyc/submit → accessToken + userId
 *   2. POST /chat/messages (Bearer) { text: 'buy 5000 naira of usdt' }
 *      → outcome.kind === 'proposal', proposalId
 *   3. POST /chat/proposals/:proposalId/authorize → { directiveId, nonce, expiresAt }
 *   4. POST /chat/proposals/:proposalId/execute { directiveId, nonce, pin, idempotencyKey }
 *      → { transactionId, status: 'settling', payment }
 *   5. POST /webhooks/flutterwave { event: 'charge.completed', tx_ref: proposalId }
 *      → 200 { status: 'ok' }
 *   6. GET /transactions/:transactionId → { status: 'completed', receiptNumber, payment }
 *
 * Failure paths:
 *   - Wrong PIN on execute → 401
 *   - No Bearer on authorize / execute / GET → 401
 *
 * Bootstrap mirrors web-chat.e2e-spec.ts:
 *   - All process.env.* set BEFORE dynamic import() of AppModule
 *   - PostgreSqlContainer + prisma migrate deploy + PrismaClient via PrismaPg
 *   - Four provider overrides: LLM_PROVIDER, WALLET_PROVIDER, PAYMENT_PROVIDER, WHATSAPP_SENDER
 *   - app.listen(0) (via createNestApplication + rawBody:true) / afterAll closes
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
const FLUTTERWAVE_WEBHOOK_SECRET = 'e2e-flw-webhook-secret-web-buy';

const FAKE_WALLET_ADDRESS = 'TWebBuyFakeWalletAddr12345678xxx';
const FAKE_ACCOUNT_NUMBER = '0089876543';
const FAKE_BANK_NAME = 'Web Buy Test MFB';
const FAKE_FLW_REF = 'flw_fake_ref_web_buy_e2e_001';
const FAKE_BLOCKRADAR_REF = 'fake_blockradar_ref_web_buy_e2e';

// ===========================================================================
// THE TEST SUITE
// ===========================================================================

describe('Web buy — e2e (authorize → execute → settle → status)', () => {
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
      WHATSAPP_PHONE_NUMBER_ID: 'test-pnid-e2e-web-buy',
      WHATSAPP_ACCESS_TOKEN: 'e2e-wa-access-token-web-buy-fake',
      WHATSAPP_APP_SECRET: 'e2e-web-buy-app-secret-123',
      WHATSAPP_VERIFY_TOKEN: 'e2e-verify-token-web-buy',
      WHATSAPP_FLOW_PRIVATE_KEY: '',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-web-buy-directive-key-32bytes!',
      RECEIPT_SIGNING_KEY: 'e2e-web-buy-receipt-key-32bytes!!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-web-buy',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-web-buy',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-web-buy',
      FLUTTERWAVE_WEBHOOK_SECRET,
      JWT_SECRET: 'e2e-web-buy-jwt-secret-at-least-32-bytes!!',
      AUTH_DEV_EXPOSE_OTP: 'true',
    });
    // Ensure ANTHROPIC_API_KEY is absent (not empty string) to pass optional validation
    delete process.env.ANTHROPIC_API_KEY;

    // 3. Dynamic import of AppModule (happens AFTER env vars are set above).
    //    Deferring this import is essential: ConfigModule.forRoot() calls
    //    validateEnv() synchronously when the module file is first required.
    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    // 4. Build fake providers with correct interface shapes.
    //    The LLM fake returns buy_crypto — no real Anthropic API call.
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
        address: FAKE_WALLET_ADDRESS,
        providerReference: FAKE_BLOCKRADAR_REF,
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-stub',
        status: 'pending' as const,
      }),
      getWithdrawalStatus: jest
        .fn()
        .mockResolvedValue({ status: 'pending' as const }),
    };

    fakePaymentProvider = {
      createCollection: jest.fn().mockResolvedValue({
        accountNumber: FAKE_ACCOUNT_NUMBER,
        bankName: FAKE_BANK_NAME,
        providerRef: `va_${Date.now()}`,
        amount: '5000',
        currency: 'NGN',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: FAKE_FLW_REF,
      }),
      verifyWebhookSignature: jest
        .fn()
        .mockImplementation(
          (header: unknown) => header === FLUTTERWAVE_WEBHOOK_SECRET,
        ),
      createPayout: jest
        .fn()
        .mockResolvedValue({ providerRef: 'payout_fake_ref' }),
      verifyPayout: jest.fn().mockResolvedValue({
        status: 'successful',
        providerRef: FAKE_FLW_REF,
        amount: '5000',
        currency: 'NGN',
      }),
    };

    fakeSender = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.wb.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.wb.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.wb.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.wb.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.wb.e2e' }),
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
  // Helper: full signup → verify → login → kyc → accessToken
  // ---------------------------------------------------------------------------

  async function setupVerifiedUser(
    userEmail: string,
    pin = '1234',
  ): Promise<{ accessToken: string; userId: string }> {
    // Each user gets a unique fingerprint derived from the email to avoid
    // the unique constraint on pinnedDeviceId when multiple tests share the DB.
    const deviceFingerprint = `e2e-web-buy-fp-${userEmail.slice(0, 16)}`;

    // 1. Signup
    const su = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: userEmail, phone: '+2348099998888' })
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

    // 5. KYC submit (sets PIN)
    const ks = await request(app.getHttpServer())
      .post('/kyc/submit')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Eze', lastName: 'Nweke', nin: '12345678901', pin })
      .expect(200);
    const { userId } = ks.body as { userId: string; status: string };

    return { accessToken, userId };
  }

  // ===========================================================================
  // Test 1: No Bearer token → 401 on authorize, execute, GET
  // ===========================================================================

  it('no Bearer token → 401 on authorize, execute, GET transactions', async () => {
    await request(app.getHttpServer())
      .post('/chat/proposals/some-fake-uuid/authorize')
      .expect(401);

    await request(app.getHttpServer())
      .post('/chat/proposals/some-fake-uuid/execute')
      .send({
        directiveId: 'd',
        nonce: 'n',
        pin: '1234',
        idempotencyKey: randomUUID(),
      })
      .expect(401);

    await request(app.getHttpServer())
      .get('/transactions/some-fake-uuid')
      .expect(401);
  }, 30_000);

  // ===========================================================================
  // Test 2: Happy path — full buy → settle → status
  // ===========================================================================

  it('full buy: signup → chat → authorize → execute → webhook → GET /transactions → completed', async () => {
    const email = `e2e_wb_${Date.now()}@test.com`;
    const { accessToken, userId } = await setupVerifiedUser(email, '1234');

    // ── Step 1: POST /chat/messages → proposal outcome ──────────────────────
    const chatRes = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'buy 5000 naira of usdt' })
      .expect(200);

    const chatBody = chatRes.body as {
      reply: { text: string };
      outcome: { kind: string; proposalId: string };
      conversationId: string;
      messageId: string;
    };

    expect(chatBody.outcome.kind).toBe('proposal');
    expect(chatBody.outcome.proposalId).toBeTruthy();
    const { proposalId } = chatBody.outcome;

    // ── Step 2: POST /chat/proposals/:proposalId/authorize ───────────────────
    const authRes = await request(app.getHttpServer())
      .post(`/chat/proposals/${proposalId}/authorize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    const authBody = authRes.body as {
      directiveId: string;
      nonce: string;
      expiresAt: string;
    };
    expect(authBody.directiveId).toBeTruthy();
    expect(authBody.nonce).toBeTruthy();
    expect(authBody.expiresAt).toBeTruthy();
    const { directiveId, nonce } = authBody;

    // ── Step 3: POST /chat/proposals/:proposalId/execute ─────────────────────
    // I8: the server derives a STABLE idempotency key from proposalId and never
    // trusts this body value — so the provider reference (tx_ref) the webhook
    // echoes back is the proposalId, not this uuid.
    const idempotencyKey = randomUUID();

    const execRes = await request(app.getHttpServer())
      .post(`/chat/proposals/${proposalId}/execute`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ directiveId, nonce, pin: '1234', idempotencyKey })
      .expect(201);

    const execBody = execRes.body as {
      transactionId: string;
      status: string;
      payment: {
        accountNumber: string;
        bankName: string;
        providerRef: string;
      };
    };

    expect(execBody.status).toBe('settling');
    expect(execBody.transactionId).toBeTruthy();
    expect(execBody.payment).toBeDefined();
    expect(execBody.payment.accountNumber).toBe(FAKE_ACCOUNT_NUMBER);
    expect(execBody.payment.bankName).toBe(FAKE_BANK_NAME);

    const { transactionId } = execBody;

    // ── Step 4: POST /webhooks/flutterwave (payment settled) ─────────────────
    // tx_ref = the engine's stable reference (= proposalId, I8) — that is what
    // createCollection was given and what settleBuyPayment looks the txn up by.
    const flwBody = {
      event: 'charge.completed',
      data: {
        status: 'successful',
        tx_ref: proposalId,
        amount: 5000,
        currency: 'NGN',
        flw_ref: FAKE_FLW_REF,
        customer: {
          email: `user+${userId}@handshake.internal`,
          name: 'E2E Web Buy User',
        },
      },
    };

    const flwRes = await request(app.getHttpServer())
      .post('/webhooks/flutterwave')
      .set('verif-hash', FLUTTERWAVE_WEBHOOK_SECRET)
      .send(flwBody)
      .expect(200);

    expect(flwRes.body).toEqual({ status: 'ok' });

    // ── Step 5: GET /transactions/:transactionId → completed ─────────────────
    const statusRes = await request(app.getHttpServer())
      .get(`/transactions/${transactionId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const statusBody = statusRes.body as {
      id: string;
      type: string;
      status: string;
      receiptNumber?: string;
      payment?: {
        accountNumber: string;
        bankName: string;
        providerRef: string;
        amount: string;
        currency: string;
      };
      createdAt: string;
    };

    expect(statusBody.id).toBe(transactionId);
    expect(statusBody.status).toBe('completed');
    expect(statusBody.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);
    expect(statusBody.payment).toBeDefined();
    expect(statusBody.payment!.accountNumber).toBe(FAKE_ACCOUNT_NUMBER);

    // ── DB assertions ────────────────────────────────────────────────────────
    const dbTxn = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    expect(dbTxn).not.toBeNull();
    expect(dbTxn!.status).toBe('completed');
    expect(dbTxn!.completedAt).not.toBeNull();

    const dbReceipt = await prisma.receipt.findUnique({
      where: { transactionId },
    });
    expect(dbReceipt).not.toBeNull();
    expect(dbReceipt!.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);
    expect(dbReceipt!.userId).toBe(userId);
  }, 120_000);

  // ===========================================================================
  // Test 3: Wrong PIN → 401 on execute
  // ===========================================================================

  it('wrong PIN on execute → 401', async () => {
    const email = `e2e_wb_wrongpin_${Date.now()}@test.com`;
    const { accessToken } = await setupVerifiedUser(email, '1234');

    // Create a proposal via chat
    const chatRes = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'buy 5000 naira of usdt' })
      .expect(200);

    const { outcome } = chatRes.body as {
      outcome: { kind: string; proposalId: string };
    };
    expect(outcome.kind).toBe('proposal');
    const { proposalId } = outcome;

    // Authorize
    const authRes = await request(app.getHttpServer())
      .post(`/chat/proposals/${proposalId}/authorize`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    const { directiveId, nonce } = authRes.body as {
      directiveId: string;
      nonce: string;
      expiresAt: string;
    };

    // Execute with WRONG PIN → 401
    await request(app.getHttpServer())
      .post(`/chat/proposals/${proposalId}/execute`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        directiveId,
        nonce,
        pin: '9999',
        idempotencyKey: randomUUID(),
      })
      .expect(401);
  }, 120_000);
});
