/**
 * WhatsApp inbound voice note → agent — e2e acceptance test (Task 16).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives:
 *
 *   1. POST /whatsapp/webhook — signed `audio`-type payload (HMAC-SHA256)
 *      → WhatsAppInboundService.ingest
 *      → WHATSAPP_MEDIA_CLIENT.download (stub: returns 1 byte, 'audio/ogg')
 *      → TRANSCRIPTION_PORT.transcribe (stub: returns 'where do I receive USDT?')
 *      → ConversationService.handleInbound
 *      → LLM_PROVIDER fake maps transcript → receive_crypto intent
 *      → handleReceive → WalletService.getOrProvisionNetworkWallet
 *      → sender.sendText (deposit address reply)
 *
 * The sender spy asserts that a reply was dispatched. The media-client and
 * transcription stubs confirm the audio path was taken, not a text path.
 *
 * Bootstrap mirrors buy-vertical.e2e-spec.ts exactly:
 *   - env vars set BEFORE dynamic import of AppModule (ConfigModule side-effect)
 *   - Testcontainers Postgres + prisma migrate deploy
 *   - Tier-1 KYC-verified User + WhatsApp ChannelIdentity seeded (same pattern)
 *   - HMAC-SHA256 signature computed via buildWhatsAppSignature (same helper)
 *   - Same provider overrides for WALLET_PROVIDER / PAYMENT_PROVIDER / WHATSAPP_SENDER
 *   - Additional overrides for WHATSAPP_MEDIA_CLIENT + TRANSCRIPTION_PORT
 *
 * Does NOT seed LLM_PROVIDER with buy_crypto — uses receive_crypto (mirrors web-voice.e2e-spec.ts)
 * so the receive path is exercised end-to-end without a proposal / PIN flow.
 *
 * CRITICAL: env vars MUST be set in process.env BEFORE AppModule is imported,
 * because ConfigModule.forRoot() calls validateEnv() synchronously at class
 * decoration time (when the module file is first required). We achieve this by
 * using a dynamic import() of AppModule inside beforeAll, AFTER setting all vars.
 *
 * Requires Docker. Runs only in the test:e2e lane (jest-e2e.json).
 */

import * as crypto from 'crypto';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

// supertest is a CommonJS module; allowSyntheticDefaultImports lets us import it
// as a default, and ts-jest's CJS interop makes it callable as a function.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const supertest = require('supertest') as typeof import('supertest');
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
import { WHATSAPP_MEDIA_CLIENT } from '../src/modules/whatsapp/application/ports/whatsapp-media.port';
import { DOCUMENT_EXTRACTION_PORT } from '../src/modules/media/application/ports/document-extraction.port';
import type { LlmProvider } from '../src/modules/agent/core/ports/llm-provider.port';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';
import type { IWhatsAppSender } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';
import type { ITranscriptionPort } from '../src/modules/media/application/ports/transcription.port';
import type { IWhatsAppMediaClient } from '../src/modules/whatsapp/application/ports/whatsapp-media.port';
import type { IDocumentExtractionPort } from '../src/modules/media/application/ports/document-extraction.port';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_ROOT = join(__dirname, '..');
const TEST_PHONE = '2348009998877'; // E.164 without '+', unique from buy-vertical
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-wa-voice';
const WA_APP_SECRET = 'e2e-wa-voice-app-secret-456';
const WA_VERIFY_TOKEN = 'e2e-verify-token-wa-voice';
const DIRECTIVE_SIGNING_KEY = 'e2e-wa-voice-directive-key-32byts!';
const WA_FLOW_ID = ''; // intentionally empty — receive path does not use Flows
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-voice-fake';

const FAKE_WALLET_ADDRESS = 'TVoiceE2EFakeWalletAddr123456789';
const FAKE_BLOCKRADAR_REF = 'fake_blockradar_ref_wa_voice_e2e';
const FAKE_AUDIO_MEDIA_ID = 'wa-media-id-voice-note-e2e-001';
const TRANSCRIPT = 'where do I receive USDT?';

// ---------------------------------------------------------------------------
// Helpers — mirrored from buy-vertical.e2e-spec.ts
// ---------------------------------------------------------------------------

/**
 * Computes X-Hub-Signature-256 header value for a raw body buffer,
 * matching the WhatsAppSignatureGuard's verifyHmacHeader logic exactly.
 */
function buildWhatsAppSignature(appSecret: string, rawBody: Buffer): string {
  const sig = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  return `sha256=${sig}`;
}

/**
 * Builds a realistic WhatsApp inbound webhook payload for an audio voice note.
 * Uses the same outer envelope as the text helper in buy-vertical.e2e-spec.ts,
 * with `type: 'audio'` and an `audio` sub-object carrying the media id.
 */
function buildAudioWebhookPayload(params: {
  from: string;
  messageId: string;
  mediaId: string;
  phoneNumberId: string;
}): object {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'e2e-wa-voice-entry-id',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+2348000000000',
                phone_number_id: params.phoneNumberId,
              },
              contacts: [
                {
                  profile: { name: 'E2E Voice Test User' },
                  wa_id: params.from,
                },
              ],
              messages: [
                {
                  from: params.from,
                  id: params.messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'audio',
                  audio: {
                    id: params.mediaId,
                    mime_type: 'audio/ogg; codecs=opus',
                    voice: true,
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

// ===========================================================================
// THE TEST SUITE
// ===========================================================================

describe('WhatsApp voice note — e2e (AppModule, Testcontainers Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stopContainer: () => Promise<void>;
  let userId: string;
  let fakeLlmProvider: jest.Mocked<LlmProvider>;
  let fakeWalletProvider: jest.Mocked<IWalletProvider>;
  let fakePaymentProvider: jest.Mocked<IPaymentProvider>;
  let fakeSender: jest.Mocked<IWhatsAppSender>;
  let fakeMediaClient: jest.Mocked<IWhatsAppMediaClient>;
  let fakeTranscription: jest.Mocked<ITranscriptionPort>;
  let fakeDocumentExtraction: jest.Mocked<IDocumentExtractionPort>;

  // ── beforeAll: set env → import AppModule → boot → seed ────────────────────

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
      WHATSAPP_FLOW_ID: WA_FLOW_ID,
      DIRECTIVE_SIGNING_KEY,
      RECEIPT_SIGNING_KEY: 'e2e-wa-voice-receipt-signing-key-32b!!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-wa-voice',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-wav',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-wa-voice',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-wa-voice',
    });
    // Ensure ANTHROPIC_API_KEY is absent (not empty string) to pass optional validation
    delete process.env.ANTHROPIC_API_KEY;

    // 3. Dynamic import of AppModule (happens AFTER env vars are set above).
    //    Deferring this import is essential: ConfigModule.forRoot() calls
    //    validateEnv() synchronously when the module file is first required.
    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    // 4. Build fake providers with correct interface shapes.

    // LLM fake: the transcript "where do I receive USDT?" maps to receive_crypto.
    // No real Anthropic API call is made.
    fakeLlmProvider = {
      extractIntent: jest.fn().mockResolvedValue({
        action: 'receive_crypto',
        asset: 'USDT',
        network: 'TRON',
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
        providerReference: 'e2e-tx-ref-stub-wav',
        status: 'pending' as const,
      }),
      getWithdrawalStatus: jest
        .fn()
        .mockResolvedValue({ status: 'pending' as const }),
    };

    fakePaymentProvider = {
      createCollection: jest.fn().mockResolvedValue({
        accountNumber: '0091234578',
        bankName: 'Voice Test MFB',
        providerRef: 'flw_fake_ref_wav_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '0',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_wav_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    fakeSender = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.wav.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.wav.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.wav.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.wav.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.wav.e2e' }),
    };

    // Media-client stub: simulates a successful Cloud API audio download.
    // Returns 1 byte with the expected MIME type — content is irrelevant because
    // TRANSCRIPTION_PORT is also stubbed.
    fakeMediaClient = {
      download: jest.fn().mockResolvedValue({
        bytes: Buffer.from('a'),
        mimeType: 'audio/ogg',
      }),
    };

    // Transcription stub: always returns the deterministic transcript so the
    // LLM fake receives a stable string and maps it to receive_crypto.
    fakeTranscription = {
      transcribe: jest.fn().mockResolvedValue({ text: TRANSCRIPT }),
    };

    // Document-extraction stub: not exercised by audio path, but the provider
    // is registered in the DI container and overriding it prevents any real
    // vision API call if configuration accidentally enables it.
    fakeDocumentExtraction = {
      extract: jest.fn().mockResolvedValue({ kind: 'none' }),
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
      .overrideProvider(WHATSAPP_MEDIA_CLIENT)
      .useValue(fakeMediaClient)
      .overrideProvider(TRANSCRIPTION_PORT)
      .useValue(fakeTranscription)
      .overrideProvider(DOCUMENT_EXTRACTION_PORT)
      .useValue(fakeDocumentExtraction)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();

    // 6. Seed: Tier-1 KYC-verified User + PIN + WhatsApp ChannelIdentity.
    //    Mirrors buy-vertical.e2e-spec.ts exactly so the receive_crypto handler
    //    finds an active user and returns the deposit address (happy path).
    const user = await prisma.user.create({
      data: { kycStatus: 'verified', kycTier: 'tier_1', status: 'active' },
    });
    userId = user.id;

    const { PinService } = await import('../src/core/auth/pin.service');
    const pinService = moduleRef.get(PinService);
    await pinService.setPin(userId, '123456');

    await prisma.channelIdentity.create({
      data: {
        channel: 'whatsapp',
        channelAddress: TEST_PHONE,
        normalizedPhone: TEST_PHONE,
        userId,
      },
    });
  }, 120_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await stopContainer?.();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-apply mock return values after clearAllMocks clears them.
    fakeLlmProvider.extractIntent.mockResolvedValue({
      action: 'receive_crypto',
      asset: 'USDT',
      network: 'TRON',
    });

    fakeWalletProvider.provisionAddress.mockResolvedValue({
      address: FAKE_WALLET_ADDRESS,
      providerReference: FAKE_BLOCKRADAR_REF,
      network: 'TRON',
    });
    fakeWalletProvider.getBalance.mockResolvedValue({
      amount: '0',
      decimals: 6,
    });

    fakePaymentProvider.verifyWebhookSignature.mockReturnValue(false);

    fakeSender.sendText.mockResolvedValue({
      externalMessageId: 'wamid.out.text.wav.e2e',
    });
    fakeSender.sendCtaUrl.mockResolvedValue({
      externalMessageId: 'wamid.out.cta.wav.e2e',
    });
    fakeSender.sendFlow.mockResolvedValue({
      externalMessageId: 'wamid.out.flow.wav.e2e',
    });

    fakeMediaClient.download.mockResolvedValue({
      bytes: Buffer.from('a'),
      mimeType: 'audio/ogg',
    });

    fakeTranscription.transcribe.mockResolvedValue({ text: TRANSCRIPT });

    fakeDocumentExtraction.extract.mockResolvedValue({ kind: 'none' });
  });

  // ===========================================================================
  // MAIN TEST — inbound voice note → transcription → agent → receive reply
  // ===========================================================================

  it('transcribes an inbound voice note and routes it through the agent, sending a deposit-address reply', async () => {
    const messageId = `wamid.e2e.wav.${Date.now()}`;

    // ───────────────────────────────────────────────────────────────────────
    // Build and sign the audio webhook payload (HMAC-SHA256 exactly as Meta)
    // ───────────────────────────────────────────────────────────────────────

    const audioPayload = buildAudioWebhookPayload({
      from: TEST_PHONE,
      messageId,
      mediaId: FAKE_AUDIO_MEDIA_ID,
      phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
    });

    const rawBodyBuf = Buffer.from(JSON.stringify(audioPayload));
    const signature = buildWhatsAppSignature(WA_APP_SECRET, rawBodyBuf);

    // ───────────────────────────────────────────────────────────────────────
    // POST /whatsapp/webhook — expect 200 { status: 'received' }
    // ───────────────────────────────────────────────────────────────────────

    const webhookRes = await supertest(app.getHttpServer())
      .post('/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(audioPayload);

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body).toEqual({ status: 'received' });

    // ───────────────────────────────────────────────────────────────────────
    // Assert the audio download and transcription stubs were exercised
    // ───────────────────────────────────────────────────────────────────────

    expect(fakeMediaClient.download).toHaveBeenCalledWith(FAKE_AUDIO_MEDIA_ID);
    // Verify the transcribe stub was called with a Buffer + the correct MIME type.
    const transcribeArg = fakeTranscription.transcribe.mock.calls[0]?.[0];
    expect(transcribeArg).toBeDefined();
    expect(transcribeArg.mimeType).toBe('audio/ogg');
    expect(Buffer.isBuffer(transcribeArg.bytes)).toBe(true);

    // ───────────────────────────────────────────────────────────────────────
    // Assert the LLM received the transcript text
    // ───────────────────────────────────────────────────────────────────────

    expect(fakeLlmProvider.extractIntent).toHaveBeenCalledWith(TRANSCRIPT);

    // ───────────────────────────────────────────────────────────────────────
    // Assert the sender dispatched a deposit-address reply (receive_crypto path)
    // The seeded user is KYC-verified so handleReceive provisions + returns the
    // wallet address via sendText (no Flow, no KYC handoff).
    // ───────────────────────────────────────────────────────────────────────

    expect(fakeSender.sendText).toHaveBeenCalledWith(
      TEST_PHONE,
      expect.stringContaining(FAKE_WALLET_ADDRESS),
    );

    // No KYC handoff (sendCtaUrl) should have been called for a verified user.
    expect(fakeSender.sendCtaUrl).not.toHaveBeenCalled();

    // ───────────────────────────────────────────────────────────────────────
    // Assert the inbound message was persisted as 'processed'
    // ───────────────────────────────────────────────────────────────────────

    const msg = await prisma.conversationMessage.findUnique({
      where: { externalMessageId: messageId },
    });
    expect(msg).not.toBeNull();
    expect(msg!.processingStatus).toBe('processed');

    // ───────────────────────────────────────────────────────────────────────
    // Assert the receive_crypto intent was persisted
    // ───────────────────────────────────────────────────────────────────────

    const intent = await prisma.messageIntent.findUnique({
      where: { messageId: msg!.id },
    });
    expect(intent).not.toBeNull();
    expect(intent!.action).toBe('receive_crypto');
  }, 120_000);

  // ===========================================================================
  // IDEMPOTENCY — same audio message id sent twice → no duplicate processing
  // ===========================================================================

  it('does not process the same audio message id twice (idempotent dedup)', async () => {
    const messageId = `wamid.e2e.wav.dedup.${Date.now()}`;

    const audioPayload = buildAudioWebhookPayload({
      from: TEST_PHONE,
      messageId,
      mediaId: FAKE_AUDIO_MEDIA_ID,
      phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
    });

    const rawBodyBuf = Buffer.from(JSON.stringify(audioPayload));
    const signature = buildWhatsAppSignature(WA_APP_SECRET, rawBodyBuf);

    // First call — processes and persists.
    await supertest(app.getHttpServer())
      .post('/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(audioPayload)
      .expect(200);

    // Second call — same external message id → handled 200 again.
    await supertest(app.getHttpServer())
      .post('/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(audioPayload)
      .expect(200);

    // The dedup guard fires inside handleInbound (after the audio download),
    // so the download is called once per webhook delivery but only one
    // ConversationMessage row is ever persisted (the second handleInbound
    // call returns early at the findByExternalId check).
    // ConversationMessage count must be exactly 1 — no duplicate row.
    const count = await prisma.conversationMessage.count({
      where: { externalMessageId: messageId },
    });
    expect(count).toBe(1);
  }, 120_000);
});
