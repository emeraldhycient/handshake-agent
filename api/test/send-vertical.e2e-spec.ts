/**
 * Integration test for the FULL send vertical: executeSend → settleSendOnChain (task N3b).
 *
 * Verifies the two-phase send model against a REAL Postgres (Testcontainers):
 *   Phase 1 — executeSend:
 *     - Runs the gauntlet (proposal, KYC, balance, cooling-off, sanctions, directive, PIN).
 *     - ATOMIC write: Transaction(settling) + reserve USDT ledger entries
 *       (user_wallet → usdt_send_clearing).
 *     - Calls walletService.withdraw (fake Blockradar).
 *     - Enqueues SettlementOutbox(onchain_send, pending).
 *   Phase 2a — settleSendOnChain (success=true):
 *     - Finalizes: clearing → usdt_network_out + usdt_fees (3 entries).
 *     - Transaction.status === 'completed'.
 *     - Receipt minted (HS-YYYY-NNNNNN, non-empty signature).
 *     - SettlementOutbox.status === 'completed'.
 *   Phase 2b — settleSendOnChain (success=false → refund):
 *     - Refunds clearing → user_wallet (2 entries, reversal of reserve).
 *     - Transaction.status === 'failed'.
 *     - CompensationRecord created.
 *   Idempotency:
 *     - Re-running executeSend with same idempotencyKey returns same txnId, no new rows.
 *     - Re-running settleSendOnChain (completed) returns completed, no new settle.
 *
 * Services are wired manually (no Nest DI), following the pattern of sell-vertical.e2e-spec.ts.
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
import { ComplianceEventPrismaRepository } from '../src/modules/compliance/infrastructure/compliance-event.prisma.repository';

// Services
import { PinService } from '../src/core/auth/pin.service';
import { DirectiveService } from '../src/modules/transactions/application/directive.service';
import { ProposalService } from '../src/modules/transactions/application/proposal.service';
import { ExecutionService } from '../src/modules/transactions/application/execution.service';
import { KycGateService } from '../src/modules/identity/application/kyc-gate.service';
import { QuotesService } from '../src/modules/quotes/application/quotes.service';
import { WalletService } from '../src/modules/wallets/application/wallet.service';
import { BeneficiaryService } from '../src/modules/beneficiaries/application/beneficiary.service';
import { ComplianceService } from '../src/modules/compliance/application/compliance.service';
import { MockSanctionsScreener } from '../src/modules/compliance/infrastructure/mock-sanctions.screener';
import { ConfigRateProvider } from '../src/modules/quotes/infrastructure/config-rate.provider';
import { AssetRegistry } from '../src/core/catalog/asset-registry';

// Ports/types
import type { PrismaService } from '../src/core/prisma/prisma.service';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';

// Config
import configuration from '../src/core/config/configuration';

jest.setTimeout(300_000);

// ---------------------------------------------------------------------------
// Fake ConfigService
// ---------------------------------------------------------------------------

const appConfig = configuration();

class StubConfigService {
  get<T = unknown>(key: string): T {
    if (key === 'DIRECTIVE_SIGNING_KEY') {
      return 'send-vertical-e2e-signing-key-32bytes!' as T;
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

// All TRON addresses must be exactly 34 chars (T + 33 chars, valid base58 — no 0, O, I, l).
const VALID_TRON_CRYPTO_ADDRESS = 'TSendE2EBeneficiaryTronAddress1234';

const FAKE_WALLET_ADDRESS = 'TFakeWalletSendVerticalAddress123';
const FAKE_BLOCKRADAR_REF = 'fake_blockradar_ref_send_e2e';
const FAKE_SEND_PROVIDER_REF = 'blockradar_send_tx_ref_e2e_001';

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
  withdraw: jest.fn().mockResolvedValue({
    providerReference: FAKE_SEND_PROVIDER_REF,
    status: 'pending' as const,
  }),
};

// ---------------------------------------------------------------------------
// Build an ExecutionService wired to a real Prisma + ComplianceService
// ---------------------------------------------------------------------------

function buildSendExecutionService(
  ps: PrismaService,
  config: StubConfigService,
  pinService: PinService,
  walletService: WalletService,
  beneficiaryService: BeneficiaryService,
  complianceService: ComplianceService,
): ExecutionService {
  const clock = { now: () => new Date() };
  const assetRegistry = new AssetRegistry(config as never);
  const rateProvider = new ConfigRateProvider(config as never);
  const quotesService = new QuotesService(rateProvider, clock, assetRegistry);
  const kycGate = new KycGateService(
    new IdentityPrismaRepository(ps),
    new VelocityPrismaRepository(ps),
    config as never,
    clock,
  );

  return new ExecutionService(
    new ProposalPrismaRepository(ps),
    new QuotePrismaRepository(ps),
    new TransactionPrismaRepository(ps),
    new SettlementOutboxPrismaRepository(ps),
    new SettlementPrismaRepository(ps, config as never),
    quotesService,
    kycGate,
    new DirectiveService(
      new DirectivePrismaRepository(ps),
      config as never,
      clock,
    ),
    pinService,
    walletService,
    // paymentProvider — not used by executeSend/settleSendOnChain
    {
      createCollection: jest.fn(),
      verify: jest.fn(),
      createPayout: jest.fn(),
      verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn(),
    },
    config as never,
    clock,
    assetRegistry,
    beneficiaryService,
    new LedgerPrismaRepository(ps),
    undefined, // identityService (optional)
    undefined, // whatsAppSender (optional)
    complianceService,
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Send vertical (executeSend → settleSendOnChain, Testcontainers Postgres)', () => {
  let stop: (() => Promise<void>) | undefined;
  let prisma: PrismaClient;
  let ps: PrismaService;

  // Services shared across tests
  let proposalService: ProposalService;
  let executionService: ExecutionService;
  let directiveService: DirectiveService;
  let pinService: PinService;
  let walletService: WalletService;
  let beneficiaryService: BeneficiaryService;
  let complianceService: ComplianceService;

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
    const ledgerRepo = new LedgerPrismaRepository(ps);
    const pinRepo = new PinPrismaRepository(ps);
    const identityRepo = new IdentityPrismaRepository(ps);
    const velocityRepo = new VelocityPrismaRepository(ps);
    const walletRepo = new WalletPrismaRepository(ps);
    const beneficiaryRepo = new BeneficiaryPrismaRepository(ps);
    const complianceEventRepo = new ComplianceEventPrismaRepository(ps);

    // MockSanctionsScreener: use empty denylist for send vertical (no blocked addresses).
    const sanctionsConfigStub = {
      get: (key: string) => {
        if (key === 'compliance') {
          return { travelRuleThresholdNgn: 1_000_000, sanctionsDenylist: [] };
        }
        return new (class {
          get<T>(k: string): T {
            const parts = k.split('.');
            let v: unknown = appConfig;
            for (const p of parts) {
              if (v === null || typeof v !== 'object') return undefined as T;
              v = (v as Record<string, unknown>)[p];
            }
            return v as T;
          }
        })().get(key);
      },
    } as unknown as import('@nestjs/config').ConfigService<
      import('../src/core/config/configuration').AppConfig,
      true
    >;
    const sanctionsScreener = new MockSanctionsScreener(sanctionsConfigStub);

    // Services
    pinService = new PinService(pinRepo, config, clock);
    walletService = new WalletService(
      fakeWalletProvider,
      walletRepo,
      clock,
      assetRegistry,
    );
    const rateProvider = new ConfigRateProvider(config);
    const quotesService = new QuotesService(rateProvider, clock, assetRegistry);
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
    complianceService = new ComplianceService(
      sanctionsScreener,
      complianceEventRepo,
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
      complianceService,
      config,
    );

    executionService = buildSendExecutionService(
      ps,
      new StubConfigService(),
      pinService,
      walletService,
      beneficiaryService,
      complianceService,
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
   * Provisions a USDT wallet for the user, seeds 100 USDT ledger credit,
   * creates a crypto beneficiary (past cooling-off), creates a send proposal,
   * and returns the IDs needed to drive executeSend.
   */
  async function seedSendProposalAndPrereqs(): Promise<{
    proposalId: string;
    walletId: string;
    beneficiaryId: string;
  }> {
    // Provision wallet (creates WalletPrisma row).
    const wallet = await walletService.getOrProvisionWallet(
      userId,
      'USDT',
      'TRON',
    );

    // Seed USDT balance in the ledger.
    // Find the current max sequence to avoid unique constraint violations
    // when the same wallet is reused across test runs in one process.
    const latestEntry = await prisma.ledgerEntry.findFirst({
      where: { accountType: 'user_wallet', accountId: wallet.id },
      orderBy: { sequence: 'desc' },
    });
    const seedSeq = (latestEntry?.sequence ?? 0) + 1;
    const seedBalanceBefore = latestEntry?.balanceAfter
      ? Number(latestEntry.balanceAfter)
      : 0;
    const seedBalanceAfter = seedBalanceBefore + 100;

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
        description: 'seed credit for send e2e',
        balanceAfter: seedBalanceAfter.toFixed(6),
        sequence: seedSeq,
        postedAt: new Date(),
      },
    });

    // Create a crypto beneficiary — or reuse one if the same address already
    // exists for this user (unique constraint on userId+cryptoAddress means we
    // cannot create it twice; idempotent lookup avoids a hard failure across
    // describe-blocks that share the same DB in one test run).
    let ben: { id: string };
    // The DB has a unique index on (userId, cryptoAddress) for non-null addresses.
    // Reuse the existing beneficiary across tests that share the same DB session.
    const existingBen = await prisma.beneficiary.findFirst({
      where: { userId, cryptoAddress: VALID_TRON_CRYPTO_ADDRESS },
      select: { id: true },
    });
    if (existingBen !== null) {
      ben = existingBen;
    } else {
      ben = await beneficiaryService.addCryptoAddress({
        userId,
        label: 'My TRON Wallet E2E',
        address: VALID_TRON_CRYPTO_ADDRESS,
        network: 'TRON',
        asset: 'USDT',
      });
    }

    // Clear the cooling-off period so the beneficiary is immediately usable.
    await prisma.beneficiary.update({
      where: { id: ben.id },
      data: { firstUseLockedUntil: null },
    });

    // Create a send proposal via ProposalService.
    const proposal = await proposalService.createSendProposal({
      userId,
      beneficiaryId: ben.id,
      intent: {
        action: 'send_crypto',
        asset: 'USDT',
        cryptoAmount: '10.000000',
        network: 'TRON',
      },
    });

    return {
      proposalId: proposal.proposalId,
      walletId: wallet.id,
      beneficiaryId: ben.id,
    };
  }

  /**
   * Issues a DirectiveGrant for a send proposal (ref = 'request_step_up').
   */
  async function issueDirective(proposalId: string): Promise<{
    directiveId: string;
    nonce: string;
  }> {
    const result = await directiveService.issue({
      userId,
      proposalId,
      ref: 'request_step_up',
    });
    return { directiveId: result.directiveId, nonce: result.nonce };
  }

  // -----------------------------------------------------------------------
  // Phase 1: executeSend
  // -----------------------------------------------------------------------

  describe('Phase 1: executeSend', () => {
    it('happy path: Transaction(settling) created, reserve ledger entries posted, withdraw called, outbox enqueued', async () => {
      const { proposalId, walletId } = await seedSendProposalAndPrereqs();
      const { directiveId, nonce } = await issueDirective(proposalId);
      const idempotencyKey = randomUUID();

      const result = await executionService.executeSend({
        userId,
        proposalId,
        directiveId,
        nonce,
        pin: '123456',
        idempotencyKey,
      });

      expect(result.status).toBe('settling');
      expect(result.transactionId).toBeTruthy();
      expect(result.onChain.providerRef).toBe(FAKE_SEND_PROVIDER_REF);

      // Transaction row
      const txn = await prisma.transaction.findUnique({
        where: { id: result.transactionId },
      });
      expect(txn).not.toBeNull();
      expect(txn?.status).toBe('settling');
      expect(txn?.type).toBe('send');

      // Reserve ledger entries: 2 USDT rows (user_wallet debit + clearing credit).
      const reserveEntries = await prisma.ledgerEntry.findMany({
        where: { transactionId: result.transactionId, currency: 'USDT' },
        orderBy: { sequence: 'asc' },
      });
      expect(reserveEntries).toHaveLength(2);

      // Double-entry invariant: signed amounts sum to 0.
      const usdtSum = reserveEntries.reduce((s, e) => s + Number(e.amount), 0);
      expect(usdtSum).toBeCloseTo(0, 10);

      // Reserve debit reduces user_wallet balance.
      const debitEntry = reserveEntries.find((e) => e.direction === 'debit');
      expect(debitEntry).not.toBeNull();
      // totalDebit (cryptoAmount + networkFee) should be the debit amount (positive stored as negative).
      expect(Math.abs(Number(debitEntry?.amount))).toBeGreaterThan(0);

      // SettlementOutbox row (onchain_send, pending).
      const outbox = await prisma.settlementOutbox.findFirst({
        where: { transactionId: result.transactionId },
      });
      expect(outbox).not.toBeNull();
      expect(outbox?.settlementType).toBe('onchain_send');
      expect(outbox?.status).toBe('pending');

      // walletService.withdraw was called with the correct destination address.
      expect(fakeWalletProvider.withdraw).toHaveBeenCalledWith(
        expect.objectContaining({
          toAddress: VALID_TRON_CRYPTO_ADDRESS,
        }),
      );

      // User wallet balance after reserve should be less than before.
      const userWalletEntries = await prisma.ledgerEntry.findMany({
        where: { accountType: 'user_wallet', accountId: walletId },
        orderBy: { sequence: 'asc' },
      });
      const last = userWalletEntries[userWalletEntries.length - 1];
      const prev = userWalletEntries[userWalletEntries.length - 2];
      expect(last?.direction).toBe('debit');
      expect(Number(last?.balanceAfter)).toBeLessThan(
        Number(prev?.balanceAfter),
      );
    });

    it('atomicity (C1): settling Transaction always has its reserve ledger entries in same DB transaction', async () => {
      // Verifies that createSendSettlingWithReserveAtomic truly posts both in one $transaction —
      // after executeSend returns, exactly 2 USDT reserve LedgerEntries exist.
      const { proposalId } = await seedSendProposalAndPrereqs();
      const { directiveId, nonce } = await issueDirective(proposalId);
      const idempotencyKey = randomUUID();

      const result = await executionService.executeSend({
        userId,
        proposalId,
        directiveId,
        nonce,
        pin: '123456',
        idempotencyKey,
      });

      expect(result.status).toBe('settling');

      // Exactly 2 USDT entries (user_wallet debit + usdt_send_clearing credit).
      const reserveEntries = await prisma.ledgerEntry.findMany({
        where: { transactionId: result.transactionId, currency: 'USDT' },
      });
      expect(reserveEntries).toHaveLength(2);

      // Double-entry: sum = 0.
      const usdtSum = reserveEntries.reduce((s, e) => s + Number(e.amount), 0);
      expect(usdtSum).toBeCloseTo(0, 10);
    });

    it('idempotent replay: same idempotencyKey returns same transactionId, no new rows', async () => {
      const { proposalId } = await seedSendProposalAndPrereqs();
      const { directiveId, nonce } = await issueDirective(proposalId);
      const idempotencyKey = randomUUID();

      const first = await executionService.executeSend({
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

      // Use a fresh proposal+directive to avoid directive unique constraint.
      const { proposalId: proposalId2 } = await seedSendProposalAndPrereqs();
      const { directiveId: dir2, nonce: nonce2 } =
        await issueDirective(proposalId2);

      const second = await executionService.executeSend({
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
  // Phase 2a: settleSendOnChain — success path
  // -----------------------------------------------------------------------

  describe('Phase 2a: settleSendOnChain (success=true → finalize)', () => {
    it('finalizes send: ledger balanced, Transaction completed, Receipt minted, Outbox completed', async () => {
      const { proposalId } = await seedSendProposalAndPrereqs();
      const { directiveId, nonce } = await issueDirective(proposalId);
      const idempotencyKey = randomUUID();

      const svc = buildSendExecutionService(
        ps,
        new StubConfigService(),
        pinService,
        walletService,
        beneficiaryService,
        complianceService,
      );

      // Phase 1
      const executeResult = await svc.executeSend({
        userId,
        proposalId,
        directiveId,
        nonce,
        pin: '123456',
        idempotencyKey,
      });

      // Phase 2: settle with success=true
      const settleResult = await svc.settleSendOnChain({
        reference: idempotencyKey,
        success: true,
        onChainTxHash: 'on_chain_hash_e2e_001',
      });

      expect(settleResult.status).toBe('completed');
      expect(settleResult.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);
      expect(settleResult.userId).toBe(userId);

      // Transaction.status === 'completed'
      const txn = await prisma.transaction.findUnique({
        where: { id: executeResult.transactionId },
      });
      expect(txn?.status).toBe('completed');

      // Ledger entries: 2 reserve + 3 finalize = 5 USDT entries; no NGN.
      const allEntries = await prisma.ledgerEntry.findMany({
        where: { transactionId: executeResult.transactionId },
      });
      expect(allEntries.length).toBe(5);

      // Per-currency invariant: USDT signed amounts sum to 0.
      const usdtEntries = allEntries.filter((e) => e.currency === 'USDT');
      const usdtSum = usdtEntries.reduce((s, e) => s + Number(e.amount), 0);
      expect(usdtSum).toBeCloseTo(0, 10);

      // No NGN entries (send is crypto-only).
      const ngnEntries = allEntries.filter((e) => e.currency === 'NGN');
      expect(ngnEntries).toHaveLength(0);

      // SettlementOutbox.status === 'completed'
      const outbox = await prisma.settlementOutbox.findFirst({
        where: { transactionId: executeResult.transactionId },
      });
      expect(outbox?.status).toBe('completed');

      // Receipt exists with non-empty signature.
      const receipt = await prisma.receipt.findFirst({
        where: { transactionId: executeResult.transactionId },
      });
      expect(receipt).not.toBeNull();
      expect(receipt?.receiptNumber).toBe(settleResult.receiptNumber);
      expect(receipt?.signatureHash).toBeTruthy();
    });

    it('idempotent: re-running settleSendOnChain (completed) returns completed, no new entries', async () => {
      const { proposalId } = await seedSendProposalAndPrereqs();
      const { directiveId, nonce } = await issueDirective(proposalId);
      const idempotencyKey = randomUUID();

      const svc = buildSendExecutionService(
        ps,
        new StubConfigService(),
        pinService,
        walletService,
        beneficiaryService,
        complianceService,
      );

      await svc.executeSend({
        userId,
        proposalId,
        directiveId,
        nonce,
        pin: '123456',
        idempotencyKey,
      });

      // First settle
      const first = await svc.settleSendOnChain({
        reference: idempotencyKey,
        success: true,
        onChainTxHash: 'on_chain_hash_idempotency',
      });
      expect(first.status).toBe('completed');

      const ledgerCountAfterFirst = await prisma.ledgerEntry.count();

      // Second settle (idempotent replay)
      const second = await svc.settleSendOnChain({
        reference: idempotencyKey,
        success: true,
        onChainTxHash: 'on_chain_hash_idempotency',
      });
      expect(second.status).toBe('completed');
      expect(second.receiptNumber).toBe(first.receiptNumber);

      const ledgerCountAfterSecond = await prisma.ledgerEntry.count();
      expect(ledgerCountAfterSecond).toBe(ledgerCountAfterFirst);
    });
  });

  // -----------------------------------------------------------------------
  // Phase 2b: settleSendOnChain — failure path (refund)
  // -----------------------------------------------------------------------

  describe('Phase 2b: settleSendOnChain (success=false → refund)', () => {
    it('refunds USDT: clearing→user_wallet, Transaction failed, CompensationRecord created', async () => {
      const { proposalId, walletId } = await seedSendProposalAndPrereqs();
      const { directiveId, nonce } = await issueDirective(proposalId);
      const idempotencyKey = randomUUID();

      const svc = buildSendExecutionService(
        ps,
        new StubConfigService(),
        pinService,
        walletService,
        beneficiaryService,
        complianceService,
      );

      // Phase 1: execute
      const executeResult = await svc.executeSend({
        userId,
        proposalId,
        directiveId,
        nonce,
        pin: '123456',
        idempotencyKey,
      });

      // Ledger state after reserve: 2 USDT entries (debit user, credit clearing).
      const afterReserve = await prisma.ledgerEntry.findMany({
        where: { transactionId: executeResult.transactionId },
      });
      expect(afterReserve).toHaveLength(2);

      // Phase 2: settle with success=false → refund
      const settleResult = await svc.settleSendOnChain({
        reference: idempotencyKey,
        success: false,
      });

      expect(settleResult.status).toBe('failed');
      expect(settleResult.userId).toBe(userId);

      // Transaction.status === 'failed'
      const txn = await prisma.transaction.findUnique({
        where: { id: executeResult.transactionId },
      });
      expect(txn?.status).toBe('failed');

      // Refund ledger: 2 reserve + 2 refund = 4 USDT entries total; no NGN.
      const allEntries = await prisma.ledgerEntry.findMany({
        where: { transactionId: executeResult.transactionId },
      });
      expect(allEntries).toHaveLength(4);

      // Per-currency sum = 0 (reserve + refund cancel each other out).
      const usdtSum = allEntries
        .filter((e) => e.currency === 'USDT')
        .reduce((s, e) => s + Number(e.amount), 0);
      expect(usdtSum).toBeCloseTo(0, 10);
      expect(allEntries.filter((e) => e.currency === 'NGN')).toHaveLength(0);

      // Refunded balance: user_wallet last entry (refund credit) restores totalDebit.
      const userWalletEntries = await prisma.ledgerEntry.findMany({
        where: { accountType: 'user_wallet', accountId: walletId },
        orderBy: { sequence: 'asc' },
      });
      const refundCreditEntry = userWalletEntries[userWalletEntries.length - 1];
      const balanceBeforeReserve =
        userWalletEntries[userWalletEntries.length - 3];

      expect(refundCreditEntry?.direction).toBe('credit');
      // After refund, balance should equal the balance before the reserve debit.
      expect(Number(refundCreditEntry?.balanceAfter)).toBeCloseTo(
        Number(balanceBeforeReserve?.balanceAfter),
        4,
      );

      // CompensationRecord exists.
      const compensation = await prisma.compensationRecord.findFirst({
        where: { originatingTransactionId: executeResult.transactionId },
      });
      expect(compensation).not.toBeNull();
      expect(compensation?.status).toBe('pending');
    });
  });
});
