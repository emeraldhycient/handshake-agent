/**
 * Web voice endpoint — end-to-end acceptance test.
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives:
 *
 *   1. POST /auth/signup         → 202, devToken
 *   2. POST /auth/verify-email   → 200, { verified: true }
 *   3. POST /auth/login/request  → 202, devOtp
 *   4. POST /auth/login/verify   → 200, { accessToken }
 *   5. POST /kyc/submit (Bearer) → 200, { userId, status: 'verified' }
 *   6. POST /chat/voice (Bearer, multipart audio) → 200, { transcript, outcome.kind, conversationId }
 *
 * Plus:
 *   - POST /chat/voice with bad MIME → 400/415
 *   - POST /chat/voice without Bearer → 401
 *
 * Bootstrap mirrors web-chat.e2e-spec.ts:
 *   - Testcontainers Postgres + prisma migrate deploy
 *   - env vars set BEFORE AppModule dynamic import
 *   - four external-edge fakes overridden via .overrideProvider()
 *   - TRANSCRIPTION_PORT overridden to return deterministic transcript
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
import { TRANSCRIPTION_PORT } from '../src/modules/media/application/ports/transcription.port';
import type { LlmProvider } from '../src/modules/agent/core/ports/llm-provider.port';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';
import type { IWhatsAppSender } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';
import type { ITranscriptionPort } from '../src/modules/media/application/ports/transcription.port';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_ROOT = join(__dirname, '..');
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-web-voice';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-web-voice-fake';
const WA_APP_SECRET = 'e2e-web-voice-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-web-voice';

// ===========================================================================
// THE TEST SUITE
// ===========================================================================

describe('Web voice — e2e (AppModule, Testcontainers Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stopContainer: () => Promise<void>;
  let fakeLlmProvider: jest.Mocked<LlmProvider>;
  let fakeWalletProvider: jest.Mocked<IWalletProvider>;
  let fakePaymentProvider: jest.Mocked<IPaymentProvider>;
  let fakeSender: jest.Mocked<IWhatsAppSender>;
  let fakeTranscription: jest.Mocked<ITranscriptionPort>;

  // shared across tests that need auth
  let accessToken: string;

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
      DIRECTIVE_SIGNING_KEY: 'e2e-wv-directive-key-32bytes!!xxxx',
      RECEIPT_SIGNING_KEY: 'e2e-wv-receipt-signing-key-32b!!!!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-web-voice',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-wv',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-web-voice',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-web-voice',
      JWT_SECRET: 'e2e-web-voice-jwt-secret-at-least-32-bytes!!',
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

    fakeWalletProvider = {
      provisionAddress: jest.fn().mockResolvedValue({
        address: 'TVoiceFakeAddr12345678901234',
        providerReference: 'fake-ref-web-voice',
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
        accountNumber: '0091234569',
        bankName: 'Web Voice Test MFB',
        providerRef: 'flw_fake_ref_web_voice_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_web_voice_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    fakeSender = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.wv.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.wv.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.wv.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.wv.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.wv.e2e' }),
    };

    // Transcription stub — always returns a deterministic transcript so the
    // agent receives stable text and fakeLlmProvider maps it to receive_crypto.
    fakeTranscription = {
      transcribe: jest
        .fn()
        .mockResolvedValue({ text: 'where do I receive USDT?' }),
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
      .overrideProvider(TRANSCRIPTION_PORT)
      .useValue(fakeTranscription)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();

    // ── Shared auth setup: signup → verify → login → kyc ──────────────────
    const email = `e2e_wv_${Date.now()}@test.com`;

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, phone: '+2348029999011' })
      .expect(202);
    const signupBody = signup.body as { status: string; devToken: string };
    const devToken = signupBody.devToken;

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: devToken })
      .expect(200);

    const lr = await request(app.getHttpServer())
      .post('/auth/login/request')
      .send({ email })
      .expect(202);
    const lrBody = lr.body as { status: string; devOtp: string };
    const otp = lrBody.devOtp;

    const lv = await request(app.getHttpServer())
      .post('/auth/login/verify')
      .send({ email, otp, deviceFingerprint: 'e2e-wv-fingerprint-123' })
      .expect(200);
    const lvBody = lv.body as { accessToken: string };
    accessToken = lvBody.accessToken;

    // KYC-verify the user so the receive flow completes
    await request(app.getHttpServer())
      .post('/kyc/submit')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Adaugo',
        lastName: 'Nwosu',
        nin: '33445566778',
        pin: '5678',
      })
      .expect(200);
  }, 120_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await stopContainer?.();
  });

  // ===========================================================================
  // UNAUTHENTICATED TEST — no Bearer token → 401
  // ===========================================================================

  it('POST /chat/voice without Bearer token → 401', async () => {
    await request(app.getHttpServer())
      .post('/chat/voice')
      .attach('audio', Buffer.from('x'), {
        filename: 'a.ogg',
        contentType: 'audio/ogg',
      })
      .expect(401);
  }, 30_000);

  // ===========================================================================
  // INVALID MIME TYPE — text/plain → 400 or 415
  // ===========================================================================

  it('POST /chat/voice with unsupported MIME type → 400 or 415', async () => {
    await request(app.getHttpServer())
      .post('/chat/voice')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('audio', Buffer.from('x'), {
        filename: 'a.txt',
        contentType: 'text/plain',
      })
      .expect((r) => {
        if (![400, 415].includes(r.status)) {
          throw new Error(`expected 400 or 415, got ${r.status}`);
        }
      });
  }, 30_000);

  // ===========================================================================
  // HAPPY PATH — upload voice note → transcribe → agent → receive outcome
  // ===========================================================================

  it('POST /chat/voice transcribes audio and returns the agent outcome + transcript', async () => {
    const res = await request(app.getHttpServer())
      .post('/chat/voice')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('audio', Buffer.from('fake-audio-bytes'), {
        filename: 'note.ogg',
        contentType: 'audio/ogg',
      })
      .expect(200);

    const body = res.body as {
      transcript: string;
      reply: { text: string };
      outcome: {
        kind: string;
        deposit?: { address: string; asset: string; network: string };
      };
      conversationId: string;
      messageId: string;
    };

    expect(body.transcript).toBe('where do I receive USDT?');
    expect(body.outcome.kind).toBe('receive');
    expect(body.outcome.deposit).toBeDefined();
    expect(body.outcome.deposit!.address).toBeTruthy();
    expect(body.conversationId).toBeDefined();
    expect(body.messageId).toBeDefined();

    // Verify the transcription stub was actually called
    expect(fakeTranscription.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'audio/ogg',
      }),
    );
  }, 120_000);

  // ===========================================================================
  // MISSING FILE — no audio field → 400
  // ===========================================================================

  it('POST /chat/voice with no audio field → 400', async () => {
    await request(app.getHttpServer())
      .post('/chat/voice')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'multipart/form-data')
      .expect(400);
  }, 30_000);
});
