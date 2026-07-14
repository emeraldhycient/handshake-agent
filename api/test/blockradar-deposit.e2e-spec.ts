/**
 * Integration test for BlockradarWebhookController (R2 — deposit webhook).
 *
 * Tests the full deposit-settlement loop:
 *   1. Seed a User + Wallet (with a known on-chain address).
 *   2. Seed a WhatsApp ChannelIdentity for the user.
 *   3. POST a signed Blockradar deposit.success webhook.
 *   4. Assert:
 *      - LedgerEntry rows inserted (exactly 2: user_wallet + clearing).
 *      - LedgerEntry amounts are balanced (signed sum = 0 per currency).
 *      - WalletBalance row created with the credited amount.
 *      - DepositConfirmation(txHash) row inserted with status=confirmed.
 *      - Anchor Transaction row has type='deposit' (not 'reward').
 *      - A Receipt row exists with non-empty signatureHash and receiptNumber.
 *      - Fake WhatsApp sender received the receipt text (contains amount,
 *        asset symbol, network, txHash short, new balance, receiptNumber).
 *   5. Second distinct deposit → receipt text shows RUNNING balance (sum of both).
 *   6. Replay same txHash (idempotency):
 *      - No second LedgerEntry/WalletBalance/DepositConfirmation/Receipt rows.
 *      - Fake sender NOT called again.
 *   7. Invalid signature → 401, nothing written.
 *
 * Wiring is manual (no Nest DI). Requires Docker.
 * Runs only in the `test:e2e` lane (jest-e2e.json).
 */

import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { startTestPostgres } from './helpers/pg-testcontainer';

// Repos
import { WalletPrismaRepository } from '../src/modules/wallets/infrastructure/wallet.prisma.repository';
import { DepositSettlementPrismaRepository } from '../src/modules/wallets/infrastructure/deposit-settlement.prisma.repository';
import { IdentityPrismaRepository } from '../src/modules/identity/infrastructure/identity.prisma.repository';

// Services
import { IdentityService } from '../src/modules/identity/application/identity.service';
import { AssetRegistry } from '../src/core/catalog/asset-registry';

// Handler under test — settlement moved off the (now thin) controller onto the
// async worker handler; signature verification is unit-tested on the controller.
import { BlockradarWebhookHandler } from '../src/modules/wallets/application/blockradar-webhook.handler';
import type { WebhookEventRecord } from '../src/modules/webhooks/application/ports/webhook-event.repository.port';

// Ports/types
import type { PrismaService } from '../src/core/prisma/prisma.service';
import type {
  IWhatsAppSender,
  SendResult,
} from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';

// Crypto (signature generation)

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
// Stub ConfigService
// ---------------------------------------------------------------------------

const appConfig = configuration();
const BLOCKRADAR_API_KEY = 'e2e-blockradar-api-key-test';

class StubConfigService {
  get<T = unknown>(key: string): T {
    if (key === 'BLOCKRADAR_API_KEY') return BLOCKRADAR_API_KEY as T;
    if (key === 'RECEIPT_SIGNING_KEY')
      return 'e2e-blockradar-deposit-receipt-signing-key!!' as T;
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
// Fake WhatsApp sender
// ---------------------------------------------------------------------------

let capturedSentMessages: Array<{ to: string; body: string }> = [];

const fakeSender: IWhatsAppSender = {
  sendText: jest
    .fn()
    .mockImplementation((to: string, body: string): Promise<SendResult> => {
      capturedSentMessages.push({ to, body });
      return Promise.resolve({ externalMessageId: 'wamid.fake-deposit-e2e' });
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
  sendBeneficiaryFlow: jest
    .fn()
    .mockResolvedValue({ externalMessageId: 'wamid.fake-ben-flow' }),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEPOSIT_ADDRESS = 'TDepositE2EAddress1234567890123';
const DEPOSIT_AMOUNT = '10.5';
const ASSET_SYMBOL = 'USDT';
const NETWORK_NAME = 'TRON';

function buildDepositBody(txHash: string, amount = DEPOSIT_AMOUNT) {
  return {
    event: 'deposit.success',
    data: {
      hash: txHash,
      amount,
      recipientAddress: DEPOSIT_ADDRESS,
      senderAddress: 'TSenderAddress1234567890123456789',
      asset: {
        symbol: ASSET_SYMBOL,
        network: { name: NETWORK_NAME },
      },
      confirmations: 20,
      status: 'confirmed',
      id: `webhook-id-${txHash.slice(0, 8)}`,
    },
  };
}

/** Wrap a webhook body in a persisted WebhookEvent record (what the worker sees). */
function makeEvent(body: Record<string, unknown>): WebhookEventRecord {
  return {
    id: `wh-${randomUUID()}`,
    provider: 'blockradar',
    providerEventId: `evt-${randomUUID()}`,
    payload: body,
    headers: {},
    signature: null,
    status: 'processing',
    attempts: 1,
    lastError: null,
    receivedAt: new Date(),
    lastAttemptAt: new Date(),
    processedAt: null,
    deadAt: null,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('BlockradarWebhookController (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let handler: BlockradarWebhookHandler;

  let userId: string;
  let walletId: string;
  let waAddress: string;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    const ps = prisma as unknown as PrismaService;
    const config = new StubConfigService() as never;

    // Wire repos.
    const walletRepo = new WalletPrismaRepository(ps);
    const assetRegistry = new AssetRegistry(config);
    const settlementRepo = new DepositSettlementPrismaRepository(
      ps,
      config,
      assetRegistry,
    );
    const identityRepo = new IdentityPrismaRepository(ps);

    // Wire services.
    const identityService = new IdentityService(identityRepo);

    // Wire controller.
    // ExecutionService is only used for withdraw.success/failed events; deposit
    // e2e tests do not exercise those paths so a minimal stub is sufficient here.
    const fakeExecutionService = {
      settleSendOnChain: jest.fn().mockResolvedValue({ status: 'pending' }),
    };

    handler = new BlockradarWebhookHandler(
      walletRepo,
      settlementRepo,
      identityService,
      fakeSender,
      assetRegistry,
      fakeExecutionService as never,
    );

    // Seed: User → Wallet → WhatsApp ChannelIdentity.
    const user = await prisma.user.create({
      data: {
        kycStatus: 'verified',
        kycTier: 'tier_1',
        status: 'active',
      },
    });
    userId = user.id;

    const wallet = await prisma.wallet.create({
      data: {
        userId,
        network: 'TRON',
        address: DEPOSIT_ADDRESS,
        providerReference: 'blockradar-ref-e2e-001',
        status: 'active',
        provisionedAt: new Date(),
      },
    });
    walletId = wallet.id;

    waAddress = '2348090000099';
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

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('happy path: LedgerEntry rows balanced, WalletBalance credited, DepositConfirmation confirmed, Transaction type=deposit, Receipt minted, WhatsApp receipt sent', async () => {
    const txHash = `0x${randomUUID().replace(/-/g, '')}`;
    const body = buildDepositBody(txHash);

    await handler.handle(makeEvent(body));

    // ── LedgerEntry assertions ──────────────────────────────────────────────

    // We expect exactly 2 entries: user_wallet (credit) + clearing (debit).
    const entries = await prisma.ledgerEntry.findMany({
      where: { accountId: { in: [walletId, 'usdt_external_deposits'] } },
    });

    expect(entries).toHaveLength(2);

    // Balanced: signed amounts sum to 0.
    const sum = entries.reduce((acc, e) => {
      const scaled = Math.round(parseFloat(e.amount.toString()) * 1e6);
      return acc + scaled;
    }, 0);
    expect(sum).toBe(0);

    // User wallet entry is a credit.
    const userEntry = entries.find((e) => e.accountId === walletId);
    expect(userEntry).toBeDefined();
    expect(userEntry!.direction).toBe('credit');
    expect(userEntry!.currency).toBe('USDT');

    // Clearing entry is a debit.
    const clearingEntry = entries.find(
      (e) => e.accountId === 'usdt_external_deposits',
    );
    expect(clearingEntry).toBeDefined();
    expect(clearingEntry!.direction).toBe('debit');

    // ── Anchor Transaction: type must be 'deposit', not 'reward' ───────────

    const txnId = userEntry!.transactionId;
    const txn = await prisma.transaction.findUnique({ where: { id: txnId } });
    expect(txn).not.toBeNull();
    expect(txn!.type).toBe('deposit');
    expect(txn!.status).toBe('completed');

    // ── Receipt assertions ──────────────────────────────────────────────────

    const receipt = await prisma.receipt.findUnique({
      where: { transactionId: txnId },
    });
    expect(receipt).not.toBeNull();
    expect(receipt!.receiptNumber).toBeTruthy();
    expect(receipt!.signatureHash).toBeTruthy();
    expect(receipt!.signatureHash.length).toBeGreaterThan(0);
    expect(receipt!.contentHash).toBeTruthy();
    // Itemized must describe a deposit.
    const itemized = receipt!.itemized as Record<string, unknown>;
    expect(itemized.type).toBe('deposit');
    expect(itemized.txHash).toBe(txHash);

    // ── WalletBalance assertion ─────────────────────────────────────────────

    const balance = await prisma.walletBalance.findFirst({
      where: { walletId },
      orderBy: { syncedAt: 'desc' },
    });
    expect(balance).not.toBeNull();
    expect(parseFloat(balance!.amount.toString())).toBe(
      parseFloat(DEPOSIT_AMOUNT),
    );
    expect(balance!.source).toBe('deposit_webhook');

    // ── DepositConfirmation assertion ───────────────────────────────────────

    const confirmation = await prisma.depositConfirmation.findUnique({
      where: { txHash },
    });
    expect(confirmation).not.toBeNull();
    expect(confirmation!.status).toBe('confirmed');
    expect(confirmation!.walletId).toBe(walletId);
    expect(parseFloat(confirmation!.amount.toString())).toBe(
      parseFloat(DEPOSIT_AMOUNT),
    );
    expect(confirmation!.confirmedAt).not.toBeNull();

    // ── WhatsApp receipt assertion ──────────────────────────────────────────

    expect(capturedSentMessages).toHaveLength(1);
    expect(capturedSentMessages[0].to).toBe(waAddress);

    const text = capturedSentMessages[0].body;
    expect(text).toContain(DEPOSIT_AMOUNT); // amount in receipt
    expect(text).toContain('USDT'); // asset
    expect(text).toContain('TRON'); // network
    expect(text).toContain(txHash.slice(0, 8)); // short hash
    expect(text).toContain(receipt!.receiptNumber); // receipt number referenced
  });

  // ── Running balance: second deposit shows SUM of prior + new amount ────────

  it('second deposit: WhatsApp receipt shows RUNNING balance (sum of prior + new deposit)', async () => {
    // First deposit (may have been seeded by previous test in the suite, but we
    // use a fresh distinct txHash to ensure this test is self-contained).
    const txHash1 = `0x${randomUUID().replace(/-/g, '')}`;
    const amount1 = '5.0';
    const body1 = buildDepositBody(txHash1, amount1);
    await handler.handle(makeEvent(body1));

    capturedSentMessages = [];

    // Second deposit with a different amount.
    const txHash2 = `0x${randomUUID().replace(/-/g, '')}`;
    const amount2 = '3.0';
    const body2 = buildDepositBody(txHash2, amount2);
    await handler.handle(makeEvent(body2));

    expect(capturedSentMessages).toHaveLength(1);
    const text2 = capturedSentMessages[0].body;

    // The WhatsApp receipt for the second deposit should show a balance GREATER
    // than amount2 alone — it should reflect the running ledger balance.
    // Parse "New balance:" line from the receipt.
    const newBalanceLine = text2
      .split('\n')
      .find((l) => l.startsWith('New balance:'));
    expect(newBalanceLine).toBeDefined();

    // Extract the numeric portion after "New balance: " and before " USDT".
    const balanceStr = newBalanceLine!
      .replace('New balance:', '')
      .trim()
      .split(' ')[0];
    const balanceNum = parseFloat(balanceStr);

    // Balance must be greater than just the second deposit amount — it must
    // include prior deposits (running sum in the ledger).
    expect(balanceNum).toBeGreaterThan(parseFloat(amount2));
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('idempotent: second webhook with same txHash does NOT double-credit', async () => {
    const txHash = `0x${randomUUID().replace(/-/g, '')}`;
    const body = buildDepositBody(txHash);
    // Reuse the same event so a re-delivery is exercised; settleDepositAtomic
    // dedups on txHash regardless of the webhook-event id.
    const event = makeEvent(body);

    // First call.
    await handler.handle(event);

    const ledgerCountAfterFirst = await prisma.ledgerEntry.count({
      where: { accountId: { in: [walletId, 'usdt_external_deposits'] } },
    });
    const balanceCountAfterFirst = await prisma.walletBalance.count({
      where: { walletId },
    });
    const confirmationCountAfterFirst = await prisma.depositConfirmation.count({
      where: { walletId },
    });
    const receiptCountAfterFirst = await prisma.receipt.count({
      where: { userId },
    });

    // Reset captured messages.
    capturedSentMessages = [];

    // Second identical call.
    await handler.handle(event);

    // Nothing new should have been created.
    const ledgerCountAfterSecond = await prisma.ledgerEntry.count({
      where: { accountId: { in: [walletId, 'usdt_external_deposits'] } },
    });
    expect(ledgerCountAfterSecond).toBe(ledgerCountAfterFirst);

    const balanceCountAfterSecond = await prisma.walletBalance.count({
      where: { walletId },
    });
    expect(balanceCountAfterSecond).toBe(balanceCountAfterFirst);

    const confirmationCountAfterSecond = await prisma.depositConfirmation.count(
      { where: { walletId } },
    );
    expect(confirmationCountAfterSecond).toBe(confirmationCountAfterFirst);

    // No second Receipt.
    const receiptCountAfterSecond = await prisma.receipt.count({
      where: { userId },
    });
    expect(receiptCountAfterSecond).toBe(receiptCountAfterFirst);

    // No second WhatsApp message.
    expect(capturedSentMessages).toHaveLength(0);
  });

  // ── TRX deposit regression (asset columns TEXT, not enum) ────────────────
  //
  // Before the 20260629200000_asset_columns_text_dynamic_catalog migration the
  // `wallet_balances.asset` column was a Postgres enum (`supported_asset` with
  // values USDT and BTC). Any Blockradar-discovered asset NOT in that enum —
  // e.g. TRX — would cause:
  //   "Invalid value for argument 'asset'. Expected SupportedAsset."
  // The column is now TEXT, validated at the app layer by AssetRegistry.
  // This test proves a TRX deposit credits WalletBalance with asset='TRX'.

  it('TRX deposit: WalletBalance is created with asset="TRX" (TEXT column, not enum)', async () => {
    // Merge TRX as a discovered asset so AssetRegistry accepts it.
    const assetRegistry = new AssetRegistry(new StubConfigService());
    assetRegistry.mergeDiscoveredAssets([
      {
        assetId: 'mock-trx-asset-id',
        symbol: 'TRX',
        name: 'TRON',
        network: 'TRON',
        contractAddress: null,
        decimals: 6,
        isMainnet: false,
      },
    ]);

    // Re-wire the controller with the updated registry.
    const ps = prisma as unknown as PrismaService;
    const config = new StubConfigService() as never;
    const walletRepo = new WalletPrismaRepository(ps);
    const settlementRepo = new DepositSettlementPrismaRepository(
      ps,
      config,
      assetRegistry,
    );
    const identityRepo = new IdentityPrismaRepository(ps);
    const identityService = new IdentityService(identityRepo);
    const fakeExecutionService = {
      settleSendOnChain: jest.fn().mockResolvedValue({ status: 'pending' }),
    };
    const trxHandler = new BlockradarWebhookHandler(
      walletRepo,
      settlementRepo,
      identityService,
      fakeSender,
      assetRegistry,
      fakeExecutionService as never,
    );

    const txHash = `0x${randomUUID().replace(/-/g, '')}`;
    const body = {
      event: 'deposit.success',
      data: {
        hash: txHash,
        amount: '50',
        recipientAddress: DEPOSIT_ADDRESS,
        senderAddress: 'TSenderAddress1234567890123456789',
        asset: { symbol: 'TRX', network: { name: NETWORK_NAME } },
        confirmations: 20,
        status: 'confirmed',
        id: `webhook-id-${txHash.slice(0, 8)}`,
      },
    };
    await trxHandler.handle(makeEvent(body));

    // The regression: WalletBalance must be created with asset='TRX'
    // (before the fix this threw "Invalid value for argument 'asset'. Expected SupportedAsset.")
    const balance = await prisma.walletBalance.findFirst({
      where: { walletId, asset: 'TRX' },
      orderBy: { syncedAt: 'desc' },
    });
    expect(balance).not.toBeNull();
    expect(balance!.asset).toBe('TRX');
    expect(parseFloat(balance!.amount.toString())).toBe(50);
  });

  // Signature verification (bad sig → 401) is unit-tested on the thin controller
  // (blockradar-webhook.controller.spec.ts); the handler here runs on an already-
  // verified, persisted WebhookEvent, so there is no signature to reject.
});
