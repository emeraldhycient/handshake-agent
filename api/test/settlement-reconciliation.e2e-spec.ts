/**
 * E2E tests for SettlementReconciliationService (Fix F — webhook-miss recovery).
 *
 * Boots real repos + ExecutionService against Testcontainers Postgres.
 * Instantiates SettlementReconciliationService with a stub config whose
 * gracePeriodSec is 0 so all pending rows are immediately eligible.
 *
 * Scenarios:
 *   1. Sell (processor_payout): executeSell creates a settling txn + pending outbox row.
 *      No webhook fired. Calling reconciler.tick() → verifyPayout returns 'successful'
 *      → settleSellPayout finalizes → Transaction=completed + outbox=completed.
 *
 *   2a. Send (onchain_send) — provider PENDING: reconciler queries provider, gets 'pending'
 *       → row stays open (Transaction=settling, outbox=pending, NO ledger movement/refund).
 *
 *   2b. Send (onchain_send) — provider FAILED: reconciler queries provider, gets 'failed'
 *       → settleSendOnChain(success=false) → Transaction=failed + outbox=completed (refund).
 *
 *   2c. Send (onchain_send) — provider SUCCESS: reconciler queries provider, gets 'success'
 *       → settleSendOnChain(success=true, onChainTxHash) → Transaction=completed + outbox=completed.
 *
 *   3. Idempotency: row already completed → findPending returns [] (completed rows
 *      are excluded by the pending filter) → no settle called.
 *
 * Services are wired manually (no Nest DI), same pattern as sell-vertical e2e.
 *
 * Requires Docker. Runs only in the test:e2e lane (jest-e2e.json).
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
import { LedgerPrismaRepository } from '../src/modules/transactions/infrastructure/ledger.prisma.repository';
import { PinPrismaRepository } from '../src/core/auth/infrastructure/pin.prisma.repository';
import { SessionPrismaRepository } from '../src/core/auth/infrastructure/session.prisma.repository';
import { IdentityPrismaRepository } from '../src/modules/identity/infrastructure/identity.prisma.repository';
import { VelocityPrismaRepository } from '../src/modules/identity/infrastructure/velocity.prisma.repository';
import { WalletPrismaRepository } from '../src/modules/wallets/infrastructure/wallet.prisma.repository';
import { BeneficiaryPrismaRepository } from '../src/modules/beneficiaries/infrastructure/beneficiary.prisma.repository';

// Services
import { PinService } from '../src/core/auth/pin.service';
import { SessionService } from '../src/core/auth/session.service';
import { DirectiveService } from '../src/modules/transactions/application/directive.service';
import { ProposalService } from '../src/modules/transactions/application/proposal.service';
import { ExecutionService } from '../src/modules/transactions/application/execution.service';
import { SettlementReconciliationService } from '../src/modules/transactions/application/settlement-reconciliation.service';
import { KycGateService } from '../src/modules/identity/application/kyc-gate.service';
import { QuotesService } from '../src/modules/quotes/application/quotes.service';
import { WalletService } from '../src/modules/wallets/application/wallet.service';
import { BeneficiaryService } from '../src/modules/beneficiaries/application/beneficiary.service';
import { ConfigRateProvider } from '../src/modules/quotes/infrastructure/config-rate.provider';
import { AssetRegistry } from '../src/core/catalog/asset-registry';

// Types
import type { PrismaService } from '../src/core/prisma/prisma.service';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';
import type { INameEnquiry } from '../src/modules/beneficiaries/application/ports/name-enquiry.port';
// Config
import configuration from '../src/core/config/configuration';

jest.setTimeout(300_000);

// ---------------------------------------------------------------------------
// Stub ConfigService
// ---------------------------------------------------------------------------

const appConfig = configuration();

class StubConfigService {
  get<T = unknown>(key: string): T {
    if (key === 'DIRECTIVE_SIGNING_KEY') {
      return 'reconcil-e2e-signing-key-32-bytes-min!!' as T;
    }
    if (key === 'RECEIPT_SIGNING_KEY') {
      return 'reconcil-e2e-receipt-signing-key-32bytes!' as T;
    }
    if (key === 'reconciliation') {
      return {
        gracePeriodSec: 0, // no grace: all pending rows immediately eligible
        batchSize: 20,
      } as T;
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

const FAKE_WALLET_ADDRESS = 'TReconcilE2EWalletAddress123456789';
const FAKE_BLOCKRADAR_REF = 'fake_blockradar_ref_reconcil_e2e';
const FAKE_FLW_PAYOUT_REF = 'flw_fake_payout_reconcil_e2e_001';
const FAKE_SEND_PROVIDER_REF = 'blockradar_send_tx_ref_reconcil_e2e';

// Configurable payment provider so individual tests can control verifyPayout result
function makeFakePaymentProvider(
  verifyPayoutStatus: 'successful' | 'pending' | 'failed' = 'successful',
): IPaymentProvider {
  return {
    createCollection: jest.fn().mockResolvedValue({
      accountNumber: '0000000001',
      bankName: 'Test Bank',
      providerRef: 'flw_collection_reconcil_unused',
    }),
    verify: jest.fn().mockResolvedValue({
      status: 'successful',
      amount: '10000',
      currency: 'NGN',
      providerRef: 'flw_collection_reconcil_unused',
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

/**
 * Configurable wallet provider: `withdrawalStatus` controls what
 * `getWithdrawalStatus` returns when the reconciler polls the provider.
 * Default: 'pending' — safe (row stays open, no premature refund).
 */
function makeFakeWalletProvider(
  withdrawalStatus: 'pending' | 'success' | 'failed' = 'pending',
  onChainTxHash?: string,
): IWalletProvider {
  return {
    provisionAddress: jest.fn().mockResolvedValue({
      address: FAKE_WALLET_ADDRESS,
      providerReference: FAKE_BLOCKRADAR_REF,
    }),
    getBalance: jest.fn().mockResolvedValue({
      amount: '100',
      decimals: 6,
    }),
    withdraw: jest.fn().mockResolvedValue({
      providerReference: FAKE_SEND_PROVIDER_REF,
      status: 'pending' as const,
    }),
    getWithdrawalStatus: jest.fn().mockResolvedValue({
      status: withdrawalStatus,
      ...(withdrawalStatus === 'success' && onChainTxHash
        ? { onChainTxHash }
        : {}),
    }),
  };
}

const fakeNameEnquiry: INameEnquiry = {
  resolve: jest.fn().mockResolvedValue({
    accountName: 'RECONCIL TEST USER',
    provider: 'mock',
    reference: 'mock-ref-reconcil',
  }),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SettlementReconciliationService (Testcontainers Postgres)', () => {
  let stop: (() => Promise<void>) | undefined;
  let prisma: PrismaClient;
  let ps: PrismaService;

  let outboxRepo: SettlementOutboxPrismaRepository;
  let executionService: ExecutionService;
  let reconciler: SettlementReconciliationService;
  let walletService: WalletService;
  let proposalService: ProposalService;
  let directiveService: DirectiveService;
  let pinService: PinService;
  let beneficiaryService: BeneficiaryService;

  // Mutable wallet provider: individual send tests reconfigure getWithdrawalStatus.
  let walletProvider: IWalletProvider;

  let userId: string;

  beforeAll(async () => {
    // Silence scheduler log noise in test output.
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

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
    outboxRepo = new SettlementOutboxPrismaRepository(ps);
    const settlementRepo = new SettlementPrismaRepository(ps, config);
    const ledgerRepo = new LedgerPrismaRepository(ps);
    const pinRepo = new PinPrismaRepository(ps);
    const identityRepo = new IdentityPrismaRepository(ps);
    const velocityRepo = new VelocityPrismaRepository(ps);
    const walletRepo = new WalletPrismaRepository(ps);
    const beneficiaryRepo = new BeneficiaryPrismaRepository(ps);

    // Default wallet provider: getWithdrawalStatus returns 'pending' (safe).
    walletProvider = makeFakeWalletProvider('pending');

    // Services
    const sessionRepo = new SessionPrismaRepository(ps);
    const sessionService = new SessionService(sessionRepo, config, clock);
    pinService = new PinService(pinRepo, config, clock);
    walletService = new WalletService(
      walletProvider,
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
      fakeNameEnquiry,
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
      {
        screenSendDestination: () =>
          Promise.resolve({ passed: true, complianceEventId: '' }),
      } as never,
      config,
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
      undefined, // identityService (optional)
      undefined, // whatsAppSender (optional)
      // complianceService: needed for send
      {
        screenSendDestination: jest.fn().mockResolvedValue({
          passed: true,
          complianceEventId: 'compliance-reconcil-e2e',
        }),
      } as never,
      sessionService, // required for executeSend (Fix G §3.4)
    );

    reconciler = new SettlementReconciliationService(
      outboxRepo,
      executionService,
      config,
    );

    // Seed a KYC-verified (Tier 2) user with a PIN + a bound device (Fix G §3.4).
    const user = await prisma.user.create({
      data: {
        kycStatus: 'verified',
        kycTier: 'tier_2',
        status: 'active',
      },
    });
    userId = user.id;
    await pinService.setPin(userId, '111111');

    // Create a bound device and pin it to the user so executeSend can
    // resolve the device for step-up recording (fail-closed, Fix G §3.4).
    const device = await prisma.device.create({
      data: {
        userId,
        fingerprint: `reconcil-e2e-device-${randomUUID()}`,
        trustState: 'bound',
        boundAt: new Date(),
      },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { pinnedDeviceId: device.id },
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await stop?.();
  });

  // ---------------------------------------------------------------------------
  // Helper: seed USDT ledger balance for user's wallet
  // ---------------------------------------------------------------------------

  async function seedUsdtBalance(
    walletId: string,
    amount: string,
  ): Promise<void> {
    const seedTxn = await prisma.transaction.create({
      data: {
        userId,
        type: 'buy',
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: `seed-${randomUUID()}`,
        fxRateSnapshot: '1600',
        metadata: {},
        pinVerifiedAt: new Date(),
      },
    });

    // Find the current max sequence to avoid unique constraint violation.
    const latestEntry = await prisma.ledgerEntry.findFirst({
      where: { accountType: 'user_wallet', accountId: walletId },
      orderBy: { sequence: 'desc' },
    });
    const seedSeq = (latestEntry?.sequence ?? 0) + 1;
    const seedBalanceBefore = latestEntry?.balanceAfter
      ? Number(latestEntry.balanceAfter)
      : 0;
    const seedBalanceAfter = seedBalanceBefore + Number(amount);

    await prisma.ledgerEntry.create({
      data: {
        transactionId: seedTxn.id,
        accountType: 'user_wallet',
        accountId: walletId,
        currency: 'USDT',
        direction: 'credit',
        amount: `${Number(amount).toFixed(6)}`,
        description: 'seed credit for reconcil e2e',
        balanceAfter: seedBalanceAfter.toFixed(6),
        sequence: seedSeq,
        postedAt: new Date(),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Test 1: Sell — processor_payout reconciliation
  // ---------------------------------------------------------------------------

  it('reconciles a missed sell webhook: pending processor_payout outbox row → settleSellPayout → completed', async () => {
    // Provision wallet + seed sell balance.
    const wallet = await walletService.getOrProvisionWallet(
      userId,
      'USDT',
      'TRON',
    );
    await seedUsdtBalance(wallet.id, '50');

    // Create a bank beneficiary.
    const beneficiary = await beneficiaryService.addBankAccount({
      userId,
      label: 'Reconcil Test Bank',
      accountNumber: '1234567890',
      bankCode: '058',
      accountName: 'Reconcil Test User',
    });

    // Create a sell proposal.
    const sellProposal = await proposalService.createSellProposal({
      userId,
      beneficiaryId: beneficiary.id,
      intent: {
        action: 'sell_crypto',
        asset: 'USDT',
        cryptoAmount: '10.000000',
        fiatCurrency: 'NGN',
      },
    });
    const { proposalId } = sellProposal;

    // Issue a directive grant for PIN.
    const { directiveId, nonce } = await directiveService.issue({
      userId,
      proposalId,
      ref: 'request_pin',
    });

    // Execute sell — creates Transaction(settling) + outbox row(processor_payout, pending).
    const sellResult = await executionService.executeSell({
      userId,
      proposalId,
      directiveId,
      nonce,
      pin: '111111',
      idempotencyKey: randomUUID(),
    });

    expect(sellResult.status).toBe('settling');

    // Verify the outbox row is pending.
    const rowsBefore = await prisma.settlementOutbox.findMany({
      where: { transactionId: sellResult.transactionId, status: 'pending' },
    });
    expect(rowsBefore).toHaveLength(1);
    expect(rowsBefore[0].settlementType).toBe('processor_payout');

    // NO webhook fired. Run the reconciler tick directly.
    await reconciler.tick();

    // Assert: Transaction is now completed.
    const txn = await prisma.transaction.findUnique({
      where: { id: sellResult.transactionId },
    });
    expect(txn?.status).toBe('completed');

    // Assert: Outbox row is now completed.
    const rowsAfter = await prisma.settlementOutbox.findMany({
      where: { transactionId: sellResult.transactionId },
    });
    expect(rowsAfter).toHaveLength(1);
    expect(rowsAfter[0].status).toBe('completed');

    // Assert: A receipt was minted.
    const receipt = await prisma.receipt.findFirst({
      where: { transactionId: sellResult.transactionId },
    });
    expect(receipt).not.toBeNull();
    expect(receipt?.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);
  });

  // ---------------------------------------------------------------------------
  // Test 2a: Send — onchain_send reconciliation (provider PENDING → row stays open)
  // ---------------------------------------------------------------------------

  it('2a: missed webhook + provider pending → Transaction stays settling, outbox stays pending, NO refund', async () => {
    // Configure provider to return 'pending' (safe default).
    (walletProvider.getWithdrawalStatus as jest.Mock).mockResolvedValue({
      status: 'pending',
    });

    const wallet = await walletService.getOrProvisionWallet(
      userId,
      'USDT',
      'TRON',
    );
    await seedUsdtBalance(wallet.id, '50');

    const beneficiary = await beneficiaryService.addCryptoAddress({
      userId,
      label: 'Reconcil Send Pend',
      network: 'TRON',
      address: 'TPendE2EBeneficiaryTronAddr1234567',
      asset: 'USDT',
    });
    await prisma.beneficiary.update({
      where: { id: beneficiary.id },
      data: { firstUseLockedUntil: null },
    });

    const sendProposal = await proposalService.createSendProposal({
      userId,
      beneficiaryId: beneficiary.id,
      intent: {
        action: 'send_crypto',
        asset: 'USDT',
        cryptoAmount: '10.000000',
        network: 'TRON',
      },
    });

    const { directiveId, nonce } = await directiveService.issue({
      userId,
      proposalId: sendProposal.proposalId,
      ref: 'request_step_up',
    });

    const sendResult = await executionService.executeSend({
      userId,
      proposalId: sendProposal.proposalId,
      directiveId,
      nonce,
      pin: '111111',
      idempotencyKey: randomUUID(),
    });

    expect(sendResult.status).toBe('settling');

    const rowsBefore = await prisma.settlementOutbox.findMany({
      where: { transactionId: sendResult.transactionId, status: 'pending' },
    });
    expect(rowsBefore).toHaveLength(1);
    expect(rowsBefore[0].settlementType).toBe('onchain_send');
    expect(rowsBefore[0].payload).not.toHaveProperty('onChainTxHash');

    // Reconciler tick: provider returns 'pending' → row must stay open.
    await reconciler.tick();

    // Transaction MUST still be 'settling' — no premature refund.
    const txnAfter = await prisma.transaction.findUnique({
      where: { id: sendResult.transactionId },
    });
    expect(txnAfter?.status).toBe('settling');

    // Outbox row MUST still be 'pending' — no complete() called.
    const rowsAfter = await prisma.settlementOutbox.findMany({
      where: { transactionId: sendResult.transactionId },
    });
    expect(rowsAfter).toHaveLength(1);
    expect(rowsAfter[0].status).toBe('pending');
  });

  // ---------------------------------------------------------------------------
  // Test 2b: Send — onchain_send reconciliation (provider FAILED → refund)
  // ---------------------------------------------------------------------------

  it('2b: missed webhook + provider failed → settleSendOnChain(success=false) → Transaction=failed, outbox=completed', async () => {
    // Configure provider to return 'failed'.
    (walletProvider.getWithdrawalStatus as jest.Mock).mockResolvedValue({
      status: 'failed',
    });

    const wallet = await walletService.getOrProvisionWallet(
      userId,
      'USDT',
      'TRON',
    );
    await seedUsdtBalance(wallet.id, '50');

    const beneficiary = await beneficiaryService.addCryptoAddress({
      userId,
      label: 'Reconcil Send Fail',
      network: 'TRON',
      address: 'TFai1E2EBeneficiaryTronAddr1234567',
      asset: 'USDT',
    });
    await prisma.beneficiary.update({
      where: { id: beneficiary.id },
      data: { firstUseLockedUntil: null },
    });

    const sendProposal = await proposalService.createSendProposal({
      userId,
      beneficiaryId: beneficiary.id,
      intent: {
        action: 'send_crypto',
        asset: 'USDT',
        cryptoAmount: '10.000000',
        network: 'TRON',
      },
    });

    const { directiveId, nonce } = await directiveService.issue({
      userId,
      proposalId: sendProposal.proposalId,
      ref: 'request_step_up',
    });

    const sendResult = await executionService.executeSend({
      userId,
      proposalId: sendProposal.proposalId,
      directiveId,
      nonce,
      pin: '111111',
      idempotencyKey: randomUUID(),
    });

    expect(sendResult.status).toBe('settling');

    // Reconciler tick: provider returns 'failed' → refund.
    await reconciler.tick();

    const txnAfter = await prisma.transaction.findUnique({
      where: { id: sendResult.transactionId },
    });
    expect(txnAfter?.status).toBe('failed');

    const rowsAfter = await prisma.settlementOutbox.findMany({
      where: { transactionId: sendResult.transactionId },
    });
    expect(rowsAfter).toHaveLength(1);
    expect(rowsAfter[0].status).toBe('completed');
  });

  // ---------------------------------------------------------------------------
  // Test 2c: Send — onchain_send reconciliation (provider SUCCESS → completed)
  // ---------------------------------------------------------------------------

  it('2c: missed webhook + provider success → settleSendOnChain(success=true) → Transaction=completed, outbox=completed', async () => {
    const FAKE_TX_HASH = 'TRON_CHAIN_HASH_ABC123456789012345678901';

    // Configure provider to return 'success' with a hash.
    (walletProvider.getWithdrawalStatus as jest.Mock).mockResolvedValue({
      status: 'success',
      onChainTxHash: FAKE_TX_HASH,
    });

    const wallet = await walletService.getOrProvisionWallet(
      userId,
      'USDT',
      'TRON',
    );
    await seedUsdtBalance(wallet.id, '50');

    const beneficiary = await beneficiaryService.addCryptoAddress({
      userId,
      label: 'Reconcil Send Succ',
      network: 'TRON',
      address: 'TSuccE2EBeneficiaryTronAddr1234567',
      asset: 'USDT',
    });
    await prisma.beneficiary.update({
      where: { id: beneficiary.id },
      data: { firstUseLockedUntil: null },
    });

    const sendProposal = await proposalService.createSendProposal({
      userId,
      beneficiaryId: beneficiary.id,
      intent: {
        action: 'send_crypto',
        asset: 'USDT',
        cryptoAmount: '10.000000',
        network: 'TRON',
      },
    });

    const { directiveId, nonce } = await directiveService.issue({
      userId,
      proposalId: sendProposal.proposalId,
      ref: 'request_step_up',
    });

    const sendResult = await executionService.executeSend({
      userId,
      proposalId: sendProposal.proposalId,
      directiveId,
      nonce,
      pin: '111111',
      idempotencyKey: randomUUID(),
    });

    expect(sendResult.status).toBe('settling');

    // Reconciler tick: provider returns 'success' → finalize.
    await reconciler.tick();

    const txnAfter = await prisma.transaction.findUnique({
      where: { id: sendResult.transactionId },
    });
    expect(txnAfter?.status).toBe('completed');

    const rowsAfter = await prisma.settlementOutbox.findMany({
      where: { transactionId: sendResult.transactionId },
    });
    expect(rowsAfter).toHaveLength(1);
    expect(rowsAfter[0].status).toBe('completed');
  });

  // ---------------------------------------------------------------------------
  // Test 3: findPending excludes completed rows (idempotency guard)
  // ---------------------------------------------------------------------------

  it('findPending: excludes completed outbox rows', async () => {
    // Create a standalone completed outbox row directly in DB.
    const txn = await prisma.transaction.create({
      data: {
        userId,
        type: 'sell',
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: `cs-${randomUUID()}`,
        fxRateSnapshot: '1600',
        metadata: {},
        pinVerifiedAt: new Date(),
      },
    });

    await prisma.settlementOutbox.create({
      data: {
        transactionId: txn.id,
        settlementType: 'processor_payout',
        payload: { reference: txn.idempotencyKey },
        idempotencyKey: randomUUID(),
        status: 'completed', // already drained
      },
    });

    const results = await outboxRepo.findPending({
      olderThanSec: 0,
      limit: 100,
    });

    // The completed row should not appear.
    const found = results.find((r) => r.transactionId === txn.id);
    expect(found).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Test 4: markAttempt increments correctly; complete sets status
  // ---------------------------------------------------------------------------

  it('markAttempt and complete work correctly on a real DB row', async () => {
    const txn = await prisma.transaction.create({
      data: {
        userId,
        type: 'sell',
        status: 'settling',
        idempotencyKey: randomUUID(),
        requestChecksum: `cs-${randomUUID()}`,
        fxRateSnapshot: '1600',
        metadata: {},
        pinVerifiedAt: new Date(),
      },
    });

    const row = await outboxRepo.create({
      transactionId: txn.id,
      settlementType: 'processor_payout',
      payload: { reference: 'some-ref' },
      idempotencyKey: randomUUID(),
      status: 'pending',
    });

    expect(row.attempt).toBe(1);

    await outboxRepo.markAttempt(row.id);

    const afterMark = await prisma.settlementOutbox.findUnique({
      where: { id: row.id },
    });
    expect(afterMark?.attempt).toBe(2);
    expect(afterMark?.lastAttemptAt).not.toBeNull();

    await outboxRepo.complete(row.id);

    const afterComplete = await prisma.settlementOutbox.findUnique({
      where: { id: row.id },
    });
    expect(afterComplete?.status).toBe('completed');
    expect(afterComplete?.completedAt).not.toBeNull();
  });
});
