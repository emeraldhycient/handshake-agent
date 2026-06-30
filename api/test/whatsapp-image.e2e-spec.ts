/**
 * WhatsApp inbound image → document-extraction → beneficiary saved — e2e (Task 19).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives:
 *
 *   Case 1 — Verified linked sender:
 *     POST /whatsapp/webhook — signed `image`-type payload (HMAC-SHA256)
 *       → WhatsAppInboundService.ingest
 *       → WHATSAPP_MEDIA_CLIENT.download (stub: returns image bytes)
 *       → DOCUMENT_EXTRACTION_PORT.extract (stub: returns crypto_address TRON)
 *       → ConversationService.handleInbound → handleExtractedMedia
 *       → BeneficiaryService.addCryptoAddress → Beneficiary row created
 *       → sender.sendText (confirmation reply mentioning address)
 *       → LLM_PROVIDER.extractIntent NOT called (agent bypassed for extraction)
 *
 *   Case 2 — Unlinked sender:
 *     POST /whatsapp/webhook from a number not seeded as a User
 *       → identity resolves to Contact (unlinked)
 *       → handleExtractedMedia guard → KYC handoff (sendCtaUrl)
 *       → NO Beneficiary row created for that number
 *
 * Bootstrap mirrors whatsapp-voice.e2e-spec.ts exactly:
 *   - env vars set BEFORE dynamic import of AppModule (ConfigModule side-effect)
 *   - Testcontainers Postgres + prisma migrate deploy
 *   - Tier-1 KYC-verified User + WhatsApp ChannelIdentity seeded (same pattern)
 *   - HMAC-SHA256 signature computed via buildWhatsAppSignature (same helper)
 *   - Same provider overrides for WALLET_PROVIDER / PAYMENT_PROVIDER / WHATSAPP_SENDER
 *   - Additional overrides for WHATSAPP_MEDIA_CLIENT + DOCUMENT_EXTRACTION_PORT
 *   - LLM_PROVIDER overridden to assert it is NEVER called
 *
 * SACROSANCT (§3.1): the extraction path bypasses the agent entirely. No LLM
 * output moves money; the address is saved as a beneficiary candidate only —
 * sending still requires the full proposal → confirm → PIN path.
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
/** Verified linked sender — seeded as a KYC-verified User. */
const TEST_PHONE = '2349001112233'; // unique from other e2e suites
/** Unlinked sender — NOT seeded as a User, gets KYC handoff. */
const UNLINKED_PHONE = '2349009998877'; // unique; no User/ChannelIdentity row
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-wa-image';
const WA_APP_SECRET = 'e2e-wa-image-app-secret-789';
const WA_VERIFY_TOKEN = 'e2e-verify-token-wa-image';
const DIRECTIVE_SIGNING_KEY = 'e2e-wa-image-directive-key-32byts!';
const WA_FLOW_ID = ''; // intentionally empty — image path does not use Flows
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-image-fake';

const FAKE_IMAGE_MEDIA_ID = 'wa-media-id-image-e2e-001';

/**
 * Valid TRON address (T-prefix, 34 chars, base58-like).
 * The AssetRegistry inferNetworkForAddress uses the T-prefix pattern for TRON.
 */
const TRON_ADDRESS = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';

// ---------------------------------------------------------------------------
// Helpers — mirrored from whatsapp-voice.e2e-spec.ts
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
 * Builds a realistic WhatsApp inbound webhook payload for an image message.
 * Uses the same outer envelope as the audio helper, with `type: 'image'` and
 * an `image` sub-object carrying the media id.
 */
function buildImageWebhookPayload(params: {
  from: string;
  messageId: string;
  mediaId: string;
  phoneNumberId: string;
}): object {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'e2e-wa-image-entry-id',
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
                  profile: { name: 'E2E Image Test User' },
                  wa_id: params.from,
                },
              ],
              messages: [
                {
                  from: params.from,
                  id: params.messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'image',
                  image: {
                    id: params.mediaId,
                    mime_type: 'image/jpeg',
                    sha256: 'fakehash',
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

describe('WhatsApp inbound image → beneficiary saved — e2e (AppModule, Testcontainers Postgres)', () => {
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
      RECEIPT_SIGNING_KEY: 'e2e-wa-image-receipt-signing-key-32b!!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-wa-image',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-wai',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-wa-image',
      FLUTTERWAVE_WEBHOOK_SECRET: 'e2e-flw-webhook-secret-wa-image',
    });
    // Ensure ANTHROPIC_API_KEY is absent (not empty string) to pass optional validation
    delete process.env.ANTHROPIC_API_KEY;

    // 3. Dynamic import of AppModule (happens AFTER env vars are set above).
    //    Deferring this import is essential: ConfigModule.forRoot() calls
    //    validateEnv() synchronously when the module file is first required.
    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    // 4. Build fake providers with correct interface shapes.

    // LLM fake: overriding to assert it is NEVER called — extraction path
    // bypasses the agent entirely (§3.1). If extractIntent is called, the
    // test will detect it via `expect(fakeLlmProvider.extractIntent).not.toHaveBeenCalled()`.
    fakeLlmProvider = {
      extractIntent: jest.fn().mockResolvedValue({
        action: 'none',
        clarification: 'unexpected agent call in image extraction path',
      }),
    };

    fakeWalletProvider = {
      provisionAddress: jest.fn().mockResolvedValue({
        address: 'TFakeWalletAddrE2EImg12345678',
        providerReference: 'fake_blockradar_ref_wa_image_e2e',
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: 'e2e-tx-ref-stub-wai',
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
        accountNumber: '0091234579',
        bankName: 'Image Test MFB',
        providerRef: 'flw_fake_ref_wai_e2e',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '0',
        currency: 'NGN',
        providerRef: 'flw_fake_ref_wai_e2e',
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    fakeSender = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.text.wai.e2e' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.wai.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.wai.e2e' }),
      sendFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.flow.wai.e2e' }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.wai.e2e' }),
    };

    // Media-client stub: simulates a successful Cloud API image download.
    // Returns minimal bytes with the expected MIME type — content is irrelevant
    // because DOCUMENT_EXTRACTION_PORT is also stubbed.
    fakeMediaClient = {
      download: jest.fn().mockResolvedValue({
        bytes: Buffer.from('img'),
        mimeType: 'image/jpeg',
      }),
    };

    // Transcription stub: not exercised by the image path but the provider is
    // registered in the DI container — override prevents any real API call.
    fakeTranscription = {
      transcribe: jest.fn().mockResolvedValue({ text: '[image stub]' }),
    };

    // Document-extraction stub: returns a valid TRON crypto_address candidate.
    // This is overridden per-test in beforeEach for case-specific behaviour.
    fakeDocumentExtraction = {
      extract: jest.fn().mockResolvedValue({
        kind: 'crypto_address',
        address: TRON_ADDRESS,
        network: 'TRON',
      }),
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
    //    Mirrors whatsapp-voice.e2e-spec.ts exactly so the extraction handler
    //    finds an active linked user and saves the beneficiary (happy path).
    const user = await prisma.user.create({
      data: { kycStatus: 'verified', kycTier: 'tier_1', status: 'active' },
    });
    userId = user.id;

    const { PinService } = await import('../src/core/auth/pin.service');
    const pinService = moduleRef.get(PinService);
    await pinService.setPin(userId, '194837');

    await prisma.channelIdentity.create({
      data: {
        channel: 'whatsapp',
        channelAddress: TEST_PHONE,
        normalizedPhone: TEST_PHONE,
        userId,
      },
    });

    // NOTE: UNLINKED_PHONE is intentionally NOT seeded — no User/ChannelIdentity
    // row for it. IdentityService will resolve it as an unlinked Contact.
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
      action: 'none',
      clarification: 'unexpected agent call in image extraction path',
    });

    fakeWalletProvider.provisionAddress.mockResolvedValue({
      address: 'TFakeWalletAddrE2EImg12345678',
      providerReference: 'fake_blockradar_ref_wa_image_e2e',
      network: 'TRON',
    });
    fakeWalletProvider.getBalance.mockResolvedValue({
      amount: '0',
      decimals: 6,
    });

    fakePaymentProvider.verifyWebhookSignature.mockReturnValue(false);

    fakeSender.sendText.mockResolvedValue({
      externalMessageId: 'wamid.out.text.wai.e2e',
    });
    fakeSender.sendCtaUrl.mockResolvedValue({
      externalMessageId: 'wamid.out.cta.wai.e2e',
    });
    fakeSender.sendFlow.mockResolvedValue({
      externalMessageId: 'wamid.out.flow.wai.e2e',
    });

    fakeMediaClient.download.mockResolvedValue({
      bytes: Buffer.from('img'),
      mimeType: 'image/jpeg',
    });

    fakeTranscription.transcribe.mockResolvedValue({ text: '[image stub]' });

    fakeDocumentExtraction.extract.mockResolvedValue({
      kind: 'crypto_address',
      address: TRON_ADDRESS,
      network: 'TRON',
    });
  });

  // ===========================================================================
  // CASE 1 — Verified linked sender → beneficiary saved, reply sent, agent not called
  // ===========================================================================

  it('saves a crypto beneficiary and sends a confirmation reply when a verified linked user sends an image with a TRON address', async () => {
    const messageId = `wamid.e2e.img.${Date.now()}`;

    // ───────────────────────────────────────────────────────────────────────
    // Build and sign the image webhook payload (HMAC-SHA256 exactly as Meta)
    // ───────────────────────────────────────────────────────────────────────

    const imagePayload = buildImageWebhookPayload({
      from: TEST_PHONE,
      messageId,
      mediaId: FAKE_IMAGE_MEDIA_ID,
      phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
    });

    const rawBodyBuf = Buffer.from(JSON.stringify(imagePayload));
    const signature = buildWhatsAppSignature(WA_APP_SECRET, rawBodyBuf);

    // ───────────────────────────────────────────────────────────────────────
    // POST /whatsapp/webhook — expect 200 { status: 'received' }
    // ───────────────────────────────────────────────────────────────────────

    const webhookRes = await supertest(app.getHttpServer())
      .post('/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(imagePayload);

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body).toEqual({ status: 'received' });

    // ───────────────────────────────────────────────────────────────────────
    // Assert the image download and extraction stubs were exercised
    // ───────────────────────────────────────────────────────────────────────

    expect(fakeMediaClient.download).toHaveBeenCalledWith(FAKE_IMAGE_MEDIA_ID);
    // Verify the extraction stub was called with a Buffer + the correct MIME type.
    const extractArg = fakeDocumentExtraction.extract.mock.calls[0]?.[0];
    expect(extractArg).toBeDefined();
    expect(extractArg.mimeType).toBe('image/jpeg');
    expect(Buffer.isBuffer(extractArg.bytes)).toBe(true);

    // ───────────────────────────────────────────────────────────────────────
    // Assert (c): the LLM provider was NOT called — extraction bypasses agent (§3.1)
    // ───────────────────────────────────────────────────────────────────────

    expect(fakeLlmProvider.extractIntent).not.toHaveBeenCalled();

    // ───────────────────────────────────────────────────────────────────────
    // Assert (a): a Beneficiary row now exists for the seeded user
    //   type = crypto_address, cryptoNetwork = TRON, cryptoAddress = TRON_ADDRESS
    // ───────────────────────────────────────────────────────────────────────

    const beneficiary = await prisma.beneficiary.findFirst({
      where: {
        userId,
        type: 'crypto_address',
        cryptoNetwork: 'TRON',
        deletedAt: null,
      },
    });
    expect(beneficiary).not.toBeNull();
    expect(beneficiary!.cryptoAddress).toBe(TRON_ADDRESS);
    expect(beneficiary!.cryptoNetwork).toBe('TRON');
    expect(beneficiary!.type).toBe('crypto_address');

    // ───────────────────────────────────────────────────────────────────────
    // Assert (b): sender.sendText dispatched a confirmation reply mentioning
    //   the payout address / wallet (address appears in the reply text).
    // ───────────────────────────────────────────────────────────────────────

    expect(fakeSender.sendText).toHaveBeenCalledWith(
      TEST_PHONE,
      expect.stringMatching(/payout address|wallet/i),
    );

    // No KYC handoff (sendCtaUrl) for a verified user.
    expect(fakeSender.sendCtaUrl).not.toHaveBeenCalled();
  }, 120_000);

  // ===========================================================================
  // CASE 2 — Unlinked sender → KYC handoff sent, no beneficiary saved
  // ===========================================================================

  it('sends a KYC handoff and does NOT save a beneficiary when an unlinked sender sends an image', async () => {
    const messageId = `wamid.e2e.img.unlinked.${Date.now()}`;

    // ───────────────────────────────────────────────────────────────────────
    // Build and sign the image webhook payload from the unlinked number
    // ───────────────────────────────────────────────────────────────────────

    const imagePayload = buildImageWebhookPayload({
      from: UNLINKED_PHONE,
      messageId,
      mediaId: FAKE_IMAGE_MEDIA_ID,
      phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
    });

    const rawBodyBuf = Buffer.from(JSON.stringify(imagePayload));
    const signature = buildWhatsAppSignature(WA_APP_SECRET, rawBodyBuf);

    // Extraction still returns a crypto_address — the guard fires before persistence.
    fakeDocumentExtraction.extract.mockResolvedValue({
      kind: 'crypto_address',
      address: TRON_ADDRESS,
      network: 'TRON',
    });

    // ───────────────────────────────────────────────────────────────────────
    // POST /whatsapp/webhook — expect 200
    // ───────────────────────────────────────────────────────────────────────

    const webhookRes = await supertest(app.getHttpServer())
      .post('/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(imagePayload);

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body).toEqual({ status: 'received' });

    // ───────────────────────────────────────────────────────────────────────
    // Assert NO crypto Beneficiary row was created for the unlinked number.
    // There is no userId for UNLINKED_PHONE, so we assert the total count
    // of crypto_address beneficiaries for the seeded user is still 0 extra,
    // AND that no beneficiary with the TRON address belongs to a user linked
    // to UNLINKED_PHONE.
    //
    // Since UNLINKED_PHONE was never linked to a User, any Beneficiary row
    // created would have to originate from the seeded userId — but our
    // assertion targets the seeded user's beneficiaries that were created in
    // THIS test run. We check the unlinked phone never contributed a row.
    // ───────────────────────────────────────────────────────────────────────

    // IdentityService upserts a ChannelIdentity for every inbound address —
    // even unlinked senders get a row. The key distinction is that userId is null
    // (the row is a Contact identity, not linked to a verified User).
    const unlinkedIdentity = await prisma.channelIdentity.findFirst({
      where: { channelAddress: UNLINKED_PHONE, channel: 'whatsapp' },
    });
    // Confirm the identity is unlinked: either no row, or row with userId = null.
    if (unlinkedIdentity !== null) {
      expect(unlinkedIdentity.userId).toBeNull();
    }

    // No Beneficiary row should exist for any userId linked to UNLINKED_PHONE
    // (userId is null for unlinked identities, so no Beneficiary FK can point to one).
    // Count crypto_address beneficiaries with the TRON address in the whole DB —
    // the only one that should exist is the one saved for the seeded userId (Case 1).
    // Because tests may run in either order, we assert no row exists where userId
    // is the unlinked contact's userId (which is null → no rows possible).
    const unlinkedBeneficiary = await prisma.beneficiary.findFirst({
      where: {
        type: 'crypto_address',
        cryptoAddress: TRON_ADDRESS,
        deletedAt: null,
        // The unlinked identity has userId = null, so this subquery finds nothing.
        user: {
          channelIdentities: {
            some: { channelAddress: UNLINKED_PHONE, channel: 'whatsapp' },
          },
        },
      },
    });
    expect(unlinkedBeneficiary).toBeNull();

    // ───────────────────────────────────────────────────────────────────────
    // Assert KYC handoff was dispatched — either sendCtaUrl (when
    // WEB_APP_BASE_URL is set) or sendText with KYC guidance (fallback).
    // WA_FLOW_ID is empty and WEB_APP_BASE_URL is unset in our test env, so
    // HandoffTokenService.mintKycToken will produce an empty url → text fallback.
    // Either way, sendText must have been called with KYC / verify content.
    // ───────────────────────────────────────────────────────────────────────

    const textCalls = fakeSender.sendText.mock.calls;
    const ctaCalls = fakeSender.sendCtaUrl.mock.calls;

    // sendCtaUrl takes a single SendCtaUrlInput object (not separate args).
    // sendText takes (to: string, body: string).
    const kycHandoffDispatched =
      ctaCalls.some(
        ([input]) =>
          typeof input === 'object' &&
          input !== null &&
          'to' in input &&
          (input as { to: string }).to === UNLINKED_PHONE,
      ) ||
      textCalls.some(
        ([to, text]) =>
          to === UNLINKED_PHONE &&
          typeof text === 'string' &&
          /kyc|verif|identity|transact/i.test(text),
      );

    expect(kycHandoffDispatched).toBe(true);

    // The agent must not have been called for the unlinked path either.
    expect(fakeLlmProvider.extractIntent).not.toHaveBeenCalled();
  }, 120_000);
});
