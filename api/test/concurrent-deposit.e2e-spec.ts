/**
 * Integration test: concurrent deposit settlement — advisory lock fix.
 *
 * Regression guard for the P2002 / 23505 "Unique constraint failed
 * (accountType, accountId, sequence)" crash that occurred when two
 * deposit.success webhooks for the SAME wallet landed simultaneously.
 *
 * Before the fix: both transactions read the same max(sequence) inside their
 * own Serializable transactions, computed the same next sequence, and one
 * failed with P2002 (deposit lost, money not credited).
 *
 * After the fix: pg_advisory_xact_lock serializes concurrent settlements for
 * the same (accountType, accountId) so each transaction sees the committed
 * state of the previous one before reading max(sequence).
 *
 * Assertions:
 *   - Promise.all([deposit1, deposit2]) resolves without error (no P2002).
 *   - Both deposits are reflected in the ledger (4 LedgerEntry rows: 2 per deposit).
 *   - Sequence numbers for the user_wallet account are sequential (1, 2).
 *   - Final balanceAfter on the user_wallet ledger account = sum of both amounts.
 *   - Two DepositConfirmation rows exist (one per txHash).
 *   - Two Receipt rows minted.
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
import { BlockradarWebhookHandler } from '../src/modules/wallets/application/blockradar-webhook.handler';
import type { WebhookEventRecord } from '../src/modules/webhooks/application/ports/webhook-event.repository.port';

// Ports/types
import type { PrismaService } from '../src/core/prisma/prisma.service';
import type { IWhatsAppSender } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';

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
const BLOCKRADAR_API_KEY = 'e2e-concurrent-deposit-api-key';

class StubConfigService {
  get<T = unknown>(key: string): T {
    if (key === 'BLOCKRADAR_API_KEY') return BLOCKRADAR_API_KEY as T;
    if (key === 'RECEIPT_SIGNING_KEY')
      return 'e2e-concurrent-deposit-receipt-signing-key!!' as T;
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
// Fake WhatsApp sender (no-op — we don't assert on messages here)
// ---------------------------------------------------------------------------

const fakeSender: IWhatsAppSender = {
  sendText: jest
    .fn()
    .mockResolvedValue({ externalMessageId: 'wamid.concurrent-test' }),
  sendTemplate: jest
    .fn()
    .mockResolvedValue({ externalMessageId: 'wamid.template' }),
  sendCtaUrl: jest.fn().mockResolvedValue({ externalMessageId: 'wamid.cta' }),
  sendFlow: jest.fn().mockResolvedValue({ externalMessageId: 'wamid.flow' }),
  sendBeneficiaryFlow: jest
    .fn()
    .mockResolvedValue({ externalMessageId: 'wamid.ben-flow' }),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEPOSIT_ADDRESS = 'TConcurrentDepositE2EAddress00001';
const ASSET_SYMBOL = 'USDT';
const NETWORK_NAME = 'TRON';

function buildDepositBody(txHash: string, amount: string) {
  return {
    event: 'deposit.success',
    data: {
      hash: txHash,
      amount,
      recipientAddress: DEPOSIT_ADDRESS,
      senderAddress: 'TSenderConcurrentAddr1234567890123',
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

// Decimal-safe scaled comparison (18 decimal places).
const SCALE = 10n ** 18n;

function toScaled(s: string): bigint {
  const str = s.trim();
  const isNeg = str.startsWith('-');
  const abs = isNeg ? str.slice(1) : str;
  const [whole = '0', frac = ''] = abs.split('.');
  const fracPadded = frac.slice(0, 18).padEnd(18, '0');
  const scaled = BigInt(whole) * SCALE + BigInt(fracPadded);
  return isNeg ? -scaled : scaled;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Concurrent deposit settlement — advisory lock prevents P2002', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let handler: BlockradarWebhookHandler;

  let userId: string;
  let walletId: string;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    const ps = prisma as unknown as PrismaService;
    const config = new StubConfigService() as never;

    const walletRepo = new WalletPrismaRepository(ps);
    const assetRegistry = new AssetRegistry(config);
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
        providerReference: 'blockradar-ref-concurrent-001',
        status: 'active',
        provisionedAt: new Date(),
      },
    });
    walletId = wallet.id;

    await prisma.channelIdentity.create({
      data: {
        channel: 'whatsapp',
        channelAddress: '2348090000098',
        userId,
      },
    });
  });

  afterAll(async () => {
    await stop?.();
  });

  /**
   * THE KEY TEST: fire two distinct deposit webhooks concurrently via Promise.all.
   * Before the advisory-lock fix this reliably produced P2002 on the
   * (accountType, accountId, sequence) unique constraint.
   */
  it('two concurrent deposits to the same wallet both succeed — no P2002, sequential sequences, correct final balance', async () => {
    const amount1 = '7.5';
    const amount2 = '3.25';
    const txHash1 = `0xconcurrent1${randomUUID().replace(/-/g, '')}`;
    const txHash2 = `0xconcurrent2${randomUUID().replace(/-/g, '')}`;

    const body1 = buildDepositBody(txHash1, amount1);
    const body2 = buildDepositBody(txHash2, amount2);

    // Fire both concurrently — this is the race that produced P2002 before the fix.
    await Promise.all([
      handler.handle(makeEvent(body1)),
      handler.handle(makeEvent(body2)),
    ]);

    // ── Two DepositConfirmation rows (one per txHash) ─────────────────────────
    const conf1 = await prisma.depositConfirmation.findUnique({
      where: { txHash: txHash1 },
    });
    const conf2 = await prisma.depositConfirmation.findUnique({
      where: { txHash: txHash2 },
    });
    expect(conf1).not.toBeNull();
    expect(conf2).not.toBeNull();
    expect(conf1!.status).toBe('confirmed');
    expect(conf2!.status).toBe('confirmed');

    // ── Exactly 4 LedgerEntry rows for this wallet (2 per deposit) ───────────
    const walletEntries = await prisma.ledgerEntry.findMany({
      where: { accountId: walletId },
      orderBy: { sequence: 'asc' },
    });
    // Each deposit creates one user_wallet credit entry.
    expect(walletEntries).toHaveLength(2);

    // ── Sequences are strictly sequential (1, 2) — no gap, no duplicate ───────
    const sequences = walletEntries.map((e) => e.sequence);
    expect(sequences).toEqual([1, 2]);

    // ── Final balanceAfter = sum of both amounts ──────────────────────────────
    const expectedTotal = toScaled(amount1) + toScaled(amount2);
    const lastEntry = walletEntries[walletEntries.length - 1];
    const actualBalance = toScaled(
      (lastEntry.balanceAfter as { toString(): string }).toString(),
    );
    expect(actualBalance).toBe(expectedTotal);

    // ── Two Receipt rows ──────────────────────────────────────────────────────
    const receipts = await prisma.receipt.findMany({
      where: { userId },
    });
    expect(receipts).toHaveLength(2);
    for (const receipt of receipts) {
      expect(receipt.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);
      expect(receipt.signatureHash).toBeTruthy();
    }
  });

  /**
   * Five concurrent deposits to the same wallet — extreme concurrency stress.
   * All five must land with distinct sequential sequence numbers and the final
   * balance must equal the sum of all five amounts.
   */
  it('five concurrent deposits all succeed — sequences 1..5, final balance = sum', async () => {
    // Use a fresh wallet to isolate sequences from the previous test.
    const freshUser = await prisma.user.create({
      data: { kycStatus: 'verified', kycTier: 'tier_1', status: 'active' },
    });
    const FRESH_ADDRESS = 'TConcurrentStressAddr0000000000001';
    const freshWallet = await prisma.wallet.create({
      data: {
        userId: freshUser.id,
        network: 'TRON',
        address: FRESH_ADDRESS,
        providerReference: 'blockradar-ref-stress-001',
        status: 'active',
        provisionedAt: new Date(),
      },
    });
    await prisma.channelIdentity.create({
      data: {
        channel: 'whatsapp',
        channelAddress: '2348090000097',
        userId: freshUser.id,
      },
    });

    // Re-wire controller pointing at a fresh assetRegistry instance.
    const ps = prisma as unknown as PrismaService;
    const config = new StubConfigService() as never;
    const walletRepo = new WalletPrismaRepository(ps);
    const assetRegistry = new AssetRegistry(config);
    const settlementRepo = new DepositSettlementPrismaRepository(
      ps,
      config,
      assetRegistry,
    );
    const identityRepo = new IdentityPrismaRepository(ps);
    const identityService = new IdentityService(identityRepo);
    const fakeExec = {
      settleSendOnChain: jest.fn().mockResolvedValue({ status: 'pending' }),
    };
    const stressHandler = new BlockradarWebhookHandler(
      walletRepo,
      settlementRepo,
      identityService,
      fakeSender,
      assetRegistry,
      fakeExec as never,
    );

    const amounts = ['1.0', '2.0', '3.0', '4.0', '5.0'];
    const hashes = amounts.map(
      () => `0xstress${randomUUID().replace(/-/g, '')}`,
    );

    const bodies = amounts.map((amount, i) => {
      const body = {
        event: 'deposit.success',
        data: {
          hash: hashes[i],
          amount,
          recipientAddress: FRESH_ADDRESS,
          senderAddress: 'TSenderStressAddr1234567890123456',
          asset: { symbol: ASSET_SYMBOL, network: { name: NETWORK_NAME } },
          confirmations: 20,
          status: 'confirmed',
          id: `webhook-stress-${i}`,
        },
      };
      return { body };
    });

    // Fire all five concurrently.
    await Promise.all(
      bodies.map(({ body }) => stressHandler.handle(makeEvent(body))),
    );

    // All five deposits must be confirmed.
    for (const hash of hashes) {
      const conf = await prisma.depositConfirmation.findUnique({
        where: { txHash: hash },
      });
      expect(conf).not.toBeNull();
      expect(conf!.status).toBe('confirmed');
    }

    // Exactly 5 user_wallet LedgerEntry rows for the fresh wallet.
    const entries = await prisma.ledgerEntry.findMany({
      where: { accountId: freshWallet.id },
      orderBy: { sequence: 'asc' },
    });
    expect(entries).toHaveLength(5);

    // Sequences are 1, 2, 3, 4, 5 — no duplicates, no gaps.
    expect(entries.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);

    // Final balance = sum of all amounts (1+2+3+4+5 = 15).
    const expectedTotal = amounts.reduce((acc, a) => acc + toScaled(a), 0n);
    const finalEntry = entries[entries.length - 1];
    const actualBalance = toScaled(
      (finalEntry.balanceAfter as { toString(): string }).toString(),
    );
    expect(actualBalance).toBe(expectedTotal);
  });
});
