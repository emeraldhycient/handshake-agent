/**
 * Capstone acceptance e2e — outbound vertical: SELL + SEND (Task W2).
 *
 * Boots the REAL AppModule (Testcontainers Postgres) via supertest and drives
 * the complete happy-path for both sell and send transactions:
 *
 * SELL FLOW:
 *   1. Inbound WhatsApp webhook (signed with X-Hub-Signature-256)
 *      → ConversationService → AgentPort(fake sell_crypto intent)
 *      → ProposalService.createSellProposal → DirectiveService
 *      → sender.sendFlow (captured by fake sender) — extracts flow_token + nonce.
 *   2. WhatsApp Flow data-exchange (RSA-OAEP/AES-128-GCM E2E encrypted, real keys)
 *      → FlowCryptoService(real) → ExecutionService.executeSell → Transaction(settling)
 *      → SUCCESS screen — decrypted by test using same key + flipped IV.
 *   3. POST /webhooks/flutterwave with signed transfer.completed body (status=SUCCESSFUL)
 *      → FlutterwaveWebhookController.handleTransferCompleted
 *      → ExecutionService.settleSellPayout(reference=proposalId)
 *      → Transaction(completed) + balanced finalize ledger + Receipt.
 *      → fakeSender.sendText receives text containing the receipt number.
 *
 * SEND FLOW:
 *   1. Inbound WhatsApp webhook (signed) with send_crypto intent.
 *   2. WhatsApp Flow data-exchange (PIN) → ExecutionService.executeSend
 *      → Transaction(settling) + withdraw called.
 *   3. POST /webhooks/blockradar with signed withdraw.success body (reference=proposalId)
 *      → BlockradarWebhookController.handleWithdrawEvent
 *      → ExecutionService.settleSendOnChain(reference=proposalId, success=true)
 *      → Transaction(completed) + balanced ledger + Receipt with on-chain txHash
 *      → fakeSender.sendText notified.
 *
 * Fakes ONLY the external edges:
 *   - LLM_PROVIDER  → sell_crypto or send_crypto intent per test
 *   - WALLET_PROVIDER → fake provisionAddress + getBalance + withdraw
 *   - PAYMENT_PROVIDER → fake createPayout + verifyPayout (sell)
 *   - WHATSAPP_SENDER → fake capturing sendFlow / sendText calls
 *
 * Requires Docker. Runs only in the test:e2e lane (jest-e2e.json).
 */

import * as crypto from 'crypto';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

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
import { AssetRegistry } from '../src/core/catalog/asset-registry';
import { seedRegistryAssets } from './helpers/seed-registry-assets';
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
const TEST_PHONE = '2348009876543'; // E.164 without '+'
const WHATSAPP_PHONE_NUMBER_ID = 'test-pnid-e2e-outbound';
const WA_APP_SECRET = 'e2e-outbound-app-secret-123';
const WA_VERIFY_TOKEN = 'e2e-verify-token-outbound';
const DIRECTIVE_SIGNING_KEY = 'e2e-outbound-directive-key-32bytes!';
const FLUTTERWAVE_WEBHOOK_SECRET = 'e2e-flw-webhook-secret-outbound';
const WA_FLOW_ID = 'flow-id-e2e-outbound-test';
const WA_ACCESS_TOKEN = 'e2e-wa-access-token-fake-outbound';

const FAKE_WALLET_ADDRESS = 'TOutboundFakeWalletAddr12345678901';
const FAKE_BLOCKRADAR_REF = 'fake_blockradar_ref_outbound_e2e';
const FAKE_FLW_PAYOUT_REF = 'flw_fake_payout_outbound_e2e_001';
const FAKE_SEND_PROVIDER_REF = 'blockradar_send_tx_ref_outbound_e2e';
const FAKE_ON_CHAIN_TX_HASH = 'tron_tx_hash_outbound_e2e_001';

// All TRON addresses must be exactly 34 chars (T + 33 chars, valid base58 — no 0, O, I, l).
const VALID_TRON_CRYPTO_ADDRESS = 'TSendE2EBeneficiaryTronAddress1234';

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
// (identical pattern to buy-vertical.e2e-spec.ts — kept local here)
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
        id: 'e2e-entry-id-outbound',
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
                  profile: { name: 'E2E Outbound Test User' },
                  wa_id: params.from,
                },
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

/**
 * Builds the x-blockradar-signature header: lowercase hex HMAC-SHA512 of the
 * raw JSON body keyed by BLOCKRADAR_API_KEY (no prefix — raw hex only).
 */
function buildBlockradarSignature(apiKey: string, rawBody: Buffer): string {
  return crypto.createHmac('sha512', apiKey).update(rawBody).digest('hex');
}

// ---------------------------------------------------------------------------
// Decimal-to-scaled helper (same pattern as buy-vertical.e2e-spec.ts)
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

describe('Outbound vertical — capstone acceptance e2e (SELL + SEND, AppModule, Testcontainers Postgres)', () => {
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
    //    at module decoration time (when the module file is first required).
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
      RECEIPT_SIGNING_KEY: 'e2e-outbound-vertical-receipt-signing-key-32b!',
      BLOCKRADAR_API_KEY: 'fake-blockradar-key-e2e-outbound',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-wallet-id-e2e-outbound',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-secret-key-e2e-outbound',
      FLUTTERWAVE_WEBHOOK_SECRET,
    });
    // Ensure ANTHROPIC_API_KEY is absent (not empty string) to pass optional validation
    delete process.env.ANTHROPIC_API_KEY;

    // 3. Dynamic import of AppModule (happens AFTER env vars are set above).
    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    // 4. Build fake providers with correct interface shapes
    fakeLlmProvider = {
      extractIntent: jest.fn().mockResolvedValue({
        action: 'sell_crypto',
        asset: 'USDT',
        cryptoAmount: '5',
        fiatCurrency: 'NGN',
      }),
    };

    fakeWalletProvider = {
      provisionAddress: jest.fn().mockResolvedValue({
        address: FAKE_WALLET_ADDRESS,
        providerReference: FAKE_BLOCKRADAR_REF,
        network: 'TRON',
      }),
      getBalance: jest.fn().mockResolvedValue({ amount: '100', decimals: 6 }),
      withdraw: jest.fn().mockResolvedValue({
        providerReference: FAKE_SEND_PROVIDER_REF,
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
        accountNumber: '0081234567',
        bankName: 'Test MFB',
        providerRef: 'flw_collection_unused',
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '8000',
        currency: 'NGN',
        providerRef: 'flw_collection_unused',
      }),
      createPayout: jest.fn().mockResolvedValue({
        providerRef: FAKE_FLW_PAYOUT_REF,
        status: 'pending' as const,
      }),
      verifyPayout: jest.fn().mockResolvedValue({
        status: 'successful' as const,
        amount: '7840',
        currency: 'NGN',
        providerRef: FAKE_FLW_PAYOUT_REF,
      }),
      verifyWebhookSignature: jest
        .fn()
        .mockImplementation(
          (header: unknown) => header === FLUTTERWAVE_WEBHOOK_SECRET,
        ),
    };

    fakeSender = {
      sendText: jest.fn().mockImplementation((to: string, body: string) => {
        capturedSendTextCalls.push({ to, body });
        return Promise.resolve({
          externalMessageId: 'wamid.out.text.outbound',
        });
      }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl.outbound' }),
      sendCtaUrl: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.out.cta.outbound' }),
      sendFlow: jest.fn().mockImplementation((input: SendFlowInput) => {
        capturedSendFlowCalls.push({ input });
        return Promise.resolve({
          externalMessageId: 'wamid.out.flow.outbound',
        });
      }),
      sendBeneficiaryFlow: jest.fn().mockResolvedValue({
        externalMessageId: 'wamid.out.ben.flow.outbound',
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
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    seedRegistryAssets(app.get(AssetRegistry, { strict: false }));

    // 6. Seed: Tier-1 KYC-verified User + PIN + WhatsApp ChannelIdentity
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

    // 7. Seed: provision USDT wallet and credit it with 100 USDT
    //    so the user has balance for sell (5 USDT) + send (3 USDT) + fees.
    const { WalletService } =
      await import('../src/modules/wallets/application/wallet.service');
    const walletService = moduleRef.get(WalletService);
    const wallet = await walletService.getOrProvisionNetworkWallet(
      userId,
      'TRON',
    );

    // Seed 100 USDT via a completed-buy transaction + ledger credit.
    const seedTxn = await prisma.transaction.create({
      data: {
        userId,
        type: 'buy',
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: 'seed',
        fxRateSnapshot: '1600',
        metadata: {},
        pinVerifiedAt: new Date(),
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        transactionId: seedTxn.id,
        accountType: 'user_wallet',
        accountId: wallet.id,
        currency: 'USDT',
        direction: 'credit',
        amount: '100.000000',
        description: 'outbound e2e seed credit',
        balanceAfter: '100.000000',
        sequence: 1,
        postedAt: new Date(),
      },
    });

    // 8. Seed: bank beneficiary (default) for sell
    //    First bank account is automatically set as default by the repo.
    const { BeneficiaryService } =
      await import('../src/modules/beneficiaries/application/beneficiary.service');
    const beneficiaryService = moduleRef.get(BeneficiaryService);

    await beneficiaryService.addBankAccount({
      userId,
      label: 'My Bank Account',
      accountNumber: '0123456789',
      bankCode: '044',
      accountName: 'Outbound Test User',
    });

    // 9. Seed: crypto beneficiary (default) for send, cooling-off cleared.
    const cryptoBen = await beneficiaryService.addCryptoAddress({
      userId,
      label: 'My TRON Wallet',
      address: VALID_TRON_CRYPTO_ADDRESS,
      network: 'TRON',
      asset: 'USDT',
    });

    // Clear cooling-off so it is immediately usable.
    await prisma.beneficiary.update({
      where: { id: cryptoBen.id },
      data: { firstUseLockedUntil: null, isDefault: true },
    });

    // 10. Fix G: seed a bound Device and pin it to the user (§3.4).
    // executeSend resolves the acting device from User.pinnedDeviceId when no
    // explicit deviceId is provided in the WhatsApp Flow callback payload.
    const device = await prisma.device.create({
      data: {
        userId,
        fingerprint: `outbound-e2e-device-${randomUUID()}`,
        trustState: 'bound',
        boundAt: new Date(),
      },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { pinnedDeviceId: device.id },
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

    // Re-apply default sell intent after clearAllMocks clears return values
    fakeLlmProvider.extractIntent.mockResolvedValue({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '5',
      fiatCurrency: 'NGN',
    });

    fakeWalletProvider.provisionAddress.mockResolvedValue({
      address: FAKE_WALLET_ADDRESS,
      providerReference: FAKE_BLOCKRADAR_REF,
      network: 'TRON',
    });
    fakeWalletProvider.getBalance.mockResolvedValue({
      amount: '100',
      decimals: 6,
    });
    fakeWalletProvider.withdraw.mockResolvedValue({
      providerReference: FAKE_SEND_PROVIDER_REF,
      status: 'pending' as const,
    });

    fakePaymentProvider.createPayout.mockResolvedValue({
      providerRef: FAKE_FLW_PAYOUT_REF,
      status: 'pending' as const,
    });
    fakePaymentProvider.verifyPayout.mockResolvedValue({
      status: 'successful' as const,
      amount: '7840',
      currency: 'NGN',
      providerRef: FAKE_FLW_PAYOUT_REF,
    });
    fakePaymentProvider.verifyWebhookSignature.mockImplementation(
      (header: unknown) => header === FLUTTERWAVE_WEBHOOK_SECRET,
    );

    fakeSender.sendText.mockImplementation((to: string, body: string) => {
      capturedSendTextCalls.push({ to, body });
      return Promise.resolve({ externalMessageId: 'wamid.out.text.outbound' });
    });
    fakeSender.sendFlow.mockImplementation(
      (input: CapturedSendFlow['input']) => {
        capturedSendFlowCalls.push({ input });
        return Promise.resolve({
          externalMessageId: 'wamid.out.flow.outbound',
        });
      },
    );
    fakeSender.sendTemplate.mockResolvedValue({
      externalMessageId: 'wamid.out.tmpl.outbound',
    });
    fakeSender.sendBeneficiaryFlow.mockResolvedValue({
      externalMessageId: 'wamid.out.ben.flow.outbound',
    });
  });

  // ===========================================================================
  // SELL TEST — full sell vertical: webhook → Flow PIN → settlement → receipt
  // ===========================================================================

  it('full SELL vertical: inbound webhook → Flow PIN → settlement → receipt', async () => {
    const sellMessageId = `wamid.e2e.sell.${Date.now()}`;

    // ───────────────────────────────────────────────────────────────────────
    // STEP 1 — POST /whatsapp/webhook (HMAC-SHA256 signed) with sell intent
    // ───────────────────────────────────────────────────────────────────────

    fakeLlmProvider.extractIntent.mockResolvedValue({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '5',
      fiatCurrency: 'NGN',
    });

    const inboundPayload = buildInboundWebhookPayload({
      from: TEST_PHONE,
      messageId: sellMessageId,
      text: 'sell 5 usdt',
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
      where: { externalMessageId: sellMessageId },
    });
    expect(msg).not.toBeNull();
    expect(msg!.processingStatus).toBe('processed');

    // MessageIntent(sell_crypto) persisted
    const intent = await prisma.messageIntent.findUnique({
      where: { messageId: msg!.id },
    });
    expect(intent).not.toBeNull();
    expect(intent!.action).toBe('sell_crypto');

    // Proposal(sell, pending) persisted
    const proposal = await prisma.proposal.findFirst({
      where: { userId, type: 'sell' },
      orderBy: { createdAt: 'desc' },
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.status).toBe('pending');
    expect(proposal!.type).toBe('sell');

    // Fake sender received sendFlow (sell confirmation Flow)
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
    // STEP 2 — POST /whatsapp/flow (E2E-encrypted PIN submission for sell)
    // ───────────────────────────────────────────────────────────────────────

    const flowPayload = {
      version: '3.0',
      action: 'data_exchange',
      screen: 'SELL_CONFIRM',
      flow_token: flowToken,
      data: {
        pin: '194837',
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

    // Assert SUCCESS screen with sell details
    expect(decryptedResponse.screen).toBe('SUCCESS');
    expect(decryptedResponse.data.transactionId).toBeTruthy();
    expect(decryptedResponse.data.providerRef).toBe(FAKE_FLW_PAYOUT_REF);

    // Transaction(sell, settling) exists for this proposal
    const settlingTxn = await prisma.transaction.findFirst({
      where: { proposalId: capturedProposalId },
    });
    expect(settlingTxn).not.toBeNull();
    expect(settlingTxn!.status).toBe('settling');
    expect(settlingTxn!.type).toBe('sell');
    const sellTransactionId = settlingTxn!.id;

    // Reserve ledger: 2 USDT entries (user_wallet debit + clearing credit)
    const reserveEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: sellTransactionId, currency: 'USDT' },
    });
    expect(reserveEntries.length).toBeGreaterThanOrEqual(2);

    // Double-entry invariant on the reserve entries
    const reserveSum = reserveEntries.reduce(
      (s, e) => s + toScaledBigInt(e.amount.toString()),
      0n,
    );
    expect(reserveSum).toBe(0n);

    // ───────────────────────────────────────────────────────────────────────
    // STEP 3 — Settlement: POST /webhooks/flutterwave with transfer.completed
    //
    // The idempotencyKey = proposalId (per whatsapp-flow.controller.ts
    // executeByType → executeSell). Flutterwave calls us with data.reference =
    // the idempotencyKey we passed to createPayout (SUCCESSFUL = uppercase).
    // verif-hash header = the FLUTTERWAVE_WEBHOOK_SECRET constant.
    // ───────────────────────────────────────────────────────────────────────

    const flwWebhookBody = {
      event: 'transfer.completed',
      data: {
        status: 'SUCCESSFUL',
        reference: capturedProposalId,
      },
    };

    const flwWebhookRes = await supertest(app.getHttpServer())
      .post('/webhooks/flutterwave')
      .set('Content-Type', 'application/json')
      .set('verif-hash', FLUTTERWAVE_WEBHOOK_SECRET)
      .send(flwWebhookBody);

    expect(flwWebhookRes.status).toBe(200);
    expect(flwWebhookRes.body).toEqual({ status: 'ok' });

    // Transaction(sell, completed) — settlement is awaited inside the handler
    // before the 200 is returned, so the DB write should already be done.
    // Poll briefly as a safety net against any async edge.
    let completedTxn: Awaited<
      ReturnType<typeof prisma.transaction.findUnique>
    > = null;
    for (let i = 0; i < 20; i++) {
      completedTxn = await prisma.transaction.findUnique({
        where: { id: sellTransactionId },
      });
      if (completedTxn?.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(completedTxn).not.toBeNull();
    expect(completedTxn!.status).toBe('completed');
    expect(completedTxn!.completedAt).not.toBeNull();

    // Balanced finalize ledger — per-currency signed amounts must sum to 0.
    const allSellEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: sellTransactionId },
    });
    expect(allSellEntries.length).toBeGreaterThanOrEqual(4); // ≥ 2 USDT reserve + 2 USDT finalize

    const sellByCurrency: Record<string, bigint> = {};
    for (const entry of allSellEntries) {
      const currency = entry.currency;
      const amt = toScaledBigInt(entry.amount.toString());
      sellByCurrency[currency] = (sellByCurrency[currency] ?? 0n) + amt;
    }

    for (const [currency, sum] of Object.entries(sellByCurrency)) {
      expect({ currency, balanced: sum === 0n }).toEqual({
        currency,
        balanced: true,
      });
    }
    // Sell involves USDT (reserve + finalize) and NGN (payout ledger)
    expect(Object.keys(sellByCurrency)).toContain('USDT');

    // Receipt row minted — settlement ran in the webhook handler (async inside ack-then-process),
    // so we poll briefly for the DB write to land.
    let sellReceipt: Awaited<ReturnType<typeof prisma.receipt.findUnique>> =
      null;
    for (let i = 0; i < 20; i++) {
      sellReceipt = await prisma.receipt.findUnique({
        where: { transactionId: sellTransactionId },
      });
      if (sellReceipt) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(sellReceipt).not.toBeNull();
    expect(sellReceipt!.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);
    expect(sellReceipt!.signatureHash).toBeTruthy();
    expect(sellReceipt!.userId).toBe(userId);

    // SettlementOutbox completed
    const sellOutbox = await prisma.settlementOutbox.findFirst({
      where: { transactionId: sellTransactionId },
    });
    expect(sellOutbox?.status).toBe('completed');

    // Fake sender received sell receipt on WhatsApp.
    // The notifySellComplete uses identityService.findWhatsAppAddress + whatsAppSender.sendText.
    const sellReceiptTextCall = capturedSendTextCalls.find((c) =>
      c.body.includes(sellReceipt!.receiptNumber),
    );
    expect(sellReceiptTextCall).toBeDefined();
    expect(sellReceiptTextCall!.to).toBe(TEST_PHONE);
  }, 170_000);

  // ===========================================================================
  // SEND TEST — full send vertical: webhook → Flow PIN → settlement → receipt
  // ===========================================================================

  it('full SEND vertical: inbound webhook → Flow PIN → settlement → receipt + on-chain txHash', async () => {
    const sendMessageId = `wamid.e2e.send.${Date.now()}`;

    // Override LLM to return send_crypto intent for this test
    fakeLlmProvider.extractIntent.mockResolvedValue({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '3',
      network: 'TRON',
    });

    // ───────────────────────────────────────────────────────────────────────
    // STEP 1 — POST /whatsapp/webhook (HMAC-SHA256 signed) with send intent
    // ───────────────────────────────────────────────────────────────────────

    const inboundPayload = buildInboundWebhookPayload({
      from: TEST_PHONE,
      messageId: sendMessageId,
      text: 'send 3 usdt',
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
      where: { externalMessageId: sendMessageId },
    });
    expect(msg).not.toBeNull();
    expect(msg!.processingStatus).toBe('processed');

    // MessageIntent(send_crypto) persisted
    const intent = await prisma.messageIntent.findUnique({
      where: { messageId: msg!.id },
    });
    expect(intent).not.toBeNull();
    expect(intent!.action).toBe('send_crypto');

    // Proposal(send, pending) persisted
    const proposal = await prisma.proposal.findFirst({
      where: { userId, type: 'send' },
      orderBy: { createdAt: 'desc' },
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.status).toBe('pending');
    expect(proposal!.type).toBe('send');

    // Fake sender received sendFlow (send confirmation Flow)
    expect(capturedSendFlowCalls).toHaveLength(1);
    const sendFlowInput = capturedSendFlowCalls[0].input;
    expect(sendFlowInput.to).toBe(TEST_PHONE);
    expect(sendFlowInput.flowId).toBe(WA_FLOW_ID);

    // Extract flow_token and nonce
    const flowToken = sendFlowInput.flowToken;
    const flowDataPayload = sendFlowInput.data;
    const capturedNonce = flowDataPayload.nonce as string;
    const capturedProposalId = flowDataPayload.proposalId as string;

    expect(flowToken).toBeTruthy();
    expect(capturedNonce).toBeTruthy();
    expect(capturedProposalId).toBe(proposal!.id);

    // ───────────────────────────────────────────────────────────────────────
    // STEP 2 — POST /whatsapp/flow (E2E-encrypted PIN submission for send)
    // ───────────────────────────────────────────────────────────────────────

    const flowPayload = {
      version: '3.0',
      action: 'data_exchange',
      screen: 'SEND_CONFIRM',
      flow_token: flowToken,
      data: {
        pin: '194837',
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

    // Decrypt response
    const decryptedResponse = decryptFlowResponse(
      flowRes.text,
      rawAesKey,
      rawIv,
    ) as { screen: string; data: Record<string, unknown> };

    // Assert SUCCESS screen with send details
    expect(decryptedResponse.screen).toBe('SUCCESS');
    expect(decryptedResponse.data.transactionId).toBeTruthy();
    expect(decryptedResponse.data.txRef).toBe(FAKE_SEND_PROVIDER_REF);

    // Transaction(send, settling) exists for this proposal
    const settlingTxn = await prisma.transaction.findFirst({
      where: { proposalId: capturedProposalId },
    });
    expect(settlingTxn).not.toBeNull();
    expect(settlingTxn!.status).toBe('settling');
    expect(settlingTxn!.type).toBe('send');
    const sendTransactionId = settlingTxn!.id;

    // wallet.withdraw was called (on-chain send dispatched)
    expect(fakeWalletProvider.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({
        toAddress: VALID_TRON_CRYPTO_ADDRESS,
      }),
    );

    // Reserve ledger: 2 USDT entries (user_wallet debit + send_clearing credit)
    const reserveEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: sendTransactionId, currency: 'USDT' },
    });
    expect(reserveEntries.length).toBeGreaterThanOrEqual(2);

    const reserveSum = reserveEntries.reduce(
      (s, e) => s + toScaledBigInt(e.amount.toString()),
      0n,
    );
    expect(reserveSum).toBe(0n);

    // SettlementOutbox(onchain_send, pending) exists
    const sendOutbox = await prisma.settlementOutbox.findFirst({
      where: { transactionId: sendTransactionId },
    });
    expect(sendOutbox).not.toBeNull();
    expect(sendOutbox!.settlementType).toBe('onchain_send');
    expect(sendOutbox!.status).toBe('pending');

    // ───────────────────────────────────────────────────────────────────────
    // STEP 3 — Settlement: POST /webhooks/blockradar with withdraw.success
    //
    // The idempotencyKey = proposalId (per whatsapp-flow.controller.ts
    // executeByType → executeSend). Blockradar calls us with data.reference =
    // the idempotencyKey we passed to withdraw(), data.hash = on-chain txHash.
    // x-blockradar-signature = HMAC-SHA512(BLOCKRADAR_API_KEY, rawBody) — raw hex.
    // ───────────────────────────────────────────────────────────────────────

    const blockradarWebhookBody = {
      event: 'withdraw.success',
      data: {
        reference: capturedProposalId,
        hash: FAKE_ON_CHAIN_TX_HASH,
        amount: '3.0',
        asset: { symbol: 'USDT', network: { name: 'TRON' } },
      },
    };
    const blockradarRawBody = Buffer.from(
      JSON.stringify(blockradarWebhookBody),
    );
    const blockradarSig = buildBlockradarSignature(
      'fake-blockradar-key-e2e-outbound',
      blockradarRawBody,
    );

    const blockradarWebhookRes = await supertest(app.getHttpServer())
      .post('/webhooks/blockradar')
      .set('Content-Type', 'application/json')
      .set('x-blockradar-signature', blockradarSig)
      .send(blockradarWebhookBody);

    expect(blockradarWebhookRes.status).toBe(200);
    expect(blockradarWebhookRes.body).toEqual({ status: 'ok' });

    // Transaction(send, completed) — settlement ran async inside the webhook handler,
    // so poll briefly to let the DB write land.
    let completedTxn: Awaited<
      ReturnType<typeof prisma.transaction.findUnique>
    > = null;
    for (let i = 0; i < 20; i++) {
      completedTxn = await prisma.transaction.findUnique({
        where: { id: sendTransactionId },
      });
      if (completedTxn?.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(completedTxn).not.toBeNull();
    expect(completedTxn!.status).toBe('completed');
    expect(completedTxn!.completedAt).not.toBeNull();

    // Balanced finalize ledger — per-currency signed amounts must sum to 0.
    const allSendEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: sendTransactionId },
    });
    expect(allSendEntries.length).toBeGreaterThanOrEqual(4); // ≥ 2 USDT reserve + 3 USDT finalize

    const sendByCurrency: Record<string, bigint> = {};
    for (const entry of allSendEntries) {
      const currency = entry.currency;
      const amt = toScaledBigInt(entry.amount.toString());
      sendByCurrency[currency] = (sendByCurrency[currency] ?? 0n) + amt;
    }

    for (const [currency, sum] of Object.entries(sendByCurrency)) {
      expect({ currency, balanced: sum === 0n }).toEqual({
        currency,
        balanced: true,
      });
    }
    // Send is USDT-only — no NGN entries.
    expect(Object.keys(sendByCurrency)).toContain('USDT');
    expect(Object.keys(sendByCurrency)).not.toContain('NGN');

    // Receipt row minted — poll for the async write.
    let sendReceipt: Awaited<ReturnType<typeof prisma.receipt.findUnique>> =
      null;
    for (let i = 0; i < 20; i++) {
      sendReceipt = await prisma.receipt.findUnique({
        where: { transactionId: sendTransactionId },
      });
      if (sendReceipt) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(sendReceipt).not.toBeNull();
    expect(sendReceipt!.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);
    expect(sendReceipt!.signatureHash).toBeTruthy();
    expect(sendReceipt!.userId).toBe(userId);

    // On-chain txHash stored in Transaction.processorTxRef (settleSendFinalizeAtomic)
    const sendCompletedTxn = await prisma.transaction.findUnique({
      where: { id: sendTransactionId },
    });
    expect(sendCompletedTxn!.processorTxRef).toBe(FAKE_ON_CHAIN_TX_HASH);

    // SettlementOutbox completed
    const completedOutbox = await prisma.settlementOutbox.findFirst({
      where: { transactionId: sendTransactionId },
    });
    expect(completedOutbox?.status).toBe('completed');

    // Fake sender received send receipt on WhatsApp
    const sendReceiptTextCall = capturedSendTextCalls.find((c) =>
      c.body.includes(sendReceipt!.receiptNumber),
    );
    expect(sendReceiptTextCall).toBeDefined();
    expect(sendReceiptTextCall!.to).toBe(TEST_PHONE);
  }, 170_000);
});
