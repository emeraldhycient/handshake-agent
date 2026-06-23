/**
 * Integration test for ExecutionService.settleBuyPayment (task 4.5b, CLAUDE.md §3.1).
 *
 * Verifies the FULL buy-settlement gauntlet against a REAL Postgres (Testcontainers):
 *   - Real repos: Transaction, Proposal, Quote, Directive, SettlementOutbox, Wallet,
 *     SettlementPrismaRepository (atomic ledger + credit + receipt).
 *   - FAKE PAYMENT_PROVIDER (faked to return successful, so no Flutterwave calls).
 *   - FAKE WALLET_PROVIDER (in-process fake — no Blockradar calls).
 *
 * Post-settlement assertions:
 *   - Transaction.status === 'completed'.
 *   - LedgerEntry rows present and BALANCED per currency (sum === 0).
 *   - WalletBalance credited by cryptoAmount.
 *   - SettlementOutbox.status === 'completed'.
 *   - Receipt row present with a receiptNumber starting 'HS-' and a non-empty signatureHash.
 *   - Re-running settleBuyPayment is idempotent (no second credit; ledger entry count unchanged).
 *
 * Services are wired manually (no Nest DI), following the same pattern as
 * execution-buy.e2e-spec.ts in this project.
 *
 * Requires Docker. Runs only in the `test:e2e` lane (jest-e2e.json).
 */

import { randomUUID } from 'node:crypto';

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
import { ConfigRateProvider } from '../src/modules/quotes/infrastructure/config-rate.provider';
import { AssetRegistry } from '../src/core/catalog/asset-registry';

// Ports/types
import type { PrismaService } from '../src/core/prisma/prisma.service';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';

// Config defaults
import configuration from '../src/core/config/configuration';

jest.setTimeout(300_000);

// ---------------------------------------------------------------------------
// Fake ConfigService
// ---------------------------------------------------------------------------

const appConfig = configuration();

class StubConfigService {
  get<T = unknown>(key: string): T {
    if (key === 'DIRECTIVE_SIGNING_KEY') {
      return 'e2e-settlement-test-signing-key-32-bytes-min!!' as T;
    }
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

const FAKE_WALLET_ADDRESS = 'TFakeWalletSettlementAddress1234';
const FAKE_BLOCKRADAR_REF = 'fake_blockradar_ref_settle_e2e';
const FAKE_FLW_REF = 'flw_fake_ref_settle_e2e_001';

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

const FAKE_ACCOUNT_NUMBER = '0987654399';
const FAKE_BANK_NAME = 'Test Settlement Bank';

// Payment provider: createCollection returns VA, verify returns successful.
const fakePaymentProvider: IPaymentProvider = {
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
  verifyWebhookSignature: jest.fn().mockReturnValue(true),
};

// ---------------------------------------------------------------------------
// Decimal-safe sum helper for ledger-balance assertions
// ---------------------------------------------------------------------------

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

describe('ExecutionService.settleBuyPayment (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  let executionService: ExecutionService;
  let directiveService: DirectiveService;
  let proposalService: ProposalService;
  let pinService: PinService;

  let userId: string;
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

    proposalService = new ProposalService(
      quotesService,
      kycGateService,
      quoteRepo,
      proposalRepo,
      clock,
    );

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
  });

  afterAll(async () => {
    await stop?.();
  });

  // ---------------------------------------------------------------------------
  // Helpers — same pattern as execution-buy.e2e-spec.ts
  // ---------------------------------------------------------------------------

  async function seedProposalAndQuote(): Promise<{ proposalId: string }> {
    const result = await proposalService.createBuyProposal({
      userId,
      intent: {
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount: '10000',
        fiatCurrency: 'NGN',
      },
    });
    return { proposalId: result.proposalId };
  }

  async function issueDirective(proposalId: string): Promise<{
    directiveId: string;
    nonce: string;
  }> {
    const result = await directiveService.issue({
      proposalId,
      userId,
      ref: 'request_pin',
    });
    return { directiveId: result.directiveId, nonce: result.nonce };
  }

  /**
   * Runs executeBuy to seed a Transaction in 'settling' state.
   * Returns the idempotencyKey (= reference for settleBuyPayment).
   */
  async function seedSettlingTransaction(): Promise<{
    transactionId: string;
    reference: string;
  }> {
    const { proposalId } = await seedProposalAndQuote();
    const { directiveId, nonce } = await issueDirective(proposalId);
    const idempotencyKey = randomUUID();

    const result = await executionService.executeBuy({
      userId,
      proposalId,
      directiveId,
      nonce,
      pin: '123456',
      idempotencyKey,
    });

    return { transactionId: result.transactionId, reference: idempotencyKey };
  }

  // ---------------------------------------------------------------------------
  // Happy path: full settlement flow
  // ---------------------------------------------------------------------------

  it('happy path: Transaction completed, ledger BALANCED per currency, WalletBalance credited, Outbox completed, Receipt minted', async () => {
    const { transactionId, reference } = await seedSettlingTransaction();

    // ── Call settle ──────────────────────────────────────────────────────────
    const result = await executionService.settleBuyPayment({ reference });

    // Returns completed + receiptNumber.
    expect(result.transactionId).toBe(transactionId);
    expect(result.status).toBe('completed');
    expect(result.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);

    // ── Transaction completed ────────────────────────────────────────────────
    const txn = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    expect(txn).not.toBeNull();
    expect(txn!.status).toBe('completed');
    expect(txn!.completedAt).not.toBeNull();
    expect(txn!.processorTxRef).toBe(FAKE_FLW_REF);

    // ── LedgerEntry rows present and BALANCED per currency ───────────────────
    const entries = await prisma.ledgerEntry.findMany({
      where: { transactionId },
    });
    expect(entries.length).toBeGreaterThanOrEqual(4); // ≥ 2 NGN + 2 USDT

    // Group by currency and assert sum === 0.
    const byCurrency: Record<string, bigint> = {};
    for (const entry of entries) {
      const currency = entry.currency;
      const amt = toScaled((entry.amount as { toString(): string }).toString());
      byCurrency[currency] = (byCurrency[currency] ?? 0n) + amt;
    }

    for (const [currency, sum] of Object.entries(byCurrency)) {
      expect(sum).toBe(0n);
      // Annotate which currency to aid test debugging.
      expect({ currency, balanced: sum === 0n }).toEqual({
        currency,
        balanced: true,
      });
    }

    // Both NGN and USDT legs must be present.
    expect(Object.keys(byCurrency)).toContain('NGN');
    expect(Object.keys(byCurrency)).toContain('USDT');

    // ── WalletBalance credited with the exact cryptoAmount ───────────────────
    const wallet = await prisma.wallet.findFirst({
      where: { userId, asset: 'USDT' },
    });
    expect(wallet).not.toBeNull();

    const balances = await prisma.walletBalance.findMany({
      where: { walletId: wallet!.id },
      orderBy: { syncedAt: 'desc' },
    });
    expect(balances.length).toBeGreaterThanOrEqual(1);

    // Read the cryptoAmount from the transaction's metadata (the exact amount
    // the settlement repo is expected to credit) and assert equality — not just
    // > 0 — to catch any amount-scaling or wrong-field bugs.
    const txnMeta = txn!.metadata as Record<string, string>;
    const expectedCryptoAmount = txnMeta.cryptoAmount ?? '0';
    const latestBalance = balances[0];
    expect(
      toScaled((latestBalance.amount as { toString(): string }).toString()),
    ).toBe(toScaled(expectedCryptoAmount));

    // ── SettlementOutbox completed ────────────────────────────────────────────
    const outbox = await prisma.settlementOutbox.findFirst({
      where: { transactionId },
    });
    expect(outbox).not.toBeNull();
    expect(outbox!.status).toBe('completed');
    expect(outbox!.completedAt).not.toBeNull();

    // ── Receipt minted ────────────────────────────────────────────────────────
    const receipt = await prisma.receipt.findUnique({
      where: { transactionId },
    });
    expect(receipt).not.toBeNull();
    expect(receipt!.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);
    expect(receipt!.signatureHash).toBeTruthy();
    expect(receipt!.signatureHash.length).toBeGreaterThan(0);
    expect(receipt!.contentHash).toBeTruthy();
    expect(receipt!.deliveryStatus).toBe('pending');
    expect(receipt!.userId).toBe(userId);
  });

  // ---------------------------------------------------------------------------
  // Idempotency: second call returns same result, no second credit
  // ---------------------------------------------------------------------------

  it('idempotent: second settleBuyPayment returns same result, ledger count unchanged, no second WalletBalance row', async () => {
    const { transactionId, reference } = await seedSettlingTransaction();

    // First settle.
    const first = await executionService.settleBuyPayment({ reference });
    expect(first.status).toBe('completed');
    expect(first.receiptNumber).toBeTruthy();

    // Capture counts after first settle.
    const ledgerCountAfterFirst = await prisma.ledgerEntry.count({
      where: { transactionId },
    });

    const wallet = await prisma.wallet.findFirst({
      where: { userId, asset: 'USDT' },
    });
    const balanceCountAfterFirst = await prisma.walletBalance.count({
      where: { walletId: wallet!.id },
    });

    // Second settle — must be idempotent.
    const second = await executionService.settleBuyPayment({ reference });

    expect(second.transactionId).toBe(transactionId);
    expect(second.status).toBe('completed');
    expect(second.receiptNumber).toBe(first.receiptNumber);

    // Ledger entries must NOT have increased (no double-credit).
    const ledgerCountAfterSecond = await prisma.ledgerEntry.count({
      where: { transactionId },
    });
    expect(ledgerCountAfterSecond).toBe(ledgerCountAfterFirst);

    // WalletBalance rows must NOT have increased.
    const balanceCountAfterSecond = await prisma.walletBalance.count({
      where: { walletId: wallet!.id },
    });
    expect(balanceCountAfterSecond).toBe(balanceCountAfterFirst);
  });
});
