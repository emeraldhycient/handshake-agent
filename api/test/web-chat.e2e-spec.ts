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

import { mintTier1User } from './helpers/mint-verified-user';

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

    // Unique address per call — multiple users provision wallets across the
    // history tests, so a fixed address would violate the wallet unique constraint.
    let addrSeq = 0;
    fakeWalletProvider = {
      provisionAddress: jest.fn().mockImplementation(() => {
        addrSeq += 1;
        return Promise.resolve({
          address: `TWebChatFakeAddr${addrSeq.toString().padStart(8, '0')}`,
          providerReference: `fake-ref-web-chat-${addrSeq}`,
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

  it('mint tier_1 user → POST /chat/messages → 200 receive outcome', async () => {
    const email = `e2e_wc_${Date.now()}@test.com`;

    // Mint a verified tier_1 user (email-OTP signup → tier_1 + PIN).
    const { accessToken, userId } = await mintTier1User(app, {
      email,
      pin: '1357',
    });

    // The onboarding model grants kycTier='tier_1' on email-OTP verification —
    // the capability gate is tier-based now, not a kycStatus flag.
    const minted = await prisma.user.findUnique({ where: { id: userId } });
    expect(minted!.kycTier).toBe('tier_1');

    // POST /chat/messages → agent returns receive_crypto → outcome.kind === 'receive'
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
      where: { userId },
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
  // CAPABILITY → MINIMUM-TIER GATE — email-verified-only (tier_1) user
  // ===========================================================================
  //
  // Task 4.2b regression coverage: the onboarding model grants kycTier='tier_1'
  // on EMAIL verification alone, WITHOUT setting kycStatus='verified' (reserved
  // for full Sumsub KYC — no /kyc/submit step below). The chat-entry gate must
  // key off capability→kycTier, matching KycGateService, not a stale
  // kycStatus==='verified' check: a tier_1 user gets a buy/receive proposal
  // (previously — the bug — a false needs_kyc), while sell/send/swap (tier_2)
  // still correctly needs_kyc.

  it('signup → verify-email → login (email-verified only, tier_1) → receive succeeds, send needs_kyc', async () => {
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

    // 2. Verify email — grants kycTier='tier_1' (kycStatus stays NOT 'verified').
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

    // 4. Login verify → accessToken (NO KYC submit step — stays tier_1)
    const lv = await request(app.getHttpServer())
      .post('/auth/login/verify')
      .send({ email, otp, deviceFingerprint: 'e2e-wc-unverified-fingerprint' })
      .expect(200);
    const lvBody = lv.body as { accessToken: string };
    expect(lvBody.accessToken).toBeDefined();
    const { accessToken } = lvBody;

    // 5. POST /chat/messages — receive_crypto only requires tier_1 → succeeds.
    //    This is the exact scenario the bug produced a false needs_kyc for.
    const receiveChat = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'receive USDT' })
      .expect(200);

    const receiveBody = receiveChat.body as {
      reply: { text: string };
      outcome: { kind: string };
      conversationId: string;
      messageId: string;
    };

    expect(receiveBody.outcome.kind).toBe('receive');
    expect(receiveBody.conversationId).toBeDefined();
    expect(receiveBody.messageId).toBeDefined();

    // 6. POST /chat/messages — send_crypto requires tier_2 → still needs_kyc.
    //    (No destination address in the intent — §3.1: the NLU layer never
    //    extracts one; it is resolved server-side from a saved beneficiary.)
    fakeLlmProvider.extractIntent.mockResolvedValueOnce({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '2',
      network: 'TRON',
    });

    const sendChat = await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'send 2 USDT' })
      .expect(200);

    const sendBody = sendChat.body as { outcome: { kind: string } };
    expect(sendBody.outcome.kind).toBe('needs_kyc');
  }, 120_000);

  // ===========================================================================
  // I1/I2 — domain/agent errors map to a clean status, never an opaque 500
  // ===========================================================================

  /**
   * Mints a verified tier_1 user (email-OTP signup → tier_1 + PIN) and returns a
   * Bearer token + userId. The onboarding model only ever grants tier_1 here —
   * tier_2+ comes exclusively through the Sumsub webhook flow (exercised in
   * sumsub-webhook.e2e-spec.ts). Callers that need a tier_2 capability
   * (sell/send/swap) must bump kycTier themselves — see the sell test below,
   * which mirrors the direct-DB-seed pattern in sell-vertical.e2e-spec.ts.
   */
  async function authVerifiedUser(opts: {
    email: string;
    phone: string;
    nin: string;
  }): Promise<{ accessToken: string; userId: string }> {
    const { accessToken, userId } = await mintTier1User(app, {
      email: opts.email,
      pin: '1357',
    });
    return { accessToken, userId };
  }

  it('POST /chat/messages → agent/LLM failure → 503 with a clean message (NOT an opaque 500)', async () => {
    const { accessToken: token } = await authVerifiedUser({
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

  it('POST /chat/messages → sell with zero balance → in-chat clarification (parity with swap, NOT a 422/500)', async () => {
    const { accessToken: token, userId } = await authVerifiedUser({
      email: `sellpoor_${Date.now()}@test.com`,
      phone: '+2348029999011',
      nin: '22334455711',
    });

    // crypto.sell is gated to tier_2 (root CLAUDE.md §3.3/Task 1.2/1.3); the
    // mock /kyc/submit provider only ever grants tier_1 (a real tier_2 upgrade
    // goes through the Sumsub webhook flow — sumsub-webhook.e2e-spec.ts).
    // Bump directly, mirroring the tier_2 fixture pattern in
    // sell-vertical.e2e-spec.ts, so this test can reach the proposal-builder
    // error it actually exercises rather than the (separately covered) gate.
    await prisma.user.update({
      where: { id: userId },
      data: { kycTier: 'tier_2' },
    });

    // Agent returns a sell intent this turn; the user has zero USDT. Sell/send
    // proposal errors are now first-class chat clarifications (parity with swap) —
    // the user gets a helpful message in-thread, never an opaque HTTP error.
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
      .expect(200);

    const body = res.body as {
      reply: { text: string };
      outcome: { kind: string };
    };
    expect(body.outcome.kind).toBe('clarification');
    expect(body.reply.text).toMatch(/enough balance/i);
    // The raw domain message reveals exact balances — it must not be exposed.
    expect(JSON.stringify(body)).not.toContain('have 0');
  }, 60_000);

  // ===========================================================================
  // CHAT HISTORY — GET /chat/messages
  // ===========================================================================

  // Mint a verified tier_1 user (email-OTP signup → tier_1 + PIN); returns a
  // Bearer token + userId.
  let userSeq = 5000;
  async function registerVerifiedUser(
    prefix: string,
  ): Promise<{ accessToken: string; userId: string }> {
    const n = userSeq++;
    const email = `${prefix}_${n}_${Date.now()}@test.com`;
    const { accessToken, userId } = await mintTier1User(app, {
      email,
      pin: '1357',
    });
    return { accessToken, userId };
  }

  it('GET /chat/messages without Bearer token → 401', async () => {
    await request(app.getHttpServer()).get('/chat/messages').expect(401);
  }, 30_000);

  it('returns an empty history for a verified user who has not chatted', async () => {
    const { accessToken } = await registerVerifiedUser('hist_empty');

    const res = await request(app.getHttpServer())
      .get('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toEqual({
      conversationId: null,
      messages: [],
      nextCursor: null,
      hasMore: false,
    });
  }, 120_000);

  it('reconstructs the thread oldest→newest with persisted outcomes', async () => {
    const { accessToken } = await registerVerifiedUser('hist_thread');

    // Turn 1 — default LLM fake → receive_crypto → receive outcome.
    await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'receive USDT' })
      .expect(200);

    // Turn 2 — reconfigure the LLM fake for the next call only → clarification.
    fakeLlmProvider.extractIntent.mockResolvedValueOnce({
      action: 'none',
      clarification: 'Did you mean buy or sell?',
    } as never);
    await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'do a thing' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const body = res.body as {
      conversationId: string | null;
      hasMore: boolean;
      nextCursor: string | null;
      messages: Array<{
        messageId: string;
        userText: string;
        createdAt: string;
        outcome: {
          kind: string;
          deposit?: { address: string };
          text?: string;
        } | null;
      }>;
    };

    expect(body.conversationId).toBeTruthy();
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
    expect(body.messages).toHaveLength(2);

    // Oldest first.
    expect(body.messages[0].userText).toBe('receive USDT');
    expect(body.messages[0].outcome?.kind).toBe('receive');
    expect(body.messages[0].outcome?.deposit?.address).toBeTruthy();

    expect(body.messages[1].userText).toBe('do a thing');
    expect(body.messages[1].outcome?.kind).toBe('clarification');
    expect(body.messages[1].outcome?.text).toBe('Did you mean buy or sell?');

    // The reply row physically carries the rendered outcome JSON.
    const replies = await prisma.conversationReply.findMany({
      where: { conversationId: body.conversationId! },
    });
    expect(replies.length).toBeGreaterThanOrEqual(2);
    expect(replies.every((r) => r.outcome !== null)).toBe(true);
  }, 120_000);

  it('paginates with ?limit and ?before (newest page first, then older)', async () => {
    const { accessToken } = await registerVerifiedUser('hist_page');

    await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'first message' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'second message' })
      .expect(200);

    // First page (limit 1) → newest turn only, with a cursor to older turns.
    const page1 = await request(app.getHttpServer())
      .get('/chat/messages?limit=1')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const p1 = page1.body as {
      hasMore: boolean;
      nextCursor: string | null;
      messages: Array<{ userText: string }>;
    };
    expect(p1.messages).toHaveLength(1);
    expect(p1.messages[0].userText).toBe('second message');
    expect(p1.hasMore).toBe(true);
    expect(p1.nextCursor).toBeTruthy();

    // Older page via the cursor → the previous turn.
    const page2 = await request(app.getHttpServer())
      .get(`/chat/messages?limit=1&before=${p1.nextCursor}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const p2 = page2.body as {
      hasMore: boolean;
      messages: Array<{ userText: string }>;
    };
    expect(p2.messages).toHaveLength(1);
    expect(p2.messages[0].userText).toBe('first message');
    expect(p2.hasMore).toBe(false);
  }, 120_000);
});
