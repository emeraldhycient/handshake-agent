/**
 * Web chat endpoint — end-to-end acceptance test.
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives:
 *
 *   1. POST /auth/signup         → 202, devToken
 *   2. POST /auth/verify-email   → 200, { verified: true }
 *   3. POST /auth/login/request  → 202, devOtp
 *   4. POST /auth/login/verify   → 200, { accessToken }
 *   5. POST /kyc/submit (Bearer) → 200, { userId, status: 'verified' }
 *   6. POST /chat/messages (Bearer) { text: 'receive USDT' }
 *      → 200, body.outcome.kind === 'receive', body.outcome.deposit.address exists
 *
 * Plus: POST /chat/messages without Bearer → 401.
 *
 * Bootstrap mirrors kyc-submit.e2e-spec.ts:
 *   - Testcontainers Postgres + prisma migrate deploy
 *   - env vars set BEFORE AppModule dynamic import
 *   - four external-edge fakes overridden via .overrideProvider()
 *   - LLM_PROVIDER fake returns receive_crypto intent (no real Anthropic call)
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
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-web-chat';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-web-chat-fake';
const WA_APP_SECRET = 'e2e-web-chat-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-web-chat';

// ===========================================================================
// THE TEST SUITE
// ===========================================================================

describe('Web chat — e2e (AppModule, Testcontainers Postgres)', () => {
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
      DIRECTIVE_SIGNING_KEY: 'e2e-wc-directive-key-32bytes!!xxxx',
      RECEIPT_SIGNING_KEY: 'e2e-wc-receipt-signing-key-32b!!!!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-web-chat',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-wc',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-web-chat',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-web-chat',
      JWT_SECRET: 'e2e-web-chat-jwt-secret-at-least-32-bytes!!',
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
    //    The LLM fake returns receive_crypto — no real Anthropic API call.
    fakeLlmProvider = {
      extractIntent: jest.fn().mockResolvedValue({
        action: 'receive_crypto',
        asset: 'USDT',
        network: 'TRON',
      }),
    };

    // Unique address per call — the wallet table has a UNIQUE(address) constraint,
    // so a constant address would collide once a second user provisions a wallet.
    let addrCounter = 0;
    fakeWalletProvider = {
      provisionAddress: jest.fn().mockImplementation(() => {
        addrCounter += 1;
        return Promise.resolve({
          address: `TWebChatFakeAddr${addrCounter}`,
          providerReference: `fake-ref-web-chat-${addrCounter}`,
        });
      }),
      getBalance: jest.fn().mockResolvedValue({ balances: [] }),
      withdraw: jest.fn().mockResolvedValue({
        txHash: 'fake-hash',
        reference: 'ref',
      }),
      getWithdrawalStatus: jest.fn().mockResolvedValue({
        status: 'confirmed',
        txHash: 'fake-hash',
      }),
    };

    fakePaymentProvider = {
      createCollection: jest.fn().mockResolvedValue({
        accountNumber: '0091234568',
        bankName: 'Web Chat Test MFB',
        providerRef: 'flw_fake_ref_web_chat_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_web_chat_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    fakeSender = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.wc.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.wc.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.wc.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.wc.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.wc.e2e' }),
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
  // UNAUTHENTICATED TEST — no Bearer token → 401
  // ===========================================================================

  it('POST /chat/messages without Bearer token → 401', async () => {
    await request(app.getHttpServer())
      .post('/chat/messages')
      .send({ text: 'hello' })
      .expect(401);
  }, 30_000);

  // ===========================================================================
  // HAPPY PATH — receive_crypto (full flow)
  // ===========================================================================

  it('signup → verify-email → login → kyc/submit → POST /chat/messages → 200 receive outcome', async () => {
    const email = `e2e_wc_${Date.now()}@test.com`;

    // 1. Signup returns devToken (AUTH_DEV_EXPOSE_OTP=true)
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, phone: '+2348029999001' })
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
      .send({ email, otp, deviceFingerprint: 'e2e-wc-fingerprint-123' })
      .expect(200);
    const lvBody = lv.body as {
      accessToken: string;
      refreshToken: string;
      user: { email: string; id: string };
    };
    expect(lvBody.accessToken).toBeDefined();
    const { accessToken } = lvBody;

    // 5. POST /kyc/submit (authenticated) → get kycStatus=verified
    const ks = await request(app.getHttpServer())
      .post('/kyc/submit')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Adaeze',
        lastName: 'Okonkwo',
        nin: '22334455667',
        pin: '1234',
      })
      .expect(200);
    const ksBody = ks.body as { userId: string; status: string };
    expect(ksBody.status).toBe('verified');

    // 6. POST /chat/messages → agent returns receive_crypto → outcome.kind === 'receive'
    const chat = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'receive USDT' })
      .expect(200);

    const chatBody = chat.body as {
      reply: { text: string };
      outcome: {
        kind: string;
        deposit?: { address: string; asset: string; network: string };
      };
      conversationId: string;
      messageId: string;
    };

    expect(chatBody.outcome.kind).toBe('receive');
    expect(chatBody.outcome.deposit).toBeDefined();
    expect(chatBody.outcome.deposit!.address).toBeTruthy();
    expect(chatBody.conversationId).toBeDefined();
    expect(chatBody.messageId).toBeDefined();
    expect(chatBody.reply.text).toContain(chatBody.outcome.deposit!.address);

    // DB assertions: conversation and message were persisted
    const dbConversation = await prisma.conversation.findFirst({
      where: { userId: ksBody.userId },
    });
    expect(dbConversation).not.toBeNull();

    const dbMessage = await prisma.conversationMessage.findFirst({
      where: { conversationId: dbConversation!.id },
    });
    expect(dbMessage).not.toBeNull();
    expect(dbMessage!.channel).toBe('web');
    expect(dbMessage!.text).toBe('receive USDT');
  }, 120_000);

  // ===========================================================================
  // KYC-FAILURE PATH — user with no KYC → outcome.kind === 'needs_kyc'
  // ===========================================================================

  it('signup → verify-email → login (no KYC) → POST /chat/messages → 200 needs_kyc outcome', async () => {
    // Use a distinct email to avoid state collision with the happy-path test above.
    const email = `unverified_chat_${Date.now()}@test.com`;

    // 1. Signup
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, phone: '+2348029999002' })
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

    // 3. Login request
    const lr = await request(app.getHttpServer())
      .post('/auth/login/request')
      .send({ email })
      .expect(202);
    const lrBody = lr.body as { status: string; devOtp: string };
    const otp = lrBody.devOtp;
    expect(otp).toMatch(/^[0-9]{6}$/);

    // 4. Login verify → accessToken (NO KYC submit step)
    const lv = await request(app.getHttpServer())
      .post('/auth/login/verify')
      .send({ email, otp, deviceFingerprint: 'e2e-wc-unverified-fingerprint' })
      .expect(200);
    const lvBody = lv.body as { accessToken: string };
    expect(lvBody.accessToken).toBeDefined();
    const { accessToken } = lvBody;

    // 5. POST /chat/messages — LLM fake returns receive_crypto which requires KYC.
    //    Without KYC, the service short-circuits to needs_kyc.
    const chat = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'receive USDT' })
      .expect(200);

    const chatBody = chat.body as {
      reply: { text: string };
      outcome: { kind: string };
      conversationId: string;
      messageId: string;
    };

    expect(chatBody.outcome.kind).toBe('needs_kyc');
    expect(chatBody.conversationId).toBeDefined();
    expect(chatBody.messageId).toBeDefined();
  }, 120_000);

  // ===========================================================================
  // I1/I2 — domain/agent errors map to a clean status, never an opaque 500
  // ===========================================================================

  /** signup → verify → login → kyc; returns a Bearer token for a verified user. */
  async function authVerifiedUser(opts: {
    email: string;
    phone: string;
    nin: string;
  }): Promise<string> {
    const { email, phone, nin } = opts;
    const su = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, phone })
      .expect(202);
    const devToken = (su.body as { devToken: string }).devToken;
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: devToken })
      .expect(200);
    const lr = await request(app.getHttpServer())
      .post('/auth/login/request')
      .send({ email })
      .expect(202);
    const otp = (lr.body as { devOtp: string }).devOtp;
    const lv = await request(app.getHttpServer())
      .post('/auth/login/verify')
      .send({ email, otp, deviceFingerprint: `fp-${email}` })
      .expect(200);
    const accessToken = (lv.body as { accessToken: string }).accessToken;
    await request(app.getHttpServer())
      .post('/kyc/submit')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Test', lastName: 'User', nin, pin: '1234' })
      .expect(200);
    return accessToken;
  }

  it('POST /chat/messages → agent/LLM failure → 503 with a clean message (NOT an opaque 500)', async () => {
    const token = await authVerifiedUser({
      email: `agentfail_${Date.now()}@test.com`,
      phone: '+2348029999010',
      nin: '22334455710',
    });

    // The agent call throws this turn (provider overloaded). The raw error — which
    // here carries a fake secret — must NOT reach the client.
    fakeLlmProvider.extractIntent.mockRejectedValueOnce(
      new Error('anthropic 529 overloaded — apikey sk-secret-leak'),
    );

    const res = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'buy 5 USDT' })
      .expect(503);

    const body = res.body as { statusCode: number; message: string };
    expect(body.statusCode).toBe(503);
    expect(body.message).toMatch(/temporarily unavailable/i);
    // No internal leakage of the underlying provider error.
    expect(JSON.stringify(body)).not.toMatch(/anthropic|sk-secret-leak|529/);
  }, 60_000);

  it('POST /chat/messages → sell with zero balance → 422 (InsufficientBalanceError mapped, NOT 500)', async () => {
    const token = await authVerifiedUser({
      email: `sellpoor_${Date.now()}@test.com`,
      phone: '+2348029999011',
      nin: '22334455711',
    });

    // Agent returns a sell intent this turn; the user has zero USDT, so the
    // proposal builder raises InsufficientBalanceError inside /chat/messages.
    fakeLlmProvider.extractIntent.mockResolvedValueOnce({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '5',
      fiatCurrency: 'NGN',
    });

    const res = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        text: 'sell 5 USDT',
        beneficiaryId: '11111111-1111-1111-1111-111111111111',
      })
      .expect(422);

    const body = res.body as { statusCode: number; message: string };
    expect(body.statusCode).toBe(422);
    expect(body.message).toBe('Insufficient balance for this transaction.');
    // The raw domain message reveals exact balances — it must not be exposed.
    expect(JSON.stringify(body)).not.toContain('have 0');
  }, 60_000);
});
