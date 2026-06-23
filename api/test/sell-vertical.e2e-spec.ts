/**
 * Integration test for the FULL sell vertical: executeSell → settleSellPayout (task S4b).
 *
 * Verifies the two-phase sell model against a REAL Postgres (Testcontainers):
 *   Phase 1 — executeSell:
 *     - Runs the gauntlet (proposal, quote drift, KYC, balance, directive, PIN).
 *     - ATOMIC write: Transaction(settling) + reserve USDT ledger entries (user_wallet→clearing).
 *     - Initiates NGN payout (fake payment provider).
 *     - Enqueues SettlementOutbox(processor_payout, pending).
 *   Phase 2a — settleSellPayout (success):
 *     - Verify payout → successful → settleSellFinalizeAtomic.
 *     - USDT finalize ledger: clearing→treasury (2 entries).
 *     - NGN payout ledger: treasury→processor_settlement (2 entries).
 *     - Transaction.status === 'completed'.
 *     - Receipt minted (HS-YYYY-NNNNNN, non-empty signature).
 *     - SettlementOutbox.status === 'completed'.
 *   Phase 2b — settleSellPayout (failure):
 *     - Verify payout → failed → settleSellRefundAtomic.
 *     - Refund ledger: clearing→user_wallet (2 entries, reversal of reserve).
 *     - Transaction.status === 'failed'.
 *     - CompensationRecord created.
 *   Idempotency:
 *     - Re-running executeSell with same idempotencyKey returns same txnId, no new rows.
 *     - Re-running settleSellPayout (completed) returns completed, no new settle.
 *
 * Services are wired manually (no Nest DI), following the pattern of all other
 * e2e tests in this project.
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
import { LedgerPrismaRepository } from '../src/modules/transactions/infrastructure/ledger.prisma.repository';
import { PinPrismaRepository } from '../src/core/auth/infrastructure/pin.prisma.repository';
import { IdentityPrismaRepository } from '../src/modules/identity/infrastructure/identity.prisma.repository';
import { VelocityPrismaRepository } from '../src/modules/identity/infrastructure/velocity.prisma.repository';
import { WalletPrismaRepository } from '../src/modules/wallets/infrastructure/wallet.prisma.repository';
import { BeneficiaryPrismaRepository } from '../src/modules/beneficiaries/infrastructure/beneficiary.prisma.repository';

// Services
import { PinService } from '../src/core/auth/pin.service';
import { DirectiveService } from '../src/modules/transactions/application/directive.service';
import { ProposalService } from '../src/modules/transactions/application/proposal.service';
import { ExecutionService } from '../src/modules/transactions/application/execution.service';
import { KycGateService } from '../src/modules/identity/application/kyc-gate.service';
import { QuotesService } from '../src/modules/quotes/application/quotes.service';
import { WalletService } from '../src/modules/wallets/application/wallet.service';
import { BeneficiaryService } from '../src/modules/beneficiaries/application/beneficiary.service';
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
      return 'sell-vertical-e2e-signing-key-32-bytes!!' as T;
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

const FAKE_WALLET_ADDRESS = 'TFakeWalletSellVerticalAddress123';
const FAKE_BLOCKRADAR_REF = 'fake_blockradar_ref_sell_e2e';
const FAKE_FLW_PAYOUT_REF = 'flw_fake_payout_sell_e2e_001';

const fakeWalletProvider: IWalletProvider = {
  provisionAddress: jest.fn().mockResolvedValue({
    address: FAKE_WALLET_ADDRESS,
    providerReference: FAKE_BLOCKRADAR_REF,
  }),
  getBalance: jest.fn().mockResolvedValue({
    available: '100',
    pending: '0',
    asset: 'USDT',
  }),
};

// Payment provider factory — allows per-test control of verifyPayout outcome
function makeFakePaymentProvider(
  verifyPayoutStatus: 'successful' | 'pending' | 'failed' = 'successful',
): IPaymentProvider {
  return {
    createCollection: jest.fn().mockResolvedValue({
      accountNumber: '0000000000',
      bankName: 'Test Bank',
      providerRef: 'flw_collection_unused',
    }),
    verify: jest.fn().mockResolvedValue({
      status: 'successful',
      amount: '10000',
      currency: 'NGN',
      providerRef: 'flw_collection_unused',
    }),
    createPayout: jest.fn().mockResolvedValue({
      providerRef: FAKE_FLW_PAYOUT_REF,
      status: 'pending' as const,
    }),
    verifyPayout: jest.fn().mockResolvedValue({
      status: verifyPayoutStatus,
      amount: '24600',
      currency: 'NGN',
      providerRef: FAKE_FLW_PAYOUT_REF,
    }),
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Sell vertical (executeSell → settleSellPayout, Testcontainers Postgres)', () => {
  let stop: (() => Promise<void>) | undefined;
  let prisma: PrismaClient;
  let ps: PrismaService;

  // Services
  let proposalService: ProposalService;
  let executionService: ExecutionService;
  let directiveService: DirectiveService;
  let pinService: PinService;
  let walletService: WalletService;
  let beneficiaryService: BeneficiaryService;

  // Shared test IDs
  let userId: string;

  beforeAll(async () => {
    const result = await startTestPostgres();
    stop = result.stop;
    prisma = result.prisma;
    ps = prisma as unknown as PrismaService;

    const config = new StubConfigService() as never;
    const clock = { now: () => new Date() };
    const assetRegistry = new AssetRegistry(config);

    // Repos
    const proposalRepo = new ProposalPrismaRepository(ps);
    const quoteRepo = new QuotePrismaRepository(ps);
    const directiveRepo = new DirectivePrismaRepository(ps);
    const transactionRepo = new TransactionPrismaRepository(ps);
    const outboxRepo = new SettlementOutboxPrismaRepository(ps);
    const settlementRepo = new SettlementPrismaRepository(ps, config);
    const ledgerRepo = new LedgerPrismaRepository(ps);
    const pinRepo = new PinPrismaRepository(ps);
    const identityRepo = new IdentityPrismaRepository(ps);
    const velocityRepo = new VelocityPrismaRepository(ps);
    const walletRepo = new WalletPrismaRepository(ps);
    const beneficiaryRepo = new BeneficiaryPrismaRepository(ps);

    // Services
    pinService = new PinService(pinRepo, config, clock);
    walletService = new WalletService(
      fakeWalletProvider,
      walletRepo,
      clock,
      assetRegistry,
    );
    const rateProvider = new ConfigRateProvider(config);
    const quotesService = new QuotesService(rateProvider, clock);
    const kycGateService = new KycGateService(
      identityRepo,
      velocityRepo,
      config,
      clock,
    );
    directiveService = new DirectiveService(directiveRepo, config, clock);
    beneficiaryService = new BeneficiaryService(
      beneficiaryRepo,
      assetRegistry,
      config,
    );

    proposalService = new ProposalService(
      quotesService,
      kycGateService,
      quoteRepo,
      proposalRepo,
      clock,
      walletService,
      beneficiaryService,
      assetRegistry,
      ledgerRepo,
    );

    const fakePaymentProvider = makeFakePaymentProvider('successful');

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
      beneficiaryService,
      ledgerRepo,
    );

    // Seed a KYC-verified (Tier 1) user with a PIN.
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

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Provisions a USDT wallet for the user, seeds the ledger with USDT credit
   * so they have balance to sell, creates a bank beneficiary, creates a sell
   * proposal, and issues a directive grant.
   */
  async function seedSellProposalAndPrereqs(): Promise<{
    proposalId: string;
    walletId: string;
    beneficiaryId: string;
  }> {
    // Provision wallet via WalletService (creates WalletPrisma row).
    const wallet = await walletService.getOrProvisionWallet(
      userId,
      'USDT',
      'TRON',
    );

    // Seed USDT balance in the ledger by creating a dummy transaction and
    // a LedgerEntry. In a real flow this comes from a successful buy settlement.
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
    // Find current max sequence for this account to avoid unique constraint
    // violations when the same wallet is reused across describe-blocks in one run.
    const latestEntry = await prisma.ledgerEntry.findFirst({
      where: { accountType: 'user_wallet', accountId: wallet.id },
      orderBy: { sequence: 'desc' },
    });
    const seedSeq = (latestEntry?.sequence ?? 0) + 1;
    const seedBalanceBefore = latestEntry?.balanceAfter
      ? Number(latestEntry.balanceAfter)
      : 0;
    const seedBalanceAfter = seedBalanceBefore + 100;

    await prisma.ledgerEntry.create({
      data: {
        transactionId: seedTxn.id,
        accountType: 'user_wallet',
        accountId: wallet.id,
        currency: 'USDT',
        direction: 'credit',
        amount: '100.000000',
        description: 'seed credit for sell e2e',
        balanceAfter: seedBalanceAfter.toFixed(6),
        sequence: seedSeq,
        postedAt: new Date(),
      },
    });

    // Create a bank beneficiary.
    const ben = await beneficiaryService.addBankAccount({
      userId,
      label: 'Test Bank Account',
      accountNumber: '0123456789',
      bankCode: '044',
      accountName: 'Test User',
    });

    // Create a sell proposal for 16 USDT.
    const proposal = await proposalService.createSellProposal({
      userId,
      beneficiaryId: ben.id,
      intent: {
        action: 'sell_crypto',
        asset: 'USDT',
        cryptoAmount: '16.000000',
        fiatCurrency: 'NGN',
      },
    });

    return {
      proposalId: proposal.proposalId,
      walletId: wallet.id,
      beneficiaryId: ben.id,
    };
  }

  /**
   * Issues a DirectiveGrant for a sell proposal (ref = 'request_pin').
   */
  async function issueDirective(proposalId: string): Promise<{
    directiveId: string;
    nonce: string;
  }> {
    const result = await directiveService.issue({
      userId,
      proposalId,
      ref: 'request_pin',
    });
    return { directiveId: result.directiveId, nonce: result.nonce };
  }

  // -----------------------------------------------------------------------
  // Phase 1: executeSell
  // -----------------------------------------------------------------------

  describe('Phase 1: executeSell', () => {
    it('happy path: Transaction(settling) created, reserve ledger entries posted, outbox enqueued', async () => {
      const { proposalId, walletId } = await seedSellProposalAndPrereqs();
      const { directiveId, nonce } = await issueDirective(proposalId);
      const idempotencyKey = randomUUID();

      const result = await executionService.executeSell({
        userId,
        proposalId,
        directiveId,
        nonce,
        pin: '123456',
        idempotencyKey,
      });

      expect(result.status).toBe('settling');
      expect(result.transactionId).toBeTruthy();
      expect(result.payout.providerRef).toBe(FAKE_FLW_PAYOUT_REF);

      // Transaction row
      const txn = await prisma.transaction.findUnique({
        where: { id: result.transactionId },
      });
      expect(txn).not.toBeNull();
      expect(txn?.status).toBe('settling');
      expect(txn?.type).toBe('sell');

      // Reserve ledger entries: 2 rows (user_wallet debit, clearing credit)
      const ledgerEntries = await prisma.ledgerEntry.findMany({
        where: { transactionId: result.transactionId },
        orderBy: { sequence: 'asc' },
      });
      // Filter to just the reserve entries (USDT currency)
      const reserveEntries = ledgerEntries.filter((e) => e.currency === 'USDT');
      expect(reserveEntries).toHaveLength(2);

      // Signed amounts must sum to 0 per currency.
      // The `amount` field is signed (negatives for debits), so just sum directly.
      const usdtSum = reserveEntries.reduce(
        (sum, e) => sum + Number(e.amount),
        0,
      );
      expect(usdtSum).toBeCloseTo(0, 10);

      // SettlementOutbox row (processor_payout, pending)
      const outbox = await prisma.settlementOutbox.findFirst({
        where: { transactionId: result.transactionId },
      });
      expect(outbox).not.toBeNull();
      expect(outbox?.settlementType).toBe('processor_payout');
      expect(outbox?.status).toBe('pending');

      // Wallet balance via ledger — reserve debit should reduce balance by 16
      const userWalletEntries = await prisma.ledgerEntry.findMany({
        where: { accountType: 'user_wallet', accountId: walletId },
        orderBy: { sequence: 'asc' },
      });
      // Last entry is the reserve debit (user_wallet side of the reserve)
      const lastEntry = userWalletEntries[userWalletEntries.length - 1];
      const prevEntry = userWalletEntries[userWalletEntries.length - 2];
      // Reserve debit should lower balance by exactly 16.
      // direction = 'debit'; amount is stored signed (negative).
      expect(lastEntry?.direction).toBe('debit');
      expect(Number(lastEntry?.amount)).toBeCloseTo(-16, 4);
      // Balance decreases by 16 from the previous entry.
      expect(
        Number(prevEntry?.balanceAfter) - Number(lastEntry?.balanceAfter),
      ).toBeCloseTo(16, 4);
    });

    it('atomicity: a settling Transaction always has its reserve ledger entries (no gap between creation and reserve)', async () => {
      // This test verifies the C1 fix: createSellSettlingWithReserveAtomic runs
      // Transaction creation AND reserve entries in ONE $transaction, so there is
      // never a state where the Transaction exists but reserve entries are missing.
      //
      // We cannot simulate a crash-between-writes, but we CAN assert the
      // post-condition: after executeSell returns, EXACTLY 2 USDT reserve
      // LedgerEntries exist for the transaction.
      const { proposalId } = await seedSellProposalAndPrereqs();
      const { directiveId, nonce } = await issueDirective(proposalId);
      const idempotencyKey = randomUUID();

      const result = await executionService.executeSell({
        userId,
        proposalId,
        directiveId,
        nonce,
        pin: '123456',
        idempotencyKey,
      });

      // Must be settling.
      expect(result.status).toBe('settling');

      // Reserve entries: exactly 2 USDT entries (user_wallet debit + clearing credit).
      const reserveEntries = await prisma.ledgerEntry.findMany({
        where: {
          transactionId: result.transactionId,
          currency: 'USDT',
        },
      });
      expect(reserveEntries).toHaveLength(2);

      // Double-entry: USDT signed amounts must sum to 0.
      const usdtSum = reserveEntries.reduce(
        (sum, e) => sum + Number(e.amount),
        0,
      );
      expect(usdtSum).toBeCloseTo(0, 10);
    });

    it('idempotent replay: same idempotencyKey returns same transactionId, no new rows', async () => {
      const { proposalId } = await seedSellProposalAndPrereqs();
      const { directiveId, nonce } = await issueDirective(proposalId);
      const idempotencyKey = randomUUID();

      const first = await executionService.executeSell({
        userId,
        proposalId,
        directiveId,
        nonce,
        pin: '123456',
        idempotencyKey,
      });

      const txnCountBefore = await prisma.transaction.count({
        where: { idempotencyKey },
      });

      // For idempotency replay, the gate fires on the idempotencyKey BEFORE
      // directive/PIN checks. We use a FRESH proposal+directive so the directive
      // unique constraint is not violated, but pass the SAME idempotencyKey
      // so the idempotency path short-circuits immediately.
      const { proposalId: proposalId2 } = await seedSellProposalAndPrereqs();
      const { directiveId: dir2, nonce: nonce2 } =
        await issueDirective(proposalId2);

      const second = await executionService.executeSell({
        userId,
        proposalId: proposalId2,
        directiveId: dir2,
        nonce: nonce2,
        pin: '123456',
        idempotencyKey, // same key → idempotent path
      });

      const txnCountAfter = await prisma.transaction.count({
        where: { idempotencyKey },
      });

      expect(second.transactionId).toBe(first.transactionId);
      expect(txnCountAfter).toBe(txnCountBefore);
    });
  });

  // -----------------------------------------------------------------------
  // Phase 2a: settleSellPayout — success path
  // -----------------------------------------------------------------------

  describe('Phase 2a: settleSellPayout (payout successful)', () => {
    it('finalizes sell: ledger balanced, Transaction completed, Receipt minted, Outbox completed', async () => {
      const { proposalId } = await seedSellProposalAndPrereqs();
      const { directiveId, nonce } = await issueDirective(proposalId);
      const idempotencyKey = randomUUID();

      // Build an executionService that verifies payout as 'successful'.
      const fakePaymentProvider = makeFakePaymentProvider('successful');
      const config = new StubConfigService() as never;
      const assetRegistry = new AssetRegistry(config);
      const clock = { now: () => new Date() };
      const rateProvider = new ConfigRateProvider(config);
      const quotesService = new QuotesService(rateProvider, clock);
      const kycGate = new KycGateService(
        new IdentityPrismaRepository(ps),
        new VelocityPrismaRepository(ps),
        config,
        clock,
      );
      const svc = new ExecutionService(
        new ProposalPrismaRepository(ps),
        new QuotePrismaRepository(ps),
        new TransactionPrismaRepository(ps),
        new SettlementOutboxPrismaRepository(ps),
        new SettlementPrismaRepository(ps, config),
        quotesService,
        kycGate,
        new DirectiveService(new DirectivePrismaRepository(ps), config, clock),
        pinService,
        walletService,
        fakePaymentProvider,
        config,
        clock,
        assetRegistry,
        beneficiaryService,
        new LedgerPrismaRepository(ps),
      );

      // Phase 1
      const executeResult = await svc.executeSell({
        userId,
        proposalId,
        directiveId,
        nonce,
        pin: '123456',
        idempotencyKey,
      });

      // Phase 2: settle with payout successful
      const settleResult = await svc.settleSellPayout({
        reference: idempotencyKey,
      });

      expect(settleResult.status).toBe('completed');
      expect(settleResult.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);
      expect(settleResult.userId).toBe(userId);

      // Transaction.status === 'completed'
      const txn = await prisma.transaction.findUnique({
        where: { id: executeResult.transactionId },
      });
      expect(txn?.status).toBe('completed');

      // Ledger entries: 2 reserve (USDT) + 2 finalize-USDT + 2 finalize-NGN = 6
      const allEntries = await prisma.ledgerEntry.findMany({
        where: { transactionId: executeResult.transactionId },
      });
      expect(allEntries.length).toBe(6);

      // Per-currency invariant: signed amounts sum to 0.
      // The `amount` field is signed (negatives for debits) — sum directly.
      const usdtEntries = allEntries.filter((e) => e.currency === 'USDT');
      const ngnEntries = allEntries.filter((e) => e.currency === 'NGN');

      const usdtSum = usdtEntries.reduce((s, e) => s + Number(e.amount), 0);
      const ngnSum = ngnEntries.reduce((s, e) => s + Number(e.amount), 0);

      expect(usdtSum).toBeCloseTo(0, 10);
      expect(ngnSum).toBeCloseTo(0, 10);

      // SettlementOutbox.status === 'completed'
      const outbox = await prisma.settlementOutbox.findFirst({
        where: { transactionId: executeResult.transactionId },
      });
      expect(outbox?.status).toBe('completed');

      // Receipt exists
      const receipt = await prisma.receipt.findFirst({
        where: { transactionId: executeResult.transactionId },
      });
      expect(receipt).not.toBeNull();
      expect(receipt?.receiptNumber).toBe(settleResult.receiptNumber);
      expect(receipt?.signatureHash).toBeTruthy();
    });

    it('idempotent: re-running settleSellPayout when completed returns completed, no new settle', async () => {
      const { proposalId } = await seedSellProposalAndPrereqs();
      const { directiveId, nonce } = await issueDirective(proposalId);
      const idempotencyKey = randomUUID();

      const fakePaymentProvider = makeFakePaymentProvider('successful');
      const config = new StubConfigService() as never;
      const assetRegistry = new AssetRegistry(config);
      const clock = { now: () => new Date() };
      const rateProvider = new ConfigRateProvider(config);
      const quotesService = new QuotesService(rateProvider, clock);
      const kycGate = new KycGateService(
        new IdentityPrismaRepository(ps),
        new VelocityPrismaRepository(ps),
        config,
        clock,
      );
      const svc = new ExecutionService(
        new ProposalPrismaRepository(ps),
        new QuotePrismaRepository(ps),
        new TransactionPrismaRepository(ps),
        new SettlementOutboxPrismaRepository(ps),
        new SettlementPrismaRepository(ps, config),
        quotesService,
        kycGate,
        new DirectiveService(new DirectivePrismaRepository(ps), config, clock),
        pinService,
        walletService,
        fakePaymentProvider,
        config,
        clock,
        assetRegistry,
        beneficiaryService,
        new LedgerPrismaRepository(ps),
      );

      await svc.executeSell({
        userId,
        proposalId,
        directiveId,
        nonce,
        pin: '123456',
        idempotencyKey,
      });

      // First settle
      const first = await svc.settleSellPayout({ reference: idempotencyKey });
      expect(first.status).toBe('completed');

      const ledgerCountAfterFirst = await prisma.ledgerEntry.count();

      // Second settle (idempotent replay)
      const second = await svc.settleSellPayout({ reference: idempotencyKey });
      expect(second.status).toBe('completed');
      expect(second.receiptNumber).toBe(first.receiptNumber);

      const ledgerCountAfterSecond = await prisma.ledgerEntry.count();
      expect(ledgerCountAfterSecond).toBe(ledgerCountAfterFirst);
    });
  });

  // -----------------------------------------------------------------------
  // Phase 2b: settleSellPayout — failure path (refund)
  // -----------------------------------------------------------------------

  describe('Phase 2b: settleSellPayout (payout failed → refund)', () => {
    it('refunds USDT: clearing→user_wallet, Transaction failed, CompensationRecord created', async () => {
      const { proposalId, walletId } = await seedSellProposalAndPrereqs();
      const { directiveId, nonce } = await issueDirective(proposalId);
      const idempotencyKey = randomUUID();

      const fakePaymentProvider = makeFakePaymentProvider('failed');
      const config = new StubConfigService() as never;
      const assetRegistry = new AssetRegistry(config);
      const clock = { now: () => new Date() };
      const rateProvider = new ConfigRateProvider(config);
      const quotesService = new QuotesService(rateProvider, clock);
      const kycGate = new KycGateService(
        new IdentityPrismaRepository(ps),
        new VelocityPrismaRepository(ps),
        config,
        clock,
      );
      const svc = new ExecutionService(
        new ProposalPrismaRepository(ps),
        new QuotePrismaRepository(ps),
        new TransactionPrismaRepository(ps),
        new SettlementOutboxPrismaRepository(ps),
        new SettlementPrismaRepository(ps, config),
        quotesService,
        kycGate,
        new DirectiveService(new DirectivePrismaRepository(ps), config, clock),
        pinService,
        walletService,
        fakePaymentProvider,
        config,
        clock,
        assetRegistry,
        beneficiaryService,
        new LedgerPrismaRepository(ps),
      );

      // Phase 1: execute
      const executeResult = await svc.executeSell({
        userId,
        proposalId,
        directiveId,
        nonce,
        pin: '123456',
        idempotencyKey,
      });

      // Ledger state after reserve: 2 USDT entries (debit user, credit clearing)
      const afterReserve = await prisma.ledgerEntry.findMany({
        where: { transactionId: executeResult.transactionId },
      });
      expect(afterReserve).toHaveLength(2);

      // Phase 2: settle with payout failure → refund
      const settleResult = await svc.settleSellPayout({
        reference: idempotencyKey,
      });

      expect(settleResult.status).toBe('failed');
      expect(settleResult.userId).toBe(userId);

      // Transaction.status === 'failed'
      const txn = await prisma.transaction.findUnique({
        where: { id: executeResult.transactionId },
      });
      expect(txn?.status).toBe('failed');

      // Refund ledger: 2 reserve + 2 refund = 4 USDT entries total; no NGN
      const allEntries = await prisma.ledgerEntry.findMany({
        where: { transactionId: executeResult.transactionId },
      });
      expect(allEntries).toHaveLength(4);

      // Per-currency sum = 0 (reserve + refund cancel out).
      // The `amount` field is signed — sum directly.
      const usdtSum = allEntries
        .filter((e) => e.currency === 'USDT')
        .reduce((s, e) => s + Number(e.amount), 0);
      expect(usdtSum).toBeCloseTo(0, 10);
      expect(allEntries.filter((e) => e.currency === 'NGN')).toHaveLength(0);

      // Refunded balance: user_wallet's last entry (refund credit) should
      // restore 16 USDT, so balanceAfter = balanceBeforeReserve (the seed credit level).
      const userWalletEntriesAll = await prisma.ledgerEntry.findMany({
        where: { accountType: 'user_wallet', accountId: walletId },
        orderBy: { sequence: 'asc' },
      });
      const refundCreditEntry =
        userWalletEntriesAll[userWalletEntriesAll.length - 1];
      const reserveDebitEntry =
        userWalletEntriesAll[userWalletEntriesAll.length - 2];
      const balanceBeforeReserve =
        userWalletEntriesAll[userWalletEntriesAll.length - 3];

      // After refund, balance should equal the balance before the reserve debit
      expect(refundCreditEntry?.direction).toBe('credit');
      expect(Number(refundCreditEntry?.balanceAfter)).toBeCloseTo(
        Number(balanceBeforeReserve?.balanceAfter),
        4,
      );
      // And the reserve debit entry had reduced balance by 16
      expect(
        Number(balanceBeforeReserve?.balanceAfter) -
          Number(reserveDebitEntry?.balanceAfter),
      ).toBeCloseTo(16, 4);

      // CompensationRecord exists
      const compensation = await prisma.compensationRecord.findFirst({
        where: { originatingTransactionId: executeResult.transactionId },
      });
      expect(compensation).not.toBeNull();
      expect(compensation?.status).toBe('pending');
    });
  });
});
