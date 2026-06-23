/**
 * Integration test for ExecutionService.executeBuy (task 4.5a, CLAUDE.md §3.1).
 *
 * Verifies the FULL buy-execution gauntlet against a REAL Postgres (Testcontainers):
 *   - Real repos (Transaction, Proposal, Quote, Directive, SettlementOutbox, etc.)
 *   - Real PinService + PinPrismaRepository (PIN is hashed and verified)
 *   - Real DirectiveService + DirectivePrismaRepository (HMAC-signed, atomic consume)
 *   - Real KycGateService + IdentityPrismaRepository + VelocityPrismaRepository
 *   - FAKE WALLET_PROVIDER (in-process fake — no Blockradar calls)
 *   - FAKE PAYMENT_PROVIDER (in-process fake — no Flutterwave calls)
 *
 * Services are wired manually (no Nest DI) following the same pattern as all
 * other e2e tests in this project (which instantiate repos and services directly).
 *
 * Happy-path assertions:
 *   - Transaction row (settling) is persisted.
 *   - SettlementOutbox row is persisted.
 *   - A second call with the same idempotencyKey returns the same transactionId
 *     and creates NO duplicate rows.
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

// Services
import { PinService } from '../src/core/auth/pin.service';
import { DirectiveService } from '../src/modules/transactions/application/directive.service';
import { ProposalService } from '../src/modules/transactions/application/proposal.service';
import { ExecutionService } from '../src/modules/transactions/application/execution.service';
import { KycGateService } from '../src/modules/identity/application/kyc-gate.service';
import { QuotesService } from '../src/modules/quotes/application/quotes.service';
import { WalletService } from '../src/modules/wallets/application/wallet.service';
import { ConfigRateProvider } from '../src/modules/quotes/infrastructure/config-rate.provider';
import { WalletPrismaRepository } from '../src/modules/wallets/infrastructure/wallet.prisma.repository';
import { AssetRegistry } from '../src/core/catalog/asset-registry';

// Ports/types
import type { PrismaService } from '../src/core/prisma/prisma.service';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';

// Config stub (returns the merged config object that ConfigService.get() would return)
import configuration from '../src/core/config/configuration';

jest.setTimeout(300_000);

// ---------------------------------------------------------------------------
// Fake ConfigService
// ---------------------------------------------------------------------------

const appConfig = {
  ...configuration(),
  // Ensure the signing key is set for DirectiveService.
};

/**
 * Minimal stub of @nestjs/config ConfigService.
 * Only implements the get<T>(key) call used by our services.
 */
class StubConfigService {
  get<T = unknown>(key: string): T {
    // Walk nested key path (e.g. 'buy.maxDriftBps' → appConfig.buy.maxDriftBps)
    const parts = key.split('.');
    let val: unknown = appConfig;
    for (const part of parts) {
      if (val === null || typeof val !== 'object') return undefined as T;
      val = (val as Record<string, unknown>)[part];
    }
    // DIRECTIVE_SIGNING_KEY is a top-level string from env, not in appConfig.
    if (key === 'DIRECTIVE_SIGNING_KEY') {
      return 'e2e-test-signing-key-32-bytes-minimum!!' as T;
    }
    return val as T;
  }
}

// ---------------------------------------------------------------------------
// Fake external providers
// ---------------------------------------------------------------------------

const FAKE_BLOCKRADAR_REF = 'fake_blockradar_ref_e2e';

// provisionAddress returns a unique address per call so multiple test-user wallets
// don't collide on the Wallet.address unique constraint.
const fakeWalletProvider: IWalletProvider = {
  provisionAddress: jest.fn().mockImplementation(() =>
    Promise.resolve({
      address: `TFakeWallet${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      providerReference: FAKE_BLOCKRADAR_REF,
    }),
  ),
  getBalance: jest.fn().mockResolvedValue({
    available: '0',
    pending: '0',
    asset: 'USDT',
    network: 'TRON',
  }),
  withdraw: jest.fn().mockResolvedValue({
    providerReference: 'e2e-tx-ref-stub',
    status: 'pending' as const,
  }),
};

const FAKE_ACCOUNT_NUMBER = '0987654321';
const FAKE_BANK_NAME = 'Test Virtual Bank';
const FAKE_FLW_REF = 'flw_fake_ref_e2e_001';

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
  createPayout: jest.fn(),
  verifyPayout: jest.fn(),
  verifyWebhookSignature: jest.fn().mockReturnValue(true),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ExecutionService.executeBuy (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  // Wired-up services
  let executionService: ExecutionService;
  let directiveService: DirectiveService;
  let proposalService: ProposalService;
  let pinService: PinService;

  // Seeded test user
  let userId: string;

  const clock = { now: () => new Date() };

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    // Boundary cast: PrismaClient → PrismaService (same API surface; safe at runtime).
    const ps = prisma as unknown as PrismaService;

    // Wire repos.
    const proposalRepo = new ProposalPrismaRepository(ps);
    const quoteRepo = new QuotePrismaRepository(ps);
    const directiveRepo = new DirectivePrismaRepository(ps);
    const transactionRepo = new TransactionPrismaRepository(ps);
    const outboxRepo = new SettlementOutboxPrismaRepository(ps);
    const pinRepo = new PinPrismaRepository(ps);
    const identityRepo = new IdentityPrismaRepository(ps);
    const velocityRepo = new VelocityPrismaRepository(ps);
    const walletRepo = new WalletPrismaRepository(ps);

    // Wire config.
    const config = new StubConfigService() as never;

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
      walletService,
      // beneficiaryService and ledgerRepo are not used in buy-proposal tests
      { getById: () => Promise.resolve(null) } as never,
      assetRegistry,
      { getAccountBalance: () => Promise.resolve('0') },
      // complianceService and configService are required deps but not invoked on the buy path.
      {
        screenSendDestination: () =>
          Promise.resolve({ passed: true, complianceEventId: '' }),
      } as never,
      config,
    );

    const settlementRepo = new SettlementPrismaRepository(ps, config);

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
      // beneficiaryService: sell tests use a dedicated e2e spec; stubs here suffice
      { getById: () => Promise.resolve(null) } as never,
      new LedgerPrismaRepository(ps),
    );

    // Seed a User that is KYC-verified (Tier 1) and has a PIN set.
    const user = await prisma.user.create({
      data: {
        kycStatus: 'verified',
        kycTier: 'tier_1',
        status: 'active',
      },
    });
    userId = user.id;

    // Set PIN '123456' via real PinService (hashes with scrypt + persists).
    await pinService.setPin(userId, '123456');
  });

  afterAll(async () => {
    await stop?.();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Creates a Quote + Proposal pair via real ProposalService.
   */
  async function seedProposalAndQuote(): Promise<{
    proposalId: string;
    quoteId: string;
  }> {
    const result = await proposalService.createBuyProposal({
      userId,
      intent: {
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount: '10000',
        fiatCurrency: 'NGN',
      },
    });
    return { proposalId: result.proposalId, quoteId: result.quoteId };
  }

  /**
   * Issues a real request_pin DirectiveGrant (HMAC-signed) for the proposal.
   * Returns the directiveId + plain nonce for use in executeBuy.
   */
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

  // ---------------------------------------------------------------------------
  // Happy path: Transaction + SettlementOutbox persisted
  // ---------------------------------------------------------------------------

  it('happy path: persists Transaction (settling) + SettlementOutbox row', async () => {
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

    // Returns the expected shape.
    expect(result.transactionId).toBeTruthy();
    expect(result.status).toBe('settling');
    expect(result.payment.accountNumber).toBe(FAKE_ACCOUNT_NUMBER);
    expect(result.payment.bankName).toBe(FAKE_BANK_NAME);
    expect(result.payment.providerRef).toBe(FAKE_FLW_REF);
    expect(result.payment.currency).toBe('NGN');
    expect(result.payment.amount).toBe('10000');

    // Verify Transaction row persisted.
    const txn = await prisma.transaction.findUnique({
      where: { id: result.transactionId },
    });
    expect(txn).not.toBeNull();
    expect(txn!.status).toBe('settling');
    expect(txn!.userId).toBe(userId);
    expect(txn!.proposalId).toBe(proposalId);
    expect(txn!.idempotencyKey).toBe(idempotencyKey);
    expect(txn!.type).toBe('buy');
    expect(txn!.pinVerifiedAt).not.toBeNull();

    // Verify SettlementOutbox row persisted.
    const outbox = await prisma.settlementOutbox.findFirst({
      where: { transactionId: result.transactionId },
    });
    expect(outbox).not.toBeNull();
    expect(outbox!.settlementType).toBe('processor_collection');
    expect(outbox!.status).toBe('pending');
    expect(outbox!.processorRef).toBe(FAKE_FLW_REF);

    // Verify Proposal was marked executing.
    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
    });
    expect(proposal!.status).toBe('executing');
  });

  // ---------------------------------------------------------------------------
  // Idempotent replay: second call returns same transactionId, no duplicate rows
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Velocity enforcement (V1 — §3.3 gap fix)
  //
  // These tests use a DEDICATED isolated user seeded per-test so that velocity
  // counters from the happy-path and idempotency tests don't interfere.
  // Tier 1 caps: perTxFiatMax=50_000 NGN, dailyFiatMax=200_000 NGN, dailyTxCountMax=10
  // ---------------------------------------------------------------------------

  it('velocity: executeBuy writes VelocityCounter rows atomically; subsequent KYC gate reads them', async () => {
    // Seed an isolated user so no interference from other tests.
    const velocityUser = await prisma.user.create({
      data: { kycStatus: 'verified', kycTier: 'tier_1', status: 'active' },
    });
    await pinService.setPin(velocityUser.id, '123456');

    // Seed a proposal for this user (reuse proposalService with the right userId).
    const quoteResult = await proposalService.createBuyProposal({
      userId: velocityUser.id,
      intent: {
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount: '10000',
        fiatCurrency: 'NGN',
      },
    });
    const dir = await directiveService.issue({
      proposalId: quoteResult.proposalId,
      userId: velocityUser.id,
      ref: 'request_pin',
    });

    // Execute buy — this should atomically write velocity counters.
    await executionService.executeBuy({
      userId: velocityUser.id,
      proposalId: quoteResult.proposalId,
      directiveId: dir.directiveId,
      nonce: dir.nonce,
      pin: '123456',
      idempotencyKey: randomUUID(),
    });

    // Verify velocity counters were written to the DB.
    const amountCounter = await prisma.velocityCounter.findUnique({
      where: {
        userId_counterType: {
          userId: velocityUser.id,
          counterType: 'amount_24h',
        },
      },
    });
    const countCounter = await prisma.velocityCounter.findUnique({
      where: {
        userId_counterType: {
          userId: velocityUser.id,
          counterType: 'count_24h',
        },
      },
    });

    expect(amountCounter).not.toBeNull();
    expect(Number(amountCounter!.currentValue)).toBe(10_000);
    expect(countCounter).not.toBeNull();
    expect(Number(countCounter!.currentValue)).toBe(1);
  });

  it('velocity: daily fiat cap trips after accumulation (§3.3 enforced end-to-end)', async () => {
    // Seed an isolated Tier-1 user.
    const capUser = await prisma.user.create({
      data: { kycStatus: 'verified', kycTier: 'tier_1', status: 'active' },
    });
    await pinService.setPin(capUser.id, '123456');

    // Tier-1 dailyFiatMax=200_000, perTxFiatMax=50_000.
    // Run 4 buys × 50_000 = 200_000 (at the limit — all pass).
    for (let i = 0; i < 4; i++) {
      const q = await proposalService.createBuyProposal({
        userId: capUser.id,
        intent: {
          action: 'buy_crypto',
          asset: 'USDT',
          fiatAmount: '50000',
          fiatCurrency: 'NGN',
        },
      });
      const d = await directiveService.issue({
        proposalId: q.proposalId,
        userId: capUser.id,
        ref: 'request_pin',
      });
      await executionService.executeBuy({
        userId: capUser.id,
        proposalId: q.proposalId,
        directiveId: d.directiveId,
        nonce: d.nonce,
        pin: '123456',
        idempotencyKey: randomUUID(),
      });
    }

    // Velocity counter should now be at 200_000.
    const amountCounter = await prisma.velocityCounter.findUnique({
      where: {
        userId_counterType: {
          userId: capUser.id,
          counterType: 'amount_24h',
        },
      },
    });
    expect(Number(amountCounter!.currentValue)).toBe(200_000);

    // The NEXT buy (10_000 NGN) would push total to 210_000 > 200_000 cap.
    // ProposalService.createBuyProposal also calls KycGateService internally,
    // so we call assertCanTransact directly to test the gate in isolation.
    const { VelocityExceededError } =
      await import('../src/modules/identity/domain/gate-errors');
    await expect(
      // Import the gate service reference to call assertCanTransact.
      // executionService exposes kycGate indirectly — easier to call directly.
      // We re-instantiate the KycGateService with real repos to test the gate.
      (async () => {
        const { IdentityPrismaRepository } =
          await import('../src/modules/identity/infrastructure/identity.prisma.repository');
        const { VelocityPrismaRepository } =
          await import('../src/modules/identity/infrastructure/velocity.prisma.repository');
        const { KycGateService } =
          await import('../src/modules/identity/application/kyc-gate.service');
        const ps =
          prisma as unknown as import('../src/core/prisma/prisma.service').PrismaService;
        const identityRepo = new IdentityPrismaRepository(ps);
        const velocityRepo = new VelocityPrismaRepository(ps);
        const config = new StubConfigService() as never;
        const gate = new KycGateService(
          identityRepo,
          velocityRepo,
          config,
          clock,
        );
        await gate.assertCanTransact({
          userId: capUser.id,
          fiatAmount: 10_000,
          asset: 'USDT',
        });
      })(),
    ).rejects.toBeInstanceOf(VelocityExceededError);
  });

  it('velocity: daily tx count cap trips after 10 transactions (§3.3 enforced end-to-end)', async () => {
    // Seed an isolated Tier-1 user with a very high dailyFiatMax effective limit.
    // We'll use tiny amounts (1 NGN) so fiat cap is never hit.
    // But dailyTxCountMax=10 will trip on the 11th call.
    const countUser = await prisma.user.create({
      data: { kycStatus: 'verified', kycTier: 'tier_1', status: 'active' },
    });
    await pinService.setPin(countUser.id, '123456');

    // Seed VelocityCounter directly at count=9 (faster than running 9 real buys).
    const now = new Date();
    await prisma.velocityCounter.create({
      data: {
        userId: countUser.id,
        counterType: 'count_24h',
        currentValue: 9,
        windowStart: now,
        windowEnd: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
      },
    });
    // Also seed amount counter (small amount so fiat cap doesn't interfere).
    await prisma.velocityCounter.create({
      data: {
        userId: countUser.id,
        counterType: 'amount_24h',
        currentValue: 9_000,
        windowStart: now,
        windowEnd: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
      },
    });

    // The 10th buy (count_24h goes from 9 → 10) should succeed.
    const q10 = await proposalService.createBuyProposal({
      userId: countUser.id,
      intent: {
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount: '1000',
        fiatCurrency: 'NGN',
      },
    });
    const d10 = await directiveService.issue({
      proposalId: q10.proposalId,
      userId: countUser.id,
      ref: 'request_pin',
    });
    // Should NOT throw — count goes to 10 which equals the cap (not over).
    await expect(
      executionService.executeBuy({
        userId: countUser.id,
        proposalId: q10.proposalId,
        directiveId: d10.directiveId,
        nonce: d10.nonce,
        pin: '123456',
        idempotencyKey: randomUUID(),
      }),
    ).resolves.toMatchObject({ status: 'settling' });

    // The 11th buy (count_24h = 10 + 1 = 11 > 10 cap) must throw VelocityExceededError.
    // ProposalService.createBuyProposal calls KycGateService first → throws there.
    const { VelocityExceededError } =
      await import('../src/modules/identity/domain/gate-errors');
    await expect(
      proposalService.createBuyProposal({
        userId: countUser.id,
        intent: {
          action: 'buy_crypto',
          asset: 'USDT',
          fiatAmount: '1000',
          fiatCurrency: 'NGN',
        },
      }),
    ).rejects.toBeInstanceOf(VelocityExceededError);
  });

  it('velocity: expired window resets counters on next executeBuy (V1 window-reset logic)', async () => {
    const resetUser = await prisma.user.create({
      data: { kycStatus: 'verified', kycTier: 'tier_1', status: 'active' },
    });
    await pinService.setPin(resetUser.id, '123456');

    // Seed stale (expired) velocity counter rows — windowEnd 48h in the past.
    const pastNow = new Date();
    const staleEnd = new Date(pastNow.getTime() - 48 * 60 * 60 * 1_000);
    const staleStart = new Date(staleEnd.getTime() - 24 * 60 * 60 * 1_000);
    await prisma.velocityCounter.create({
      data: {
        userId: resetUser.id,
        counterType: 'amount_24h',
        currentValue: 199_000, // near the cap — but stale
        windowStart: staleStart,
        windowEnd: staleEnd,
      },
    });
    await prisma.velocityCounter.create({
      data: {
        userId: resetUser.id,
        counterType: 'count_24h',
        currentValue: 9, // near the cap — but stale
        windowStart: staleStart,
        windowEnd: staleEnd,
      },
    });

    // Execute a buy — should succeed because the stale counters should be reset.
    const q = await proposalService.createBuyProposal({
      userId: resetUser.id,
      intent: {
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount: '10000',
        fiatCurrency: 'NGN',
      },
    });
    const d = await directiveService.issue({
      proposalId: q.proposalId,
      userId: resetUser.id,
      ref: 'request_pin',
    });

    await expect(
      executionService.executeBuy({
        userId: resetUser.id,
        proposalId: q.proposalId,
        directiveId: d.directiveId,
        nonce: d.nonce,
        pin: '123456',
        idempotencyKey: randomUUID(),
      }),
    ).resolves.toMatchObject({ status: 'settling' });

    // After the buy, the counter should be reset to just the new amount (not 199_000+10_000).
    const amountCounter = await prisma.velocityCounter.findUnique({
      where: {
        userId_counterType: { userId: resetUser.id, counterType: 'amount_24h' },
      },
    });
    expect(Number(amountCounter!.currentValue)).toBe(10_000); // reset, not 209_000
  });

  it('idempotent replay: second call returns same transactionId, no new Transaction/Outbox rows', async () => {
    const { proposalId } = await seedProposalAndQuote();
    const { directiveId, nonce } = await issueDirective(proposalId);
    const idempotencyKey = randomUUID();

    // First call.
    const first = await executionService.executeBuy({
      userId,
      proposalId,
      directiveId,
      nonce,
      pin: '123456',
      idempotencyKey,
    });
    expect(first.transactionId).toBeTruthy();

    // Count rows before replay.
    const txnCountBefore = await prisma.transaction.count({
      where: { idempotencyKey },
    });
    const outboxCountBefore = await prisma.settlementOutbox.count({
      where: { transactionId: first.transactionId },
    });
    expect(txnCountBefore).toBe(1);
    expect(outboxCountBefore).toBe(1);

    // Second call — issue a fresh directive for a new proposal, but use the SAME
    // idempotencyKey. The engine should detect the existing Transaction and return
    // the cached result without creating new rows.
    const { proposalId: proposalId2 } = await seedProposalAndQuote();
    const { directiveId: directiveId2, nonce: nonce2 } =
      await issueDirective(proposalId2);

    const second = await executionService.executeBuy({
      userId,
      proposalId: proposalId2,
      directiveId: directiveId2,
      nonce: nonce2,
      pin: '123456',
      idempotencyKey, // same key!
    });

    // Must return the SAME transactionId.
    expect(second.transactionId).toBe(first.transactionId);
    expect(second.status).toBe(first.status);

    // VA details must be populated on replay (C2) — not empty strings.
    expect(second.payment.accountNumber).toBe(FAKE_ACCOUNT_NUMBER);
    expect(second.payment.bankName).toBe(FAKE_BANK_NAME);
    expect(second.payment.providerRef).toBe(FAKE_FLW_REF);

    // No duplicate Transaction row created.
    const txnCountAfter = await prisma.transaction.count({
      where: { idempotencyKey },
    });
    expect(txnCountAfter).toBe(txnCountBefore); // still 1

    // No duplicate SettlementOutbox row created.
    const outboxCountAfter = await prisma.settlementOutbox.count({
      where: { transactionId: first.transactionId },
    });
    expect(outboxCountAfter).toBe(outboxCountBefore); // still 1
  });
});
