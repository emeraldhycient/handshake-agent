/**
 * Integration test for FlutterwaveWebhookController (Task 6.4).
 *
 * Tests the full buy-settlement loop triggered by a Flutterwave webhook:
 *   1. Seed a settling Transaction (via executeBuy with fakes).
 *   2. Seed a User with a WhatsApp ChannelIdentity.
 *   3. POST the webhook with a valid verif-hash and charge.completed body.
 *   4. Assert:
 *      - Transaction.status becomes 'completed'.
 *      - A Receipt row exists.
 *      - The fake WhatsApp sender received the receipt text.
 *   5. Idempotency: second identical POST does NOT double-credit
 *      (ledger entry count unchanged).
 *
 * Wiring is manual (no Nest DI), consistent with the other e2e specs.
 * A real NestJS app with a Supertest HTTP client is NOT used because the
 * controller depends on a NestJS DI context — we wire it manually via the
 * actual FlutterwaveWebhookController class and call handleWebhook() directly.
 *
 * Requires Docker. Runs only in the `test:e2e` lane (jest-e2e.json).
 */

import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { startTestPostgres } from './helpers/pg-testcontainer';

// Repos
import { ProposalPrismaRepository } from '../src/modules/transactions/infrastructure/proposal.prisma.repository';
import { QuotePrismaRepository } from '../src/modules/transactions/infrastructure/quote.prisma.repository';
import { DirectivePrismaRepository } from '../src/modules/transactions/infrastructure/directive.prisma.repository';
import { TransactionPrismaRepository } from '../src/modules/transactions/infrastructure/transaction.prisma.repository';
import { SettlementOutboxPrismaRepository } from '../src/modules/transactions/infrastructure/settlement-outbox.prisma.repository';
import { SettlementPrismaRepository } from '../src/modules/transactions/infrastructure/settlement.prisma.repository';
import { PinPrismaRepository } from '../src/core/auth/infrastructure/pin.prisma.repository';
import { IdentityPrismaRepository } from '../src/modules/identity/infrastructure/identity.prisma.repository';
import { VelocityPrismaRepository } from '../src/modules/identity/infrastructure/velocity.prisma.repository';
import { WalletPrismaRepository } from '../src/modules/wallets/infrastructure/wallet.prisma.repository';

// Services
import { PinService } from '../src/core/auth/pin.service';
import { DirectiveService } from '../src/modules/transactions/application/directive.service';
import { ProposalService } from '../src/modules/transactions/application/proposal.service';
import { ExecutionService } from '../src/modules/transactions/application/execution.service';
import { KycGateService } from '../src/modules/identity/application/kyc-gate.service';
import { QuotesService } from '../src/modules/quotes/application/quotes.service';
import { WalletService } from '../src/modules/wallets/application/wallet.service';
import { IdentityService } from '../src/modules/identity/application/identity.service';
import { ConfigRateProvider } from '../src/modules/quotes/infrastructure/config-rate.provider';
import { AssetRegistry } from '../src/core/catalog/asset-registry';

// Controller under test
import { FlutterwaveWebhookController } from '../src/modules/treasury/presentation/flutterwave-webhook.controller';

// Ports/types
import type { PrismaService } from '../src/core/prisma/prisma.service';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';
import type {
  IWhatsAppSender,
  SendResult,
} from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';

// Config defaults
import configuration from '../src/core/config/configuration';

jest.setTimeout(300_000);

// ---------------------------------------------------------------------------
// Suppress NestJS logger noise in e2e output
// ---------------------------------------------------------------------------

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

// ---------------------------------------------------------------------------
// Fake ConfigService
// ---------------------------------------------------------------------------

const appConfig = configuration();
const WEBHOOK_SECRET = 'e2e-webhook-secret';
const DIRECTIVE_KEY = 'e2e-webhook-test-signing-key-32-bytes!';

class StubConfigService {
  get<T = unknown>(key: string): T {
    if (key === 'DIRECTIVE_SIGNING_KEY') return DIRECTIVE_KEY as T;
    if (key === 'FLUTTERWAVE_WEBHOOK_SECRET') return WEBHOOK_SECRET as T;
    const parts = key.split('.');
    let val: unknown = appConfig;
    for (const part of parts) {
      if (val === null || typeof val !== 'object') return undefined as T;
      val = (val as Record<string, unknown>)[part];
    }
    return val as T;
  }
}

// ---------------------------------------------------------------------------
// Fake external providers
// ---------------------------------------------------------------------------

const FAKE_WALLET_ADDRESS = 'TFakeWebhookWalletAddress123456';
const FAKE_BLOCKRADAR_REF = 'fake_blockradar_ref_webhook_e2e';
const FAKE_FLW_REF = 'flw_fake_ref_webhook_e2e_001';
const FAKE_ACCOUNT_NUMBER = '0123456789';
const FAKE_BANK_NAME = 'Test Webhook Bank';

const fakeWalletProvider: IWalletProvider = {
  provisionAddress: jest.fn().mockResolvedValue({
    address: FAKE_WALLET_ADDRESS,
    providerReference: FAKE_BLOCKRADAR_REF,
  }),
  getBalance: jest.fn().mockResolvedValue({
    available: '0',
    pending: '0',
    asset: 'USDT',
    network: 'TRON',
  }),
};

// Payment provider: verifyWebhookSignature does constant-time equality
// For tests, we wire a real-enough fake that checks the header value.
let capturedSentMessages: Array<{ to: string; body: string }> = [];

const fakeSender: IWhatsAppSender = {
  sendText: jest
    .fn()
    .mockImplementation((to: string, body: string): Promise<SendResult> => {
      capturedSentMessages.push({ to, body });
      return Promise.resolve({ externalMessageId: 'wamid.fake-e2e' });
    }),
  sendTemplate: jest
    .fn()
    .mockResolvedValue({ externalMessageId: 'wamid.fake-template' }),
  sendCtaUrl: jest
    .fn()
    .mockResolvedValue({ externalMessageId: 'wamid.fake-cta' }),
  sendFlow: jest
    .fn()
    .mockResolvedValue({ externalMessageId: 'wamid.fake-flow' }),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('FlutterwaveWebhookController (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  let executionService: ExecutionService;
  let directiveService: DirectiveService;
  let proposalService: ProposalService;
  let identityService: IdentityService;
  let pinService: PinService;
  let controller: FlutterwaveWebhookController;

  let fakePaymentProvider: IPaymentProvider;

  let userId: string;
  let waAddress: string;
  const clock = { now: () => new Date() };

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    const ps = prisma as unknown as PrismaService;
    const config = new StubConfigService() as never;

    // Wire repos.
    const proposalRepo = new ProposalPrismaRepository(ps);
    const quoteRepo = new QuotePrismaRepository(ps);
    const directiveRepo = new DirectivePrismaRepository(ps);
    const transactionRepo = new TransactionPrismaRepository(ps);
    const outboxRepo = new SettlementOutboxPrismaRepository(ps);
    const settlementRepo = new SettlementPrismaRepository(ps, config);
    const pinRepo = new PinPrismaRepository(ps);
    const identityRepo = new IdentityPrismaRepository(ps);
    const velocityRepo = new VelocityPrismaRepository(ps);
    const walletRepo = new WalletPrismaRepository(ps);

    // Wire services.
    const rateProvider = new ConfigRateProvider(config);
    const quotesService = new QuotesService(rateProvider, clock);
    const kycGateService = new KycGateService(
      identityRepo,
      velocityRepo,
      config,
      clock,
    );
    pinService = new PinService(pinRepo, config, clock);
    directiveService = new DirectiveService(directiveRepo, config, clock);
    const assetRegistry = new AssetRegistry(config);
    const walletService = new WalletService(
      fakeWalletProvider,
      walletRepo,
      clock,
      assetRegistry,
    );
    identityService = new IdentityService(identityRepo);

    proposalService = new ProposalService(
      quotesService,
      kycGateService,
      quoteRepo,
      proposalRepo,
      clock,
    );

    // Payment provider fake: verifyWebhookSignature checks WEBHOOK_SECRET;
    // verify re-confirms the payment (always successful in tests).
    fakePaymentProvider = {
      createCollection: jest.fn().mockResolvedValue({
        accountNumber: FAKE_ACCOUNT_NUMBER,
        bankName: FAKE_BANK_NAME,
        providerRef: FAKE_FLW_REF,
      }),
      verify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: '10000',
        currency: 'NGN',
        providerRef: FAKE_FLW_REF,
      }),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest
        .fn()
        .mockImplementation(
          (header: string | string[] | undefined) => header === WEBHOOK_SECRET,
        ),
    };

    executionService = new ExecutionService(
      proposalRepo,
      quoteRepo,
      transactionRepo,
      outboxRepo,
      settlementRepo,
      quotesService,
      kycGateService,
      directiveService,
      pinService,
      walletService,
      fakePaymentProvider,
      config,
      clock,
      assetRegistry,
    );

    // Wire the controller under test.
    controller = new FlutterwaveWebhookController(
      fakePaymentProvider,
      executionService,
      identityService,
      fakeSender,
    );

    // Seed a verified user with a PIN.
    const user = await prisma.user.create({
      data: {
        kycStatus: 'verified',
        kycTier: 'tier_1',
        status: 'active',
      },
    });
    userId = user.id;
    await pinService.setPin(userId, '123456');

    // Seed a WhatsApp ChannelIdentity for the user.
    waAddress = '2348090000001';
    await prisma.channelIdentity.create({
      data: {
        channel: 'whatsapp',
        channelAddress: waAddress,
        userId,
      },
    });
  });

  afterAll(async () => {
    await stop?.();
  });

  beforeEach(() => {
    capturedSentMessages = [];
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function seedSettlingTransaction(): Promise<{
    transactionId: string;
    reference: string;
  }> {
    const proposalResult = await proposalService.createBuyProposal({
      userId,
      intent: {
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount: '10000',
        fiatCurrency: 'NGN',
      },
    });

    const { directiveId, nonce } = await directiveService.issue({
      proposalId: proposalResult.proposalId,
      userId,
      ref: 'request_pin',
    });

    const idempotencyKey = randomUUID();

    const result = await executionService.executeBuy({
      userId,
      proposalId: proposalResult.proposalId,
      directiveId,
      nonce,
      pin: '123456',
      idempotencyKey,
    });

    return { transactionId: result.transactionId, reference: idempotencyKey };
  }

  function buildWebhookRequest() {
    return {
      headers: { 'verif-hash': WEBHOOK_SECRET },
    };
  }

  function buildWebhookBody(txRef: string) {
    return {
      event: 'charge.completed',
      data: {
        status: 'successful',
        tx_ref: txRef,
        amount: 10000,
        currency: 'NGN',
        customer: {
          email: `user+${userId}@handshake.internal`,
          name: 'Handshake User',
        },
        flw_ref: FAKE_FLW_REF,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  it('happy path: Transaction completed, Receipt exists, WhatsApp receipt sent', async () => {
    const { transactionId, reference } = await seedSettlingTransaction();

    const req = buildWebhookRequest();
    const body = buildWebhookBody(reference);

    const result = await controller.handleWebhook(body, req as any);

    expect(result).toEqual({ status: 'ok' });

    // Transaction must be completed.
    const txn = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    expect(txn).not.toBeNull();
    expect(txn!.status).toBe('completed');
    expect(txn!.completedAt).not.toBeNull();

    // Receipt must exist.
    const receipt = await prisma.receipt.findUnique({
      where: { transactionId },
    });
    expect(receipt).not.toBeNull();
    expect(receipt!.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);

    // WhatsApp sender received the receipt text.
    expect(capturedSentMessages).toHaveLength(1);
    expect(capturedSentMessages[0].to).toBe(waAddress);
    expect(capturedSentMessages[0].body).toContain(receipt!.receiptNumber);
  });

  // ---------------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------------

  it('idempotent: second identical POST does not double-credit (ledger count unchanged)', async () => {
    const { transactionId, reference } = await seedSettlingTransaction();

    const req = buildWebhookRequest();
    const body = buildWebhookBody(reference);

    // First webhook.
    await controller.handleWebhook(body, req as any);

    const ledgerCountAfterFirst = await prisma.ledgerEntry.count({
      where: { transactionId },
    });

    const wallet = await prisma.wallet.findFirst({
      where: { userId, asset: 'USDT' },
    });
    const balanceCountAfterFirst = await prisma.walletBalance.count({
      where: { walletId: wallet!.id },
    });

    capturedSentMessages = []; // reset captured messages

    // Second identical webhook.
    const secondResult = await controller.handleWebhook(body, req as any);
    expect(secondResult).toEqual({ status: 'ok' });

    // Ledger and WalletBalance must not have grown.
    const ledgerCountAfterSecond = await prisma.ledgerEntry.count({
      where: { transactionId },
    });
    expect(ledgerCountAfterSecond).toBe(ledgerCountAfterFirst);

    const balanceCountAfterSecond = await prisma.walletBalance.count({
      where: { walletId: wallet!.id },
    });
    expect(balanceCountAfterSecond).toBe(balanceCountAfterFirst);
  });

  // ---------------------------------------------------------------------------
  // Signature check
  // ---------------------------------------------------------------------------

  it('invalid verif-hash → throws 401, Transaction stays in settling', async () => {
    const { transactionId, reference } = await seedSettlingTransaction();

    const badReq = { headers: { 'verif-hash': 'wrong-secret' } };
    const body = buildWebhookBody(reference);

    await expect(
      controller.handleWebhook(body, badReq as any),
    ).rejects.toMatchObject({ status: 401 });

    // Transaction must still be 'settling'.
    const txn = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    expect(txn!.status).toBe('settling');
  });
});
