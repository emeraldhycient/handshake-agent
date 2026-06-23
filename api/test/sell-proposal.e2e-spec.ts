/**
 * Integration tests for LedgerPrismaRepository.getAccountBalance and
 * ProposalService.createSellProposal (task S4a, CLAUDE.md §3.1).
 *
 * Tests:
 *   - getAccountBalance returns latest balanceAfter for a seeded ledger entry.
 *   - getAccountBalance returns '0' when no entries exist.
 *   - createSellProposal persists a Quote(type=sell) + Proposal(type=sell,pending)
 *     for a funded user (user_wallet ledger balance ≥ cryptoAmount).
 *   - createSellProposal throws InsufficientBalanceError when balance < cryptoAmount.
 *
 * All services are wired manually (no Nest DI), following the same pattern as
 * proposal-repository.e2e-spec.ts and settlement-buy.e2e-spec.ts.
 *
 * Requires Docker. Runs only in the `test:e2e` lane (jest-e2e.json).
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '../generated/prisma/client';
import { startTestPostgres } from './helpers/pg-testcontainer';

// Repos
import { ProposalPrismaRepository } from '../src/modules/transactions/infrastructure/proposal.prisma.repository';
import { QuotePrismaRepository } from '../src/modules/transactions/infrastructure/quote.prisma.repository';
import { LedgerPrismaRepository } from '../src/modules/transactions/infrastructure/ledger.prisma.repository';
import { IdentityPrismaRepository } from '../src/modules/identity/infrastructure/identity.prisma.repository';
import { VelocityPrismaRepository } from '../src/modules/identity/infrastructure/velocity.prisma.repository';
import { WalletPrismaRepository } from '../src/modules/wallets/infrastructure/wallet.prisma.repository';
import { BeneficiaryPrismaRepository } from '../src/modules/beneficiaries/infrastructure/beneficiary.prisma.repository';

// Services
import { ProposalService } from '../src/modules/transactions/application/proposal.service';
import { KycGateService } from '../src/modules/identity/application/kyc-gate.service';
import { QuotesService } from '../src/modules/quotes/application/quotes.service';
import { WalletService } from '../src/modules/wallets/application/wallet.service';
import { BeneficiaryService } from '../src/modules/beneficiaries/application/beneficiary.service';
import { ConfigRateProvider } from '../src/modules/quotes/infrastructure/config-rate.provider';
import { AssetRegistry } from '../src/core/catalog/asset-registry';

// Domain errors
import { InsufficientBalanceError } from '../src/modules/transactions/domain/execution-errors';

// Ports
import type { PrismaService } from '../src/core/prisma/prisma.service';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';

// Config
import configuration from '../src/core/config/configuration';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Fake ConfigService (same pattern as settlement-buy.e2e-spec.ts)
// ---------------------------------------------------------------------------

const appConfig = configuration();

class StubConfigService {
  get<T = unknown>(key: string): T {
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
// Fake wallet provider (no Blockradar calls)
// ---------------------------------------------------------------------------

const FAKE_WALLET_ADDRESS = 'TSellProposalE2EFakeWalletAddr12';
const FAKE_BLOCKRADAR_REF = 'fake_blockradar_ref_sell_proposal_e2e';

const fakeWalletProvider: IWalletProvider = {
  provisionAddress: jest.fn().mockResolvedValue({
    address: FAKE_WALLET_ADDRESS,
    providerReference: FAKE_BLOCKRADAR_REF,
    network: 'TRON',
  }),
  getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
  withdraw: jest.fn().mockResolvedValue({
    providerReference: 'e2e-tx-ref-stub',
    status: 'pending' as const,
  }),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('LedgerPrismaRepository.getAccountBalance + ProposalService.createSellProposal (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  let ledgerRepo: LedgerPrismaRepository;
  let proposalService: ProposalService;

  let userId: string;
  let walletId: string;
  let beneficiaryId: string;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    const ps = prisma as unknown as PrismaService;
    const config = new StubConfigService() as never;
    const clock = { now: () => new Date() };

    // Wire repos
    const quoteRepo = new QuotePrismaRepository(ps);
    const proposalRepo = new ProposalPrismaRepository(ps);
    ledgerRepo = new LedgerPrismaRepository(ps);
    const identityRepo = new IdentityPrismaRepository(ps);
    const velocityRepo = new VelocityPrismaRepository(ps);
    const walletRepo = new WalletPrismaRepository(ps);
    const beneficiaryRepo = new BeneficiaryPrismaRepository(ps);

    // Wire services
    const rateProvider = new ConfigRateProvider(config);
    const quotesService = new QuotesService(rateProvider, clock);
    const kycGateService = new KycGateService(
      identityRepo,
      velocityRepo,
      config,
      clock,
    );
    const assetRegistry = new AssetRegistry(config);
    const walletService = new WalletService(
      fakeWalletProvider,
      walletRepo,
      clock,
      assetRegistry,
    );
    const beneficiaryService = new BeneficiaryService(
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
      // complianceService and configService are required deps but not invoked on the sell path.
      {
        screenSendDestination: () =>
          Promise.resolve({ passed: true, complianceEventId: '' }),
      } as never,
      new StubConfigService() as never,
    );

    // Seed a KYC-verified user
    const user = await prisma.user.create({
      data: { kycStatus: 'verified', kycTier: 'tier_1', status: 'active' },
    });
    userId = user.id;

    // Provision the wallet (needed for FK constraints on LedgerEntry)
    const wallet = await walletService.getOrProvisionWallet(
      userId,
      'USDT',
      'TRON',
    );
    walletId = wallet.id;

    // Seed a bank-account beneficiary
    const ben = await beneficiaryService.addBankAccount({
      userId,
      accountNumber: '0012345678',
      bankCode: '058',
      accountName: 'Test Seller',
      label: 'My GTBank',
    });
    beneficiaryId = ben.id;
  });

  afterAll(async () => {
    await stop?.();
  });

  // ── LedgerPrismaRepository.getAccountBalance ─────────────────────────────

  describe('LedgerPrismaRepository.getAccountBalance', () => {
    it('returns "0" when no ledger entries exist for the account', async () => {
      const balance = await ledgerRepo.getAccountBalance(
        'user_wallet',
        'no-such-wallet-id-xyz',
        'USDT',
      );
      expect(balance).toBe('0');
    });

    it('returns the latest balanceAfter from seeded ledger entries', async () => {
      // Seed a Transaction row (needed as FK for LedgerEntry)
      const quote = await prisma.quote.create({
        data: {
          userId,
          type: 'buy',
          asset: 'USDT',
          fiatCurrency: 'NGN',
          fiatAmount: '5000',
          cryptoAmount: '3.0',
          fxRate: '1600',
          baseRate: '1600',
          spreadBps: 100,
          processingFeeBps: 50,
          processingFeeAmount: '25',
          quotedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          status: 'valid',
        },
      });

      const proposal = await prisma.proposal.create({
        data: {
          userId,
          type: 'buy',
          status: 'pending',
          parameters: {},
          parametersChecksum: 'a'.repeat(64),
          quoteId: quote.id,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      const txn = await prisma.transaction.create({
        data: {
          userId,
          proposalId: proposal.id,
          type: 'buy',
          status: 'settling',
          idempotencyKey: randomUUID(),
          requestChecksum: 'b'.repeat(64),
          metadata: {},
        },
      });

      // Seed two LedgerEntry rows for the same account — the second has a higher
      // sequence and therefore the higher balanceAfter that should be returned.
      await prisma.ledgerEntry.create({
        data: {
          transactionId: txn.id,
          accountType: 'user_wallet',
          accountId: walletId,
          currency: 'USDT',
          amount: '10.5',
          direction: 'credit',
          description: 'first deposit',
          balanceAfter: '10.5',
          sequence: 1,
          postedAt: new Date(),
        },
      });

      await prisma.ledgerEntry.create({
        data: {
          transactionId: txn.id,
          accountType: 'user_wallet',
          accountId: walletId,
          currency: 'USDT',
          amount: '5.0',
          direction: 'credit',
          description: 'second deposit',
          balanceAfter: '15.5',
          sequence: 2,
          postedAt: new Date(),
        },
      });

      const balance = await ledgerRepo.getAccountBalance(
        'user_wallet',
        walletId,
        'USDT',
      );
      // Should return the latest (sequence=2) balanceAfter = '15.5'
      expect(balance).toBe('15.5');
    });
  });

  // ── ProposalService.createSellProposal ───────────────────────────────────

  describe('ProposalService.createSellProposal', () => {
    it('persists Quote(type=sell) + Proposal(type=sell, pending) for a funded user', async () => {
      // The user's wallet already has a ledger balance of 15.5 USDT from the
      // seeded entries in the previous test. Selling 5.0 USDT is within balance.
      const result = await proposalService.createSellProposal({
        userId,
        // conversationId is optional and FK-constrained; omit to use null (no conversation)
        intent: {
          action: 'sell_crypto',
          asset: 'USDT',
          cryptoAmount: '5.0',
          fiatCurrency: 'NGN',
        },
        beneficiaryId,
      });

      expect(result.proposalId).toBeTruthy();
      expect(result.quoteId).toBeTruthy();
      expect(result.confirmation.asset).toBe('USDT');
      expect(result.confirmation.cryptoAmount).toBe('5.0');
      expect(result.confirmation.fiatCurrency).toBe('NGN');
      expect(result.confirmation.beneficiaryLabel).toBe('My GTBank');

      // Verify persisted rows
      const proposalRow = await prisma.proposal.findUnique({
        where: { id: result.proposalId },
      });
      expect(proposalRow).not.toBeNull();
      expect(proposalRow!.type).toBe('sell');
      expect(proposalRow!.status).toBe('pending');
      expect(proposalRow!.quoteId).toBe(result.quoteId);

      const quoteRow = await prisma.quote.findUnique({
        where: { id: result.quoteId },
      });
      expect(quoteRow).not.toBeNull();
      expect(quoteRow!.type).toBe('sell');
      expect(quoteRow!.asset).toBe('USDT');
      expect(quoteRow!.cryptoAmount).toBe('5.0');
    });

    it('throws InsufficientBalanceError when ledger balance < cryptoAmount', async () => {
      // Trying to sell 100.0 USDT when balance is only 15.5
      await expect(
        proposalService.createSellProposal({
          userId,
          intent: {
            action: 'sell_crypto',
            asset: 'USDT',
            cryptoAmount: '100.0',
            fiatCurrency: 'NGN',
          },
          beneficiaryId,
        }),
      ).rejects.toThrow(InsufficientBalanceError);

      // No extra Proposal should have been created
      const proposals = await prisma.proposal.findMany({
        where: { userId, type: 'sell' },
      });
      // There should be exactly 1 sell proposal (from the previous happy-path test)
      expect(proposals).toHaveLength(1);
    });
  });
});
