/**
 * Integration tests for ProposalService.createSendProposal (task N3a, CLAUDE.md §3.1).
 *
 * Tests:
 *   - createSendProposal persists a Proposal(type=send, pending) for a funded user
 *     with a verified crypto beneficiary (past cooling-off, clean sanctions).
 *   - createSendProposal throws InsufficientBalanceError when balance < totalDebit.
 *   - createSendProposal throws BeneficiaryCoolingOffError when cooling-off is active.
 *   - createSendProposal throws SanctionsBlockedError when address is on denylist.
 *
 * All services are wired manually (no Nest DI), following the same pattern as
 * sell-proposal.e2e-spec.ts and compliance-event.e2e-spec.ts.
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
import { ComplianceEventPrismaRepository } from '../src/modules/compliance/infrastructure/compliance-event.prisma.repository';

// Services
import { ProposalService } from '../src/modules/transactions/application/proposal.service';
import { KycGateService } from '../src/modules/identity/application/kyc-gate.service';
import { QuotesService } from '../src/modules/quotes/application/quotes.service';
import { WalletService } from '../src/modules/wallets/application/wallet.service';
import { BeneficiaryService } from '../src/modules/beneficiaries/application/beneficiary.service';
import { ComplianceService } from '../src/modules/compliance/application/compliance.service';
import { MockSanctionsScreener } from '../src/modules/compliance/infrastructure/mock-sanctions.screener';
import { ConfigRateProvider } from '../src/modules/quotes/infrastructure/config-rate.provider';
import { AssetRegistry } from '../src/core/catalog/asset-registry';

// Domain errors
import { InsufficientBalanceError } from '../src/modules/transactions/domain/execution-errors';
import { BeneficiaryCoolingOffError } from '../src/modules/beneficiaries/domain/beneficiary-errors';
import { SanctionsBlockedError } from '../src/modules/compliance/domain/compliance-errors';

// Ports
import type { PrismaService } from '../src/core/prisma/prisma.service';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { INameEnquiry } from '../src/modules/beneficiaries/application/ports/name-enquiry.port';

// Config
import configuration from '../src/core/config/configuration';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Fake ConfigService (same pattern as sell-proposal.e2e-spec.ts)
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

const FAKE_WALLET_ADDRESS = 'TSendProposalE2EFakeWalletAddr12';
const FAKE_BLOCKRADAR_REF = 'fake_blockradar_ref_send_proposal_e2e';

const fakeWalletProvider: IWalletProvider = {
  provisionAddress: jest.fn().mockResolvedValue({
    address: FAKE_WALLET_ADDRESS,
    providerReference: FAKE_BLOCKRADAR_REF,
    network: 'TRON',
  }),
  getBalance: jest.fn().mockResolvedValue({ amount: '0', decimals: 6 }),
  withdraw: jest.fn().mockResolvedValue({
    providerReference: 'e2e-send-tx-ref-stub',
    status: 'pending' as const,
  }),
  getWithdrawalStatus: jest
    .fn()
    .mockResolvedValue({ status: 'pending' as const }),
  listWalletAssets: jest.fn().mockResolvedValue([
    {
      assetId: 'e2e-usdt-tron-asset-id',
      symbol: 'USDT',
      name: 'Tether USD',
      network: 'TRON',
      contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      decimals: 6,
      isMainnet: false,
    },
  ]),
};

// Deterministic mock name-enquiry (Fix E: BeneficiaryService requires the port).
const fakeNameEnquiry: INameEnquiry = {
  resolve: jest.fn().mockResolvedValue({
    accountName: 'TEST USER (RESOLVED)',
    provider: 'mock',
    reference: 'mock-name-enquiry-send-proposal-e2e',
  }),
};

// All TRON addresses must be exactly 34 chars (T + 33 base58 chars).
// base58 charset excludes 0, O, I, l.

// A valid TRON-format address (starts with T, 34 chars total).
// This address is NOT on the sanctions denylist.
const VALID_TRON_CRYPTO_ADDRESS = 'TSendE2EBeneficiaryTronAddress1234';

// A separate valid address for the cooling-off test (different from above
// to avoid the unique constraint on (userId, cryptoAddress)).
// Must be 34 chars, all valid base58 (no 0, O, I, l).
const COOLING_TRON_ADDRESS = 'TCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

// A blocked address for the sanctions test (exactly 34 chars, valid base58).
const BLOCKED_TRON_ADDRESS = 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ProposalService.createSendProposal (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  let proposalService: ProposalService;
  let beneficiaryService: BeneficiaryService;
  let walletService: WalletService;

  let userId: string;
  let walletId: string;
  let cryptoBeneficiaryId: string;
  let blockedBeneficiaryId: string;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    const ps = prisma as unknown as PrismaService;
    const config = new StubConfigService() as never;
    const clock = { now: () => new Date() };

    // Wire repos
    const quoteRepo = new QuotePrismaRepository(ps);
    const proposalRepo = new ProposalPrismaRepository(ps);
    const ledgerRepo = new LedgerPrismaRepository(ps);
    const identityRepo = new IdentityPrismaRepository(ps);
    const velocityRepo = new VelocityPrismaRepository(ps);
    const walletRepo = new WalletPrismaRepository(ps);
    const beneficiaryRepo = new BeneficiaryPrismaRepository(ps);
    const complianceEventRepo = new ComplianceEventPrismaRepository(ps);

    // MockSanctionsScreener: BLOCKED_TRON_ADDRESS is on the denylist.
    // Use a targeted stub for ConfigService so the screener resolves correctly
    // without Nest DI (direct instantiation pattern for integration tests).
    const sanctionsConfigStub = {
      get: (key: string) => {
        if (key === 'compliance') {
          return {
            travelRuleThresholdNgn: 1_000_000,
            sanctionsDenylist: [BLOCKED_TRON_ADDRESS],
          };
        }
        // Delegate everything else to the real config
        return new StubConfigService().get(key);
      },
    } as unknown as import('../src/core/config/application/effective-config.service').EffectiveConfigService;
    const sanctionsScreener = new MockSanctionsScreener(sanctionsConfigStub);

    // Wire services
    const rateProvider = new ConfigRateProvider(config);
    const assetRegistry = new AssetRegistry(config);
    const quotesService = new QuotesService(rateProvider, clock, assetRegistry);
    const kycGateService = new KycGateService(
      identityRepo,
      velocityRepo,
      config,
      clock,
    );
    walletService = new WalletService(
      fakeWalletProvider,
      walletRepo,
      clock,
      assetRegistry,
    );
    beneficiaryService = new BeneficiaryService(
      beneficiaryRepo,
      fakeNameEnquiry,
      assetRegistry,
      config,
      // Wave G: bank-list port (unused in these flows) — empty stub adapter.
      { listBanks: () => Promise.resolve([]) },
    );
    const complianceService = new ComplianceService(
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
      undefined as never, // swapProvider: not needed on send proposal path
    );

    // Seed a KYC-verified user. Task 1.3: crypto.send is gated to tier_2.
    const user = await prisma.user.create({
      data: { kycStatus: 'verified', kycTier: 'tier_2', status: 'active' },
    });
    userId = user.id;

    // Provision the wallet (needed for FK constraints on LedgerEntry)
    const wallet = await walletService.getOrProvisionNetworkWallet(
      userId,
      'TRON',
    );
    walletId = wallet.id;

    // Seed the user's wallet with a USDT balance via ledger entries.
    // We need a Transaction FK for LedgerEntry; create a minimal buy transaction.
    const seedQuote = await prisma.quote.create({
      data: {
        userId,
        type: 'buy',
        asset: 'USDT',
        fiatCurrency: 'NGN',
        fiatAmount: '20000',
        cryptoAmount: '20.0',
        fxRate: '1600',
        baseRate: '1600',
        spreadBps: 150,
        processingFeeBps: 100,
        processingFeeAmount: '200',
        quotedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        status: 'valid',
      },
    });

    const seedProposal = await prisma.proposal.create({
      data: {
        userId,
        type: 'buy',
        status: 'executed',
        parameters: {},
        parametersChecksum: 'a'.repeat(64),
        quoteId: seedQuote.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const seedTxn = await prisma.transaction.create({
      data: {
        userId,
        proposalId: seedProposal.id,
        type: 'buy',
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: 'b'.repeat(64),
        metadata: {},
      },
    });

    await prisma.ledgerEntry.create({
      data: {
        transactionId: seedTxn.id,
        accountType: 'user_wallet',
        accountId: walletId,
        currency: 'USDT',
        amount: '20.0',
        direction: 'credit',
        description: 'E2E seed deposit',
        balanceAfter: '20.0',
        sequence: 1,
        postedAt: new Date(),
      },
    });

    // Seed a verified crypto-address beneficiary PAST cooling-off.
    // Bypass beneficiaryService.addCryptoAddress (which sets a future cooling-off)
    // by inserting directly via the repository with a past firstUseLockedUntil.
    const ben = await prisma.beneficiary.create({
      data: {
        userId,
        type: 'crypto_address',
        label: 'My Send Wallet',
        cryptoAddress: VALID_TRON_CRYPTO_ADDRESS,
        cryptoAsset: 'USDT',
        cryptoNetwork: 'TRON',
        verificationStatus: 'verified',
        firstUseLockedUntil: new Date(Date.now() - 86400_000), // 24h ago = cooling done
        isDefault: false,
      },
    });
    cryptoBeneficiaryId = ben.id;

    // Seed a blocked-address beneficiary (for sanctions test).
    const blockedBen = await prisma.beneficiary.create({
      data: {
        userId,
        type: 'crypto_address',
        label: 'Blocked Wallet',
        cryptoAddress: BLOCKED_TRON_ADDRESS,
        cryptoAsset: 'USDT',
        cryptoNetwork: 'TRON',
        verificationStatus: 'verified',
        firstUseLockedUntil: new Date(Date.now() - 86400_000), // cooling-off done
        isDefault: false,
      },
    });
    blockedBeneficiaryId = blockedBen.id;
  });

  afterAll(async () => {
    await stop?.();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('persists Proposal(type=send, pending) for a funded user with a verified crypto beneficiary', async () => {
    // Sending 10 USDT; wallet has 20 USDT. Network fee = 1 USDT. totalDebit = 11.
    const result = await proposalService.createSendProposal({
      userId,
      intent: {
        action: 'send_crypto',
        asset: 'USDT',
        cryptoAmount: '10.0',
        network: 'TRON',
      },
      beneficiaryId: cryptoBeneficiaryId,
    });

    expect(result.proposalId).toBeTruthy();
    expect(result.quoteId).toBeNull();
    expect(result.confirmation.asset).toBe('USDT');
    expect(result.confirmation.cryptoAmount).toBe('10.0');
    expect(result.confirmation.network).toBe('TRON');
    expect(result.confirmation.networkFeeCrypto).toBe('1'); // config default
    expect(result.confirmation.totalDebit).toBe('11');
    expect(result.confirmation.toAddressMasked).toContain('...');
    expect(result.confirmation.beneficiaryLabel).toBe('My Send Wallet');

    // Verify persisted row
    const proposalRow = await prisma.proposal.findUnique({
      where: { id: result.proposalId },
    });
    expect(proposalRow).not.toBeNull();
    expect(proposalRow!.type).toBe('send');
    expect(proposalRow!.status).toBe('pending');
    expect(proposalRow!.quoteId).toBeNull();

    // No extra Quote row should be created (send does not use FX quoting).
    // Count all Quote rows for the user — only the seed buy-quote should exist.
    const quoteRows = await prisma.quote.findMany({ where: { userId } });
    // The seed phase created exactly one buy-quote; no additional send-quote.
    expect(quoteRows).toHaveLength(1);
  });

  // ── Insufficient balance ──────────────────────────────────────────────────

  it('throws InsufficientBalanceError when balance < totalDebit (incl. network fee)', async () => {
    // Trying to send 15 USDT: totalDebit = 16 (15 + 1 fee), balance = 20 - already used 11 = 9 left.
    // Actually balance hasn't been reduced (no execution), so it's still 20.
    // Let's try 20 USDT: totalDebit = 21 > balance of 20.
    await expect(
      proposalService.createSendProposal({
        userId,
        intent: {
          action: 'send_crypto',
          asset: 'USDT',
          cryptoAmount: '20.0', // totalDebit = 21, balance = 20
          network: 'TRON',
        },
        beneficiaryId: cryptoBeneficiaryId,
      }),
    ).rejects.toThrow(InsufficientBalanceError);

    // No extra send Proposal should have been created
    const proposals = await prisma.proposal.findMany({
      where: { userId, type: 'send' },
    });
    // Still just 1 send proposal from the happy-path test
    expect(proposals).toHaveLength(1);
  });

  // ── Cooling-off active ────────────────────────────────────────────────────

  it('throws BeneficiaryCoolingOffError when beneficiary cooling-off has not yet passed', async () => {
    // Create a new beneficiary with a FUTURE cooling-off window.
    const coolingBen = await prisma.beneficiary.create({
      data: {
        userId,
        type: 'crypto_address',
        label: 'Cooling Wallet',
        // Use a different address than the happy-path beneficiary to avoid
        // the unique constraint on (userId, cryptoAddress).
        cryptoAddress: COOLING_TRON_ADDRESS,
        cryptoAsset: 'USDT',
        cryptoNetwork: 'TRON',
        verificationStatus: 'verified',
        firstUseLockedUntil: new Date(Date.now() + 86400_000), // 24h in future = cooling active
        isDefault: false,
      },
    });

    await expect(
      proposalService.createSendProposal({
        userId,
        intent: {
          action: 'send_crypto',
          asset: 'USDT',
          cryptoAmount: '5.0',
          network: 'TRON',
        },
        beneficiaryId: coolingBen.id,
      }),
    ).rejects.toThrow(BeneficiaryCoolingOffError);
  });

  // ── Sanctions block ───────────────────────────────────────────────────────

  it('throws SanctionsBlockedError when the destination address is on the sanctions denylist', async () => {
    await expect(
      proposalService.createSendProposal({
        userId,
        intent: {
          action: 'send_crypto',
          asset: 'USDT',
          cryptoAmount: '5.0',
          network: 'TRON',
        },
        beneficiaryId: blockedBeneficiaryId,
      }),
    ).rejects.toThrow(SanctionsBlockedError);

    // A ComplianceEvent should have been persisted even for the blocked address.
    const events = await prisma.complianceEvent.findMany({
      where: { userId, status: 'flagged' },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
