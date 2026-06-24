/**
 * Capstone acceptance e2e — full buy vertical (Task 7.1).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives
 * the complete happy-path buy:
 *
 *   1. Inbound WhatsApp webhook (signed with X-Hub-Signature-256)
 *      → ConversationService → AgentPort(fake) → ProposalService → DirectiveService
 *      → sender.sendFlow (captured by fake sender) — extracts flow_token + nonce.
 *   2. WhatsApp Flow data-exchange (RSA-OAEP/AES-128-GCM E2E encrypted, real keys)
 *      → FlowCryptoService(real) → ExecutionService(real) → Transaction(settling)
 *      → SUCCESS screen with VA — decrypted by test using same key + flipped IV.
 *   3. Flutterwave webhook (verif-hash auth)
 *      → ExecutionService.settleBuyPayment → ledger settled → receipt minted
 *      → fakeSender.sendText receives text containing the receipt number.
 *   4. Idempotent replay: second identical Flutterwave webhook → ledger entry count
 *      unchanged (no double-credit).
 *
 * CRITICAL: env vars MUST be set in process.env BEFORE AppModule is imported,
 * because ConfigModule.forRoot() calls validateEnv() synchronously at class
 * decoration time (when the module file is first required). We achieve this by
 * using a dynamic import() of AppModule inside beforeAll, AFTER setting all vars.
 *
 * PrismaClient, supertest, and other helpers that do NOT transitively import
 * AppModule CAN be imported statically at the top of this file — they are not
 * affected by the ConfigModule side-effect issue.
 *
 * Fakes ONLY the external edges:
 *   - LLM_PROVIDER  → always returns buy_crypto intent (extractIntent)
 *   - WALLET_PROVIDER → fake provisionAddress + getBalance
 *   - PAYMENT_PROVIDER → fake createCollection + verify + verifyWebhookSignature
 *   - WHATSAPP_SENDER → fake capturing sendFlow / sendText calls
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
import type { LlmProvider } from '../src/modules/agent/core/ports/llm-provider.port';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';
import type {
  IWhatsAppSender,
  SendFlowInput,
} from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_ROOT = join(__dirname, '..');
const TEST_PHONE = '2348001112233'; // E.164 without '+'
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-buy';
const WA_APP_SECRET = 'e2e-capstone-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-capstone';
const DIRECTIVE_SIGNING_KEY = 'e2e-capstone-directive-key-32bytes!';
const FLUTTERWAVE_WEBHOOK_SECRET = 'e2e-flw-webhook-secret-capstone';
const WA_FLOW_ID = 'flow-id-e2e-capstone-test';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-fake';

const FAKE_WALLET_ADDRESS = 'TBuyVerticalFakeWalletAddr12345678';
const FAKE_BLOCKRADAR_REF = 'fake_blockradar_ref_buy_vertical_e2e';
const FAKE_ACCOUNT_NUMBER = '0081234567';
const FAKE_BANK_NAME = 'Buy Vertical Test MFB';
const FAKE_FLW_REF = 'flw_fake_ref_buy_vertical_001';

// ---------------------------------------------------------------------------
// Module-level vars set in beforeAll (dynamic import avoidance)
// ---------------------------------------------------------------------------

let testPublicKeyPem: string;

// ---------------------------------------------------------------------------
// Fake-sender call captures (reset in beforeEach)
// ---------------------------------------------------------------------------

interface CapturedSendText {
  to: string;
  body: string;
}
interface CapturedSendFlow {
  input: SendFlowInput;
}

let capturedSendTextCalls: CapturedSendText[] = [];
let capturedSendFlowCalls: CapturedSendFlow[] = [];

// ---------------------------------------------------------------------------
// Meta-style Flow encrypt helper
// (identical pattern to flow-crypto.service.spec.ts — kept local here)
// ---------------------------------------------------------------------------

function encryptLikeMeta(
  publicKeyPem: string,
  plaintext: unknown,
): {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
  rawAesKey: Buffer;
  rawIv: Buffer;
} {
  const aesKey = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);

  const encrypted_aes_key = crypto
    .publicEncrypt(
      {
        key: publicKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      aesKey,
    )
    .toString('base64');

  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(plaintext), 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    encrypted_flow_data: Buffer.concat([body, tag]).toString('base64'),
    encrypted_aes_key,
    initial_vector: iv.toString('base64'),
    rawAesKey: aesKey,
    rawIv: iv,
  };
}

/**
 * Decrypts a base64 Flow response with the same AES key + bit-flipped IV,
 * exactly as the WhatsApp client would after receiving our encrypted response.
 */
function decryptFlowResponse(
  base64Response: string,
  aesKey: Buffer,
  originalIv: Buffer,
): unknown {
  const flippedIv = Buffer.from(originalIv.map((b) => ~b & 0xff));
  const raw = Buffer.from(base64Response, 'base64');
  const tag = raw.subarray(-16);
  const body = raw.subarray(0, -16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, flippedIv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(body),
    decipher.final(),
  ]).toString('utf-8');
  return JSON.parse(plaintext) as unknown;
}

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
 * Builds a realistic WhatsApp inbound webhook payload for a text message.
 */
function buildInboundWebhookPayload(params: {
  from: string;
  messageId: string;
  text: string;
  phoneNumberId: string;
}): object {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'e2e-entry-id',
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
                { profile: { name: 'E2E Test User' }, wa_id: params.from },
              ],
              messages: [
                {
                  from: params.from,
                  id: params.messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: params.text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Decimal-to-scaled helper (same pattern as settlement-buy.e2e-spec.ts)
// ---------------------------------------------------------------------------

const LEDGER_SCALE = 10n ** 18n;

function toScaledBigInt(s: string): bigint {
  const str = s.trim();
  const isNeg = str.startsWith('-');
  const abs = isNeg ? str.slice(1) : str;
  const [whole = '0', frac = ''] = abs.split('.');
  const fracPadded = frac.slice(0, 18).padEnd(18, '0');
  const scaled = BigInt(whole) * LEDGER_SCALE + BigInt(fracPadded);
  return isNeg ? -scaled : scaled;
}

// ===========================================================================
// THE TEST SUITE
// ===========================================================================

describe('Buy vertical — capstone acceptance e2e (AppModule, Testcontainers Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stopContainer: () => Promise<void>;
  let userId: string;
  let fakeLlmProvider: jest.Mocked<LlmProvider>;
  let fakeWalletProvider: jest.Mocked<IWalletProvider>;
  let fakePaymentProvider: jest.Mocked<IPaymentProvider>;
  let fakeSender: jest.Mocked<IWhatsAppSender>;

  // ── beforeAll: set env → import AppModule → boot → seed ────────────────────

  beforeAll(async () => {
    // 0. Generate RSA-2048 keypair FIRST (pure crypto, no env needed)
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    testPublicKeyPem = publicKey;

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
      // Pass the real PEM with actual newlines so FlowCryptoService can decrypt
      WHATSAPP_FLOW_PRIVATE_KEY: privateKey,
      WHATSAPP_FLOW_ID: WA_FLOW_ID,
      DIRECTIVE_SIGNING_KEY,
      RECEIPT_SIGNING_KEY: 'e2e-buy-vertical-receipt-signing-key-32b!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e',
      FLUTTERWAVE_WEBHOOK_SECRET,
    });
    // Ensure ANTHROPIC_API_KEY is absent (not empty string) to pass optional validation
    delete process.env.ANTHROPIC_API_KEY;

    // 3. Dynamic import of AppModule (happens AFTER env vars are set above).
    //    Deferring this import is essential: ConfigModule.forRoot() calls
    //    validateEnv() synchronously when the module file is first required.
    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    // 4. Build fake providers with correct interface shapes
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
    };

    fakePaymentProvider = {
      createCollection: jest.fn().mockResolvedValue({
        accountNumber: FAKE_ACCOUNT_NUMBER,
        bankName: FAKE_BANK_NAME,
        providerRef: FAKE_FLW_REF,
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '5000',
        currency: 'NGN',
        providerRef: FAKE_FLW_REF,
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest
        .fn()
        .mockImplementation(
          (header: unknown) => header === FLUTTERWAVE_WEBHOOK_SECRET,
        ),
    };

    fakeSender = {
      sendText: jest.fn().mockImplementation((to: string, body: string) => {
        capturedSendTextCalls.push({ to, body });
        return Promise.resolve({ externalMessageId: 'wamid.out.text.e2e' });
      }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.e2e' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.e2e' }),
      sendFlow: jest.fn().mockImplementation((input: SendFlowInput) => {
        capturedSendFlowCalls.push({ input });
        return Promise.resolve({ externalMessageId: 'wamid.out.flow.e2e' });
      }),
      sendBeneficiaryFlow: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.ben.flow.e2e' }),
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

    // 6. Seed: Tier-1 KYC-verified User + PIN + WhatsApp ChannelIdentity
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
    capturedSendTextCalls = [];
    capturedSendFlowCalls = [];
    jest.clearAllMocks();

    // Re-apply implementations after clearAllMocks clears return values
    fakeLlmProvider.extractIntent.mockResolvedValue({
      action: 'buy_crypto',
      asset: 'USDT',
      fiatAmount: '5000',
      fiatCurrency: 'NGN',
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

    fakePaymentProvider.createCollection.mockResolvedValue({
      accountNumber: FAKE_ACCOUNT_NUMBER,
      bankName: FAKE_BANK_NAME,
      providerRef: FAKE_FLW_REF,
    });
    fakePaymentProvider.verify.mockResolvedValue({
      status: 'successful',
      amount: '5000',
      currency: 'NGN',
      providerRef: FAKE_FLW_REF,
    });
    fakePaymentProvider.verifyWebhookSignature.mockImplementation(
      (header: unknown) => header === FLUTTERWAVE_WEBHOOK_SECRET,
    );

    fakeSender.sendText.mockImplementation((to: string, body: string) => {
      capturedSendTextCalls.push({ to, body });
      return Promise.resolve({ externalMessageId: 'wamid.out.text.e2e' });
    });
    fakeSender.sendFlow.mockImplementation(
      (input: CapturedSendFlow['input']) => {
        capturedSendFlowCalls.push({ input });
        return Promise.resolve({ externalMessageId: 'wamid.out.flow.e2e' });
      },
    );
    fakeSender.sendTemplate.mockResolvedValue({
      externalMessageId: 'wamid.out.tmpl.e2e',
    });
  });

  // ===========================================================================
  // MAIN TEST — full buy vertical happy path + idempotent replay
  // ===========================================================================

  it('full buy vertical: inbound webhook → Flow PIN → Flutterwave settlement → receipt; idempotent replay', async () => {
    const messageId = `wamid.e2e.buy.${Date.now()}`;

    // ───────────────────────────────────────────────────────────────────────
    // STEP 1 — POST /whatsapp/webhook (HMAC-SHA256 signed)
    // ───────────────────────────────────────────────────────────────────────

    const inboundPayload = buildInboundWebhookPayload({
      from: TEST_PHONE,
      messageId,
      text: 'buy 5000 naira of usdt',
      phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
    });
    const rawBodyBuf = Buffer.from(JSON.stringify(inboundPayload));
    const signature = buildWhatsAppSignature(WA_APP_SECRET, rawBodyBuf);

    const webhookRes = await supertest(app.getHttpServer())
      .post('/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(inboundPayload);

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body).toEqual({ status: 'received' });

    // ConversationMessage persisted
    const msg = await prisma.conversationMessage.findUnique({
      where: { externalMessageId: messageId },
    });
    expect(msg).not.toBeNull();
    expect(msg!.processingStatus).toBe('processed');

    // MessageIntent(buy_crypto) persisted
    const intent = await prisma.messageIntent.findUnique({
      where: { messageId: msg!.id },
    });
    expect(intent).not.toBeNull();
    expect(intent!.action).toBe('buy_crypto');

    // Proposal(pending) persisted
    const proposal = await prisma.proposal.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.status).toBe('pending');

    // Fake sender received sendFlow (Flow path, WHATSAPP_FLOW_ID set)
    expect(capturedSendFlowCalls).toHaveLength(1);
    const sendFlowInput = capturedSendFlowCalls[0].input;
    expect(sendFlowInput.to).toBe(TEST_PHONE);
    expect(sendFlowInput.flowId).toBe(WA_FLOW_ID);

    // Extract flow_token and nonce from the captured sendFlow call
    const flowToken = sendFlowInput.flowToken;
    const flowDataPayload = sendFlowInput.data;
    const capturedNonce = flowDataPayload.nonce as string;
    const capturedProposalId = flowDataPayload.proposalId as string;

    expect(flowToken).toBeTruthy();
    expect(capturedNonce).toBeTruthy();
    expect(capturedProposalId).toBe(proposal!.id);

    // ───────────────────────────────────────────────────────────────────────
    // STEP 2 — POST /whatsapp/flow (E2E-encrypted PIN submission)
    // ───────────────────────────────────────────────────────────────────────

    const flowPayload = {
      version: '3.0',
      action: 'data_exchange',
      screen: 'PIN',
      flow_token: flowToken,
      data: {
        pin: '123456',
        nonce: capturedNonce,
      },
    };

    const {
      encrypted_flow_data,
      encrypted_aes_key,
      initial_vector,
      rawAesKey,
      rawIv,
    } = encryptLikeMeta(testPublicKeyPem, flowPayload);

    const flowRes = await supertest(app.getHttpServer())
      .post('/whatsapp/flow')
      .set('Content-Type', 'application/json')
      .send({ encrypted_flow_data, encrypted_aes_key, initial_vector });

    expect(flowRes.status).toBe(200);

    // Decrypt response with same key + flipped IV (exactly as Meta client would)
    const decryptedResponse = decryptFlowResponse(
      flowRes.text,
      rawAesKey,
      rawIv,
    ) as { screen: string; data: Record<string, unknown> };

    // Assert SUCCESS screen with VA details
    expect(decryptedResponse.screen).toBe('SUCCESS');
    expect(decryptedResponse.data.accountNumber).toBe(FAKE_ACCOUNT_NUMBER);
    expect(decryptedResponse.data.bankName).toBe(FAKE_BANK_NAME);

    // Transaction(status=settling) exists for this proposal
    const transaction = await prisma.transaction.findFirst({
      where: { proposalId: capturedProposalId },
    });
    expect(transaction).not.toBeNull();
    expect(transaction!.status).toBe('settling');
    const transactionId = transaction!.id;

    // idempotencyKey = proposalId (per WhatsAppFlowController.handleDataExchange)
    const txRef = capturedProposalId;

    // ───────────────────────────────────────────────────────────────────────
    // STEP 3 — POST /webhooks/flutterwave (payment settlement)
    // ───────────────────────────────────────────────────────────────────────

    const flwBody = {
      event: 'charge.completed',
      data: {
        status: 'successful',
        tx_ref: txRef,
        amount: 5000,
        currency: 'NGN',
        flw_ref: FAKE_FLW_REF,
        customer: {
          email: `user+${userId}@handshake.internal`,
          name: 'E2E Test User',
        },
      },
    };

    const flwRes = await supertest(app.getHttpServer())
      .post('/webhooks/flutterwave')
      .set('verif-hash', FLUTTERWAVE_WEBHOOK_SECRET)
      .send(flwBody);

    expect(flwRes.status).toBe(200);
    expect(flwRes.body).toEqual({ status: 'ok' });

    // Transaction now completed
    const completedTxn = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    expect(completedTxn).not.toBeNull();
    expect(completedTxn!.status).toBe('completed');
    expect(completedTxn!.completedAt).not.toBeNull();

    // LedgerEntry rows balanced per currency (sum === 0)
    const ledgerEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId },
    });
    expect(ledgerEntries.length).toBeGreaterThanOrEqual(4); // ≥ 2 NGN + 2 USDT

    const byCurrency: Record<string, bigint> = {};
    for (const entry of ledgerEntries) {
      const currency = entry.currency;
      const amt = toScaledBigInt(entry.amount.toString());
      byCurrency[currency] = (byCurrency[currency] ?? 0n) + amt;
    }

    for (const [currency, sum] of Object.entries(byCurrency)) {
      expect({ currency, balanced: sum === 0n }).toEqual({
        currency,
        balanced: true,
      });
    }
    expect(Object.keys(byCurrency)).toContain('NGN');
    expect(Object.keys(byCurrency)).toContain('USDT');

    // Receipt row minted
    const receipt = await prisma.receipt.findUnique({
      where: { transactionId },
    });
    expect(receipt).not.toBeNull();
    expect(receipt!.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);
    expect(receipt!.signatureHash).toBeTruthy();
    expect(receipt!.userId).toBe(userId);

    // Fake sender received sendText containing the receipt number
    expect(capturedSendTextCalls.length).toBeGreaterThanOrEqual(1);
    const receiptTextCall = capturedSendTextCalls.find((c) =>
      c.body.includes(receipt!.receiptNumber),
    );
    expect(receiptTextCall).toBeDefined();
    expect(receiptTextCall!.to).toBe(TEST_PHONE);

    // ───────────────────────────────────────────────────────────────────────
    // STEP 4 — Idempotent replay: second identical Flutterwave webhook
    // ───────────────────────────────────────────────────────────────────────

    const ledgerCountBefore = await prisma.ledgerEntry.count({
      where: { transactionId },
    });
    capturedSendTextCalls = [];

    const flwRes2 = await supertest(app.getHttpServer())
      .post('/webhooks/flutterwave')
      .set('verif-hash', FLUTTERWAVE_WEBHOOK_SECRET)
      .send(flwBody);

    expect(flwRes2.status).toBe(200);
    expect(flwRes2.body).toEqual({ status: 'ok' });

    // Ledger count MUST NOT have grown (idempotent — no double-credit)
    const ledgerCountAfter = await prisma.ledgerEntry.count({
      where: { transactionId },
    });
    expect(ledgerCountAfter).toBe(ledgerCountBefore);
  }, 170_000);
});
