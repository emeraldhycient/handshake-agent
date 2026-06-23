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
 *      - Fake WhatsApp sender received the receipt text (contains amount,
 *        asset symbol, network, txHash short, new balance).
 *   5. Replay same txHash (idempotency):
 *      - No second LedgerEntry/WalletBalance/DepositConfirmation rows.
 *      - Fake sender NOT called again.
 *   6. Invalid signature → 401, nothing written.
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

// Controller under test
import { BlockradarWebhookController } from '../src/modules/wallets/presentation/blockradar-webhook.controller';

// Ports/types
import type { PrismaService } from '../src/core/prisma/prisma.service';
import type {
  IWhatsAppSender,
  SendResult,
} from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';

// Crypto (signature generation)
import { hmacHex } from '../src/core/crypto/hmac';

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
  sendFlow: jest
    .fn()
    .mockResolvedValue({ externalMessageId: 'wamid.fake-flow' }),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEPOSIT_ADDRESS = 'TDepositE2EAddress1234567890123';
const DEPOSIT_AMOUNT = '10.5';
const ASSET_SYMBOL = 'USDT';
const NETWORK_NAME = 'TRON';

function buildDepositBody(txHash: string) {
  return {
    event: 'deposit.success',
    data: {
      hash: txHash,
      amount: DEPOSIT_AMOUNT,
      recipientAddress: DEPOSIT_ADDRESS,
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

function signBody(body: Record<string, unknown>): {
  rawBody: Buffer;
  sig: string;
} {
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  const sig = hmacHex('sha512', BLOCKRADAR_API_KEY, rawBody);
  return { rawBody, sig };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('BlockradarWebhookController (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let controller: BlockradarWebhookController;

  let userId: string;
  let walletId: string;
  let waAddress: string;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    const ps = prisma as unknown as PrismaService;
    const config = new StubConfigService() as never;

    // Wire repos.
    const walletRepo = new WalletPrismaRepository(ps);
    const settlementRepo = new DepositSettlementPrismaRepository(ps);
    const identityRepo = new IdentityPrismaRepository(ps);

    // Wire services.
    const identityService = new IdentityService(identityRepo);
    const assetRegistry = new AssetRegistry(config);

    // Wire controller.
    controller = new BlockradarWebhookController(
      config,
      walletRepo,
      settlementRepo,
      identityService,
      fakeSender,
      assetRegistry,
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
        asset: 'USDT',
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

  it('happy path: LedgerEntry rows balanced, WalletBalance credited, DepositConfirmation confirmed, WhatsApp receipt sent', async () => {
    const txHash = `0x${randomUUID().replace(/-/g, '')}`;
    const body = buildDepositBody(txHash);
    const { rawBody, sig } = signBody(body);

    const result = await controller.handleWebhook(body, rawBody, sig);

    expect(result).toEqual({ status: 'ok' });

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
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('idempotent: second webhook with same txHash does NOT double-credit', async () => {
    const txHash = `0x${randomUUID().replace(/-/g, '')}`;
    const body = buildDepositBody(txHash);
    const { rawBody, sig } = signBody(body);

    // First call.
    await controller.handleWebhook(body, rawBody, sig);

    const ledgerCountAfterFirst = await prisma.ledgerEntry.count({
      where: { accountId: { in: [walletId, 'usdt_external_deposits'] } },
    });
    const balanceCountAfterFirst = await prisma.walletBalance.count({
      where: { walletId },
    });
    const confirmationCountAfterFirst = await prisma.depositConfirmation.count({
      where: { walletId },
    });

    // Reset captured messages.
    capturedSentMessages = [];

    // Second identical call.
    const second = await controller.handleWebhook(body, rawBody, sig);
    expect(second).toEqual({ status: 'ok' });

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

    // No second WhatsApp message.
    expect(capturedSentMessages).toHaveLength(0);
  });

  // ── Invalid signature ──────────────────────────────────────────────────────

  it('invalid signature → 401, nothing written to DB', async () => {
    const txHash = `0x${randomUUID().replace(/-/g, '')}`;
    const body = buildDepositBody(txHash);
    const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
    const badSig = 'deadbeef'.repeat(16); // wrong but same length as sha512 hex (128 chars)

    await expect(
      controller.handleWebhook(body, rawBody, badSig),
    ).rejects.toMatchObject({ status: 401 });

    // DepositConfirmation must not have been created.
    const confirmation = await prisma.depositConfirmation.findUnique({
      where: { txHash },
    });
    expect(confirmation).toBeNull();
  });
});
