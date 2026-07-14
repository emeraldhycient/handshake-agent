/**
 * Integration test for the internal (user→user, PayID) transfer money path
 * (Spec 2, Task 7). CLAUDE.md §3.1 — model proposes, the deterministic engine
 * disposes.
 *
 * The executor (ExecutionService.executeInternalTransfer) is unit-tested
 * (execution.service.spec.ts), but the settlement repository
 * (SettlementPrismaRepository.settleInternalTransferAtomic) has NO unit spec —
 * its real DB-level behavior (advisory locks, the in-atomic sender-balance
 * guard, the double-post idempotency guard, the balanced double-entry, the two
 * WalletBalance snapshots and the signed Receipt) is only exercisable against a
 * REAL Postgres. This suite closes that gap.
 *
 * Verifies against a REAL Postgres (Testcontainers):
 *   1. Happy path (propose → authorize(request_step_up) → execute):
 *      - Exactly TWO LedgerEntry rows: a debit on the sender's user_wallet and a
 *        credit on the recipient's user_wallet, SAME asset, per-currency sum = 0.
 *      - Sender balance decreases by the amount; recipient increases by it.
 *      - Transaction: type=internal_transfer, status=completed, owned by the sender.
 *      - Proposal → executed.
 *      - Exactly ONE signed Receipt minted.
 *      - Both WalletBalance snapshots written (sender + recipient).
 *   2. In-atomic sender-balance guard: a transfer exceeding the sender's ledger
 *      balance throws InsufficientBalanceError and posts NOTHING.
 *   3. Concurrent double-execute (same proposalId / idempotencyKey) is a no-op on
 *      the second call — one pair of ledger legs, one Receipt, balances moved once.
 *
 * Wiring is manual (no Nest DI), mirroring send-vertical.e2e-spec.ts — the closest
 * sibling money path (both use request_step_up + ComplianceService + SessionService).
 * The only fakes are the wallet/payment providers, neither of which the
 * internal-transfer path touches (the crypto never leaves custody).
 *
 * Requires Docker. Runs only in the `test:e2e` lane (jest-e2e.json):
 *   pnpm --filter @handshake-agent/api test:e2e -- internal-transfer
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '../generated/prisma/client';
import { startTestPostgres } from './helpers/pg-testcontainer';
import { seedRegistryAssets } from './helpers/seed-registry-assets';

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
import { ComplianceEventPrismaRepository } from '../src/modules/compliance/infrastructure/compliance-event.prisma.repository';

// Services
import { PinService } from '../src/core/auth/pin.service';
import { SessionService } from '../src/core/auth/session.service';
import { DirectiveService } from '../src/modules/transactions/application/directive.service';
import { ProposalService } from '../src/modules/transactions/application/proposal.service';
import { ExecutionService } from '../src/modules/transactions/application/execution.service';
import { KycGateService } from '../src/modules/identity/application/kyc-gate.service';
import { QuotesService } from '../src/modules/quotes/application/quotes.service';
import { WalletService } from '../src/modules/wallets/application/wallet.service';
import { ComplianceService } from '../src/modules/compliance/application/compliance.service';
import { MockSanctionsScreener } from '../src/modules/compliance/infrastructure/mock-sanctions.screener';
import { ConfigRateProvider } from '../src/modules/quotes/infrastructure/config-rate.provider';
import { AssetRegistry } from '../src/core/catalog/asset-registry';

// Domain errors
import { InsufficientBalanceError } from '../src/modules/transactions/domain/execution-errors';

// Ports/types
import type { PrismaService } from '../src/core/prisma/prisma.service';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';
import type { SettleInternalTransferAtomicInput } from '../src/modules/transactions/application/ports/settlement.repository.port';
import type { EffectiveConfigService } from '../src/core/config/application/effective-config.service';

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
      return 'internal-transfer-e2e-signing-key-32bytes!' as T;
    }
    if (key === 'RECEIPT_SIGNING_KEY') {
      return 'internal-transfer-e2e-receipt-signing-32b!' as T;
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
// Fake external providers — the internal-transfer path never calls either
// (crypto never leaves custody), but the ExecutionService constructor requires
// both. Each wallet provision returns a UNIQUE address (Wallet.address is
// globally unique) so sender + recipient wallets cannot collide.
// ---------------------------------------------------------------------------

let walletProvisionCounter = 0;
const fakeWalletProvider: IWalletProvider = {
  provisionAddress: jest.fn().mockImplementation(() => {
    walletProvisionCounter += 1;
    return Promise.resolve({
      address: `TFakeInternalTransferAddr${walletProvisionCounter}`,
      providerReference: `fake_blockradar_ref_it_${walletProvisionCounter}`,
    });
  }),
  getBalance: jest.fn().mockResolvedValue({
    available: '0',
    pending: '0',
    asset: 'USDT',
    network: 'TRON',
  }),
  withdraw: jest.fn().mockResolvedValue({
    providerReference: 'unused',
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

const fakePaymentProvider: IPaymentProvider = {
  createCollection: jest.fn(),
  verify: jest.fn(),
  createPayout: jest.fn(),
  verifyPayout: jest.fn(),
  verifyWebhookSignature: jest.fn().mockReturnValue(true),
};

// ---------------------------------------------------------------------------
// Decimal-safe sum/compare helper (10^18-scaled) for ledger-balance assertions.
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

describe('Internal transfer money path (settleInternalTransferAtomic, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let ps: PrismaService;
  let stop: (() => Promise<void>) | undefined;

  let proposalService: ProposalService;
  let executionService: ExecutionService;
  let directiveService: DirectiveService;
  let pinService: PinService;
  let walletService: WalletService;
  let ledgerRepo: LedgerPrismaRepository;
  let settlementRepo: SettlementPrismaRepository;
  let assetRegistry: AssetRegistry;

  const clock = { now: () => new Date() };

  // Fresh sender + recipient per test (beforeEach) — keeps velocity windows empty
  // and the tests independent (crypto.transfer is gated to tier_2, §3.3).
  let senderId: string;
  let recipientId: string;

  beforeAll(async () => {
    const result = await startTestPostgres();
    stop = result.stop;
    prisma = result.prisma;
    ps = prisma as unknown as PrismaService;

    const config = new StubConfigService() as never;
    assetRegistry = new AssetRegistry(config);
    seedRegistryAssets(assetRegistry);

    // Repos
    const proposalRepo = new ProposalPrismaRepository(ps);
    const quoteRepo = new QuotePrismaRepository(ps);
    const directiveRepo = new DirectivePrismaRepository(ps);
    ledgerRepo = new LedgerPrismaRepository(ps);
    const pinRepo = new PinPrismaRepository(ps);
    const sessionRepo = new SessionPrismaRepository(ps);
    const identityRepo = new IdentityPrismaRepository(ps);
    const velocityRepo = new VelocityPrismaRepository(ps);
    const walletRepo = new WalletPrismaRepository(ps);
    const complianceEventRepo = new ComplianceEventPrismaRepository(ps);
    settlementRepo = new SettlementPrismaRepository(ps, config);

    // MockSanctionsScreener with an empty denylist — every recipient passes.
    const sanctionsConfigStub = {
      get: (key: string) => {
        if (key === 'compliance') {
          return { travelRuleThresholdNgn: 1_000_000, sanctionsDenylist: [] };
        }
        return new StubConfigService().get(key);
      },
    } as unknown as EffectiveConfigService;
    const sanctionsScreener = new MockSanctionsScreener(sanctionsConfigStub);

    // Services
    const rateProvider = new ConfigRateProvider(config);
    const quotesService = new QuotesService(rateProvider, clock, assetRegistry);
    const kycGateService = new KycGateService(
      identityRepo,
      velocityRepo,
      config,
      clock,
    );
    pinService = new PinService(pinRepo, config, clock);
    const sessionService = new SessionService(sessionRepo, config, clock);
    walletService = new WalletService(
      fakeWalletProvider,
      walletRepo,
      clock,
      assetRegistry,
    );
    directiveService = new DirectiveService(
      directiveRepo,
      config,
      clock,
      config,
    );
    const complianceService = new ComplianceService(
      sanctionsScreener,
      complianceEventRepo,
    );

    // beneficiaryService is a required ProposalService/ExecutionService dep but is
    // NEVER called on the internal-transfer path (destination is a user, not a
    // saved beneficiary) — a minimal stub suffices (same pattern as settlement-buy).
    const beneficiaryStub = { getById: () => Promise.resolve(null) } as never;

    proposalService = new ProposalService(
      quotesService,
      kycGateService,
      quoteRepo,
      proposalRepo,
      clock,
      walletService,
      beneficiaryStub,
      assetRegistry,
      ledgerRepo,
      complianceService,
      config,
      undefined as never, // swapProvider: not needed on the transfer proposal path
    );

    executionService = new ExecutionService(
      proposalRepo,
      quoteRepo,
      new TransactionPrismaRepository(ps),
      new SettlementOutboxPrismaRepository(ps),
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
      beneficiaryStub,
      ledgerRepo,
      undefined, // identityService (optional)
      undefined, // whatsAppSender (optional)
      complianceService, // required for the counterparty sanctions re-screen (§3.3)
      sessionService, // required for device-bound step-up recording (§3.4)
      undefined, // swapProvider: not needed on the transfer path
    );
  });

  afterAll(async () => {
    await stop?.();
  });

  // A fresh tier_2 sender (PIN + bound-and-pinned device, §3.4) and a fresh
  // verified recipient per test.
  beforeEach(async () => {
    const sender = await prisma.user.create({
      data: { kycStatus: 'verified', kycTier: 'tier_2', status: 'active' },
    });
    senderId = sender.id;
    await pinService.setPin(senderId, '194837');

    const device = await prisma.device.create({
      data: {
        userId: senderId,
        fingerprint: `e2e-internal-transfer-device-${randomUUID()}`,
        trustState: 'bound',
        boundAt: new Date(),
      },
    });
    // Pin the device so the engine resolves it via User.pinnedDeviceId during
    // execute (executeInternalTransfer records the device-bound step-up, §3.4).
    await prisma.user.update({
      where: { id: senderId },
      data: { pinnedDeviceId: device.id },
    });

    const recipient = await prisma.user.create({
      data: { kycStatus: 'verified', kycTier: 'tier_1', status: 'active' },
    });
    recipientId = recipient.id;
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Provisions the user's TRON wallet and returns its WalletPrisma id. */
  async function provisionWallet(userId: string): Promise<string> {
    const wallet = await walletService.getOrProvisionNetworkWallet(
      userId,
      'TRON',
    );
    return wallet.id;
  }

  /**
   * Seeds a USDT ledger credit into a user_wallet account (cumulative — reads the
   * current max sequence/balance first so re-use in one process is safe).
   */
  async function seedLedgerCredit(
    walletId: string,
    userId: string,
    amount: string,
  ): Promise<void> {
    const latest = await prisma.ledgerEntry.findFirst({
      where: { accountType: 'user_wallet', accountId: walletId },
      orderBy: { sequence: 'desc' },
    });
    const seq = (latest?.sequence ?? 0) + 1;
    const before = latest?.balanceAfter ? Number(latest.balanceAfter) : 0;
    const after = before + Number(amount);

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
        accountId: walletId,
        currency: 'USDT',
        direction: 'credit',
        amount: Number(amount).toFixed(6),
        description: 'seed credit for internal-transfer e2e',
        balanceAfter: after.toFixed(6),
        sequence: seq,
        postedAt: new Date(),
      },
    });
  }

  /** Issues a request_step_up directive grant for the sender's proposal. */
  async function issueStepUp(
    proposalId: string,
  ): Promise<{ directiveId: string; nonce: string }> {
    const result = await directiveService.issue({
      userId: senderId,
      proposalId,
      ref: 'request_step_up',
    });
    return { directiveId: result.directiveId, nonce: result.nonce };
  }

  /** Creates a pending internal_transfer Proposal row directly (tests 2 + 3). */
  async function createTransferProposal(
    senderWalletId: string,
    recipientWalletId: string,
    cryptoAmount: string,
  ): Promise<string> {
    const proposal = await prisma.proposal.create({
      data: {
        userId: senderId,
        type: 'internal_transfer',
        status: 'pending',
        expiresAt: new Date(Date.now() + 5 * 60 * 1_000),
        parameters: {
          asset: 'USDT',
          cryptoAmount,
          network: 'TRON',
          networkFeeCrypto: '0',
          totalDebit: cryptoAmount,
          destinationKind: 'internal_user',
          recipientUserId: recipientId,
          recipientWalletId,
          walletId: senderWalletId,
          requiresTravelRule: false,
        },
        parametersChecksum: 'internal-transfer-e2e-checksum',
      },
    });
    return proposal.id;
  }

  /** Builds a valid SettleInternalTransferAtomicInput (tests 2 + 3). */
  function buildSettleInput(o: {
    proposalId: string;
    senderWalletId: string;
    recipientWalletId: string;
    cryptoAmount: string;
    idempotencyKey: string;
    now: Date;
  }): SettleInternalTransferAtomicInput {
    return {
      proposalId: o.proposalId,
      senderUserId: senderId,
      recipientUserId: recipientId,
      senderWalletId: o.senderWalletId,
      recipientWalletId: o.recipientWalletId,
      asset: 'USDT',
      cryptoAmount: o.cryptoAmount,
      assetDecimals: assetRegistry.asset('USDT').decimals,
      idempotencyKey: o.idempotencyKey,
      requestChecksum: 'internal-transfer-e2e-checksum',
      velocityIncrement: {
        userId: senderId,
        fiatCurrency: 'NGN',
        fiatAmountStr: '16000',
        now: o.now,
      },
      confirmedAt: o.now,
      pinVerifiedAt: o.now,
      now: o.now,
      year: o.now.getFullYear().toString(),
    };
  }

  // -------------------------------------------------------------------------
  // Test 1 — Happy path: propose → authorize → execute
  // -------------------------------------------------------------------------

  it('happy path: propose → authorize → execute posts a balanced 2-leg ledger, moves both balances, marks tx/proposal, mints ONE receipt, writes both WalletBalance snapshots', async () => {
    const senderWalletId = await provisionWallet(senderId);
    const recipientWalletId = await provisionWallet(recipientId);
    await seedLedgerCredit(senderWalletId, senderId, '100');

    // ── Propose ────────────────────────────────────────────────────────────
    const proposal = await proposalService.createSendProposal({
      userId: senderId,
      destination: {
        kind: 'internal_user',
        recipientUserId: recipientId,
        displayHandle: '@recipient',
        recipientDisplayName: 'Recipient User',
      },
      intent: {
        action: 'send_crypto',
        asset: 'USDT',
        cryptoAmount: '10.000000',
        network: 'TRON',
      },
    });

    // ── Authorize (request_step_up) ──────────────────────────────────────────
    const { directiveId, nonce } = await issueStepUp(proposal.proposalId);

    // ── Execute ──────────────────────────────────────────────────────────────
    const idempotencyKey = randomUUID();
    const result = await executionService.executeInternalTransfer({
      userId: senderId,
      proposalId: proposal.proposalId,
      directiveId,
      nonce,
      pin: '194837',
      idempotencyKey,
    });

    // ── Result ───────────────────────────────────────────────────────────────
    expect(result.status).toBe('completed');
    expect(result.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);
    expect(result.recipientUserId).toBe(recipientId);
    expect(toScaled(result.senderBalanceAfter)).toBe(toScaled('90'));
    expect(toScaled(result.recipientBalanceAfter)).toBe(toScaled('10'));

    // ── Transaction: internal_transfer, completed, owned by the sender ────────
    const txn = await prisma.transaction.findUnique({
      where: { id: result.transactionId },
    });
    expect(txn).not.toBeNull();
    expect(txn!.type).toBe('internal_transfer');
    expect(txn!.status).toBe('completed');
    expect(txn!.userId).toBe(senderId);
    expect(txn!.completedAt).not.toBeNull();

    // ── Exactly TWO ledger legs: debit sender, credit recipient, sum = 0 ──────
    const entries = await prisma.ledgerEntry.findMany({
      where: { transactionId: result.transactionId },
    });
    expect(entries).toHaveLength(2);

    const debit = entries.find((e) => e.direction === 'debit');
    const credit = entries.find((e) => e.direction === 'credit');
    expect(debit).toBeDefined();
    expect(credit).toBeDefined();
    // Debit leg → sender's user_wallet, USDT.
    expect(debit!.accountType).toBe('user_wallet');
    expect(debit!.accountId).toBe(senderWalletId);
    expect(debit!.currency).toBe('USDT');
    // Credit leg → recipient's user_wallet, USDT.
    expect(credit!.accountType).toBe('user_wallet');
    expect(credit!.accountId).toBe(recipientWalletId);
    expect(credit!.currency).toBe('USDT');
    // Same asset on both legs, per-currency signed sum = 0 (balanced double-entry).
    expect(debit!.currency).toBe(credit!.currency);
    const sum = entries.reduce(
      (acc, e) => acc + toScaled(String(e.amount)),
      0n,
    );
    expect(sum).toBe(0n);

    // ── Balances: sender -10, recipient +10 (authoritative ledger) ────────────
    expect(
      toScaled(
        await ledgerRepo.getAccountBalance(
          'user_wallet',
          senderWalletId,
          'USDT',
        ),
      ),
    ).toBe(toScaled('90'));
    expect(
      toScaled(
        await ledgerRepo.getAccountBalance(
          'user_wallet',
          recipientWalletId,
          'USDT',
        ),
      ),
    ).toBe(toScaled('10'));

    // ── Proposal → executed ───────────────────────────────────────────────────
    const prop = await prisma.proposal.findUnique({
      where: { id: proposal.proposalId },
    });
    expect(prop!.status).toBe('executed');

    // ── Exactly ONE signed Receipt (transactionId is unique) ──────────────────
    const receipts = await prisma.receipt.findMany({
      where: { transactionId: result.transactionId },
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].receiptNumber).toBe(result.receiptNumber);
    expect(receipts[0].userId).toBe(senderId);
    expect(receipts[0].signatureHash).toBeTruthy();
    expect(receipts[0].contentHash).toBeTruthy();

    // ── Both WalletBalance snapshots written ──────────────────────────────────
    const senderSnapshots = await prisma.walletBalance.findMany({
      where: { walletId: senderWalletId },
    });
    const recipientSnapshots = await prisma.walletBalance.findMany({
      where: { walletId: recipientWalletId },
    });
    expect(senderSnapshots).toHaveLength(1);
    expect(recipientSnapshots).toHaveLength(1);
    expect(toScaled(String(senderSnapshots[0].amount))).toBe(toScaled('90'));
    expect(toScaled(String(recipientSnapshots[0].amount))).toBe(toScaled('10'));
  });

  // -------------------------------------------------------------------------
  // Test 2 — In-atomic sender-balance guard
  // -------------------------------------------------------------------------

  it('in-atomic sender-balance guard: a transfer exceeding the sender ledger balance throws InsufficientBalanceError and posts NOTHING', async () => {
    const senderWalletId = await provisionWallet(senderId);
    const recipientWalletId = await provisionWallet(recipientId);
    // Sender holds only 1 USDT; the settle attempts to move 999.
    await seedLedgerCredit(senderWalletId, senderId, '1');

    const proposalId = await createTransferProposal(
      senderWalletId,
      recipientWalletId,
      '999',
    );

    const idempotencyKey = randomUUID();
    const input = buildSettleInput({
      proposalId,
      senderWalletId,
      recipientWalletId,
      cryptoAmount: '999',
      idempotencyKey,
      now: new Date(),
    });

    // Snapshot ledger-entry counts before (sender has 1 seed row; recipient has 0).
    const senderEntriesBefore = await prisma.ledgerEntry.count({
      where: { accountType: 'user_wallet', accountId: senderWalletId },
    });
    const recipientEntriesBefore = await prisma.ledgerEntry.count({
      where: { accountType: 'user_wallet', accountId: recipientWalletId },
    });

    // The in-atomic balance guard must fail closed.
    await expect(
      settlementRepo.settleInternalTransferAtomic(input),
    ).rejects.toThrow(InsufficientBalanceError);

    // ── Posts NOTHING — the whole $transaction rolled back ────────────────────
    // No anchor Transaction created for this idempotency key.
    expect(
      await prisma.transaction.findUnique({ where: { idempotencyKey } }),
    ).toBeNull();
    // No new ledger entries on either wallet.
    expect(
      await prisma.ledgerEntry.count({
        where: { accountType: 'user_wallet', accountId: senderWalletId },
      }),
    ).toBe(senderEntriesBefore);
    expect(
      await prisma.ledgerEntry.count({
        where: { accountType: 'user_wallet', accountId: recipientWalletId },
      }),
    ).toBe(recipientEntriesBefore);
    // No Receipt minted (fresh sender → 0 receipts).
    expect(await prisma.receipt.count({ where: { userId: senderId } })).toBe(0);
    // No WalletBalance snapshot written for either wallet.
    expect(
      await prisma.walletBalance.count({ where: { walletId: senderWalletId } }),
    ).toBe(0);
    expect(
      await prisma.walletBalance.count({
        where: { walletId: recipientWalletId },
      }),
    ).toBe(0);
    // Sender balance untouched at 1; recipient untouched at 0.
    expect(
      toScaled(
        await ledgerRepo.getAccountBalance(
          'user_wallet',
          senderWalletId,
          'USDT',
        ),
      ),
    ).toBe(toScaled('1'));
    expect(
      toScaled(
        await ledgerRepo.getAccountBalance(
          'user_wallet',
          recipientWalletId,
          'USDT',
        ),
      ),
    ).toBe(toScaled('0'));
    // Proposal stays pending (never flipped to executed).
    const prop = await prisma.proposal.findUnique({
      where: { id: proposalId },
    });
    expect(prop!.status).toBe('pending');
  });

  // -------------------------------------------------------------------------
  // Test 3 — Concurrent double-execute (the double-post guard)
  // -------------------------------------------------------------------------

  it('concurrent double-execute (same proposalId/idempotencyKey) posts once: one Transaction, one 2-leg pair, one Receipt, balances moved once', async () => {
    const senderWalletId = await provisionWallet(senderId);
    const recipientWalletId = await provisionWallet(recipientId);
    await seedLedgerCredit(senderWalletId, senderId, '100');

    const proposalId = await createTransferProposal(
      senderWalletId,
      recipientWalletId,
      '10',
    );

    // idempotencyKey = proposalId per the controller's I8 at-most-once rule.
    const idempotencyKey = proposalId;
    const input = buildSettleInput({
      proposalId,
      senderWalletId,
      recipientWalletId,
      cryptoAmount: '10',
      idempotencyKey,
      now: new Date(),
    });

    // Fire two concurrent settles for the SAME proposal/key — the overlapping-tick
    // race. The advisory locks on both wallets serialize them; the second finds the
    // committed anchor under the lock and returns the rebuilt output WITHOUT posting.
    const [r1, r2] = await Promise.all([
      settlementRepo.settleInternalTransferAtomic(input),
      settlementRepo.settleInternalTransferAtomic(input),
    ]);

    // Both resolve to the SAME anchor Transaction + receipt (no P2002, no throw).
    expect(r1.txn.id).toBe(r2.txn.id);
    expect(r1.receiptNumber).toBe(r2.receiptNumber);
    expect(r1.receiptNumber).toMatch(/^HS-\d{4}-\d{6}$/);

    // Exactly ONE anchor Transaction for the key.
    const txns = await prisma.transaction.findMany({
      where: { idempotencyKey },
    });
    expect(txns).toHaveLength(1);

    // Exactly TWO ledger legs for that transaction (one debit + one credit), sum = 0.
    const entries = await prisma.ledgerEntry.findMany({
      where: { transactionId: txns[0].id },
    });
    expect(entries).toHaveLength(2);
    expect(entries.filter((e) => e.direction === 'debit')).toHaveLength(1);
    expect(entries.filter((e) => e.direction === 'credit')).toHaveLength(1);
    const sum = entries.reduce(
      (acc, e) => acc + toScaled(String(e.amount)),
      0n,
    );
    expect(sum).toBe(0n);

    // Exactly ONE Receipt.
    const receipts = await prisma.receipt.findMany({
      where: { transactionId: txns[0].id },
    });
    expect(receipts).toHaveLength(1);

    // Balances moved exactly ONCE — sender 90, recipient 10 (not 80 / 20).
    expect(
      toScaled(
        await ledgerRepo.getAccountBalance(
          'user_wallet',
          senderWalletId,
          'USDT',
        ),
      ),
    ).toBe(toScaled('90'));
    expect(
      toScaled(
        await ledgerRepo.getAccountBalance(
          'user_wallet',
          recipientWalletId,
          'USDT',
        ),
      ),
    ).toBe(toScaled('10'));

    // Exactly one WalletBalance snapshot per wallet (only one post happened).
    expect(
      await prisma.walletBalance.count({ where: { walletId: senderWalletId } }),
    ).toBe(1);
    expect(
      await prisma.walletBalance.count({
        where: { walletId: recipientWalletId },
      }),
    ).toBe(1);
  });
});
