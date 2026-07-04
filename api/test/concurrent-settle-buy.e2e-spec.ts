/**
 * Integration test: concurrent buy settlement — idempotency + advisory-lock fix.
 *
 * Regression guard for two money-path defects observed live:
 *
 *  BUG 1a — settleBuyPayment is not idempotent against CONCURRENT in-flight
 *  settles. Two overlapping reconciler ticks (or a webhook + a tick) call
 *  settleBuyPayment for the SAME reference. Both read status='settling' OUTSIDE
 *  the atomic, both enter settleBuyAtomic. Without an in-atomic status re-check
 *  the second run posts a SECOND full set of ledger entries (double credit) and a
 *  second receipt — and, under sequence races, a P2002 on
 *  (accountType, accountId, sequence).
 *
 *  BUG 1b — two DIFFERENT buys (different users) that both write the SHARED
 *  treasury/processor/fees ledger accounts must serialize on those accounts'
 *  sequence via the advisory lock — no P2002.
 *
 * Assertions:
 *   - Promise.all([settle, settle]) for the SAME buy resolves without error
 *     (no P2002), credits the user EXACTLY ONCE (one user_wallet credit entry,
 *     one WalletBalance row, one Receipt), and the ledger stays balanced.
 *   - Promise.all of two DIFFERENT buys sharing the treasury account both
 *     complete with no P2002 and exactly one credit each.
 *
 * Wiring is manual (no Nest DI), mirroring settlement-buy.e2e-spec.ts. Requires Docker.
 * Runs only in the `test:e2e` lane (jest-e2e.json).
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
      return 'e2e-concurrent-buy-signing-key-32-bytes-min!!' as T;
    }
    if (key === 'RECEIPT_SIGNING_KEY') {
      return 'e2e-concurrent-buy-receipt-signing-key-32b!!' as T;
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

const FAKE_FLW_REF = 'flw_fake_ref_concurrent_buy_001';

const fakeWalletProvider: IWalletProvider = {
  // Unique address + ref per call so multiple users each get a distinct wallet
  // (Wallet.address and Wallet.providerReference are unique columns).
  provisionAddress: jest.fn().mockImplementation(() => {
    const id = randomUUID().replace(/-/g, '').slice(0, 20);
    return Promise.resolve({
      address: `TFakeConcBuy${id}`,
      providerReference: `fake_blockradar_ref_${id}`,
    });
  }),
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
  createCollection: jest.fn().mockResolvedValue({
    accountNumber: '0987654399',
    bankName: 'Test Concurrent Bank',
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
// Decimal-safe helper
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

describe('Concurrent buy settlement — idempotency + advisory lock (Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  let executionService: ExecutionService;
  let directiveService: DirectiveService;
  let proposalService: ProposalService;
  let pinService: PinService;

  const clock = { now: () => new Date() };

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    const ps = prisma as unknown as PrismaService;
    const config = new StubConfigService() as never;

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

    const rateProvider = new ConfigRateProvider(config);
    const quotesService = new QuotesService(rateProvider, clock);
    const kycGateService = new KycGateService(
      identityRepo,
      velocityRepo,
      config,
      clock,
    );
    pinService = new PinService(pinRepo, config, clock);
    directiveService = new DirectiveService(
      directiveRepo,
      config,
      clock,
      config,
    );
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
      { getById: () => Promise.resolve(null) } as never,
      assetRegistry,
      { getAccountBalance: () => Promise.resolve('0') } as never,
      {
        screenSendDestination: () =>
          Promise.resolve({ passed: true, complianceEventId: '' }),
      } as never,
      config,
      undefined as never,
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
      { getById: () => Promise.resolve(null) } as never,
      new LedgerPrismaRepository(ps),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  afterAll(async () => {
    await stop?.();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function seedUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { kycStatus: 'verified', kycTier: 'tier_1', status: 'active' },
    });
    await pinService.setPin(user.id, '194837');
    return user.id;
  }

  async function seedSettlingTransaction(userId: string): Promise<{
    transactionId: string;
    reference: string;
    walletId: string;
  }> {
    const { proposalId } = await proposalService.createBuyProposal({
      userId,
      intent: {
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount: '10000',
        fiatCurrency: 'NGN',
      },
    });
    const { directiveId, nonce } = await directiveService.issue({
      proposalId,
      userId,
      ref: 'request_pin',
    });
    const idempotencyKey = randomUUID();
    const result = await executionService.executeBuy({
      userId,
      proposalId,
      directiveId,
      nonce,
      pin: '194837',
      idempotencyKey,
    });
    const wallet = await prisma.wallet.findFirst({
      where: { userId, network: 'TRON' },
    });
    return {
      transactionId: result.transactionId,
      reference: idempotencyKey,
      walletId: wallet!.id,
    };
  }

  // ---------------------------------------------------------------------------
  // BUG 1a — concurrent settle of the SAME buy must credit exactly once
  // ---------------------------------------------------------------------------

  it('two concurrent settleBuyPayment for the SAME buy → no P2002, exactly one credit, one receipt', async () => {
    const userId = await seedUser();
    const { transactionId, reference, walletId } =
      await seedSettlingTransaction(userId);

    // Fire two concurrent settles for the same reference — the overlapping-tick race.
    const [r1, r2] = await Promise.all([
      executionService.settleBuyPayment({ reference }),
      executionService.settleBuyPayment({ reference }),
    ]);

    // Both calls must resolve to 'completed' with the SAME receiptNumber (idempotent).
    expect(r1.status).toBe('completed');
    expect(r2.status).toBe('completed');
    expect(r1.receiptNumber).toBe(r2.receiptNumber);

    // Exactly ONE user_wallet credit entry — no double credit.
    const walletEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId, accountType: 'user_wallet', accountId: walletId },
    });
    expect(walletEntries).toHaveLength(1);

    // Exactly ONE WalletBalance snapshot for this wallet.
    const balances = await prisma.walletBalance.findMany({
      where: { walletId },
    });
    expect(balances).toHaveLength(1);

    // Exactly ONE Receipt (Receipt.transactionId is unique — a 2nd insert would throw).
    const receipts = await prisma.receipt.findMany({
      where: { transactionId },
    });
    expect(receipts).toHaveLength(1);

    // Ledger balanced per currency for this transaction.
    const entries = await prisma.ledgerEntry.findMany({
      where: { transactionId },
    });
    const byCurrency: Record<string, bigint> = {};
    for (const e of entries) {
      const amt = toScaled((e.amount as { toString(): string }).toString());
      byCurrency[e.currency] = (byCurrency[e.currency] ?? 0n) + amt;
    }
    for (const sum of Object.values(byCurrency)) {
      expect(sum).toBe(0n);
    }

    const txn = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    expect(txn!.status).toBe('completed');
  });

  // ---------------------------------------------------------------------------
  // BUG 1b — two DIFFERENT buys sharing the treasury account must not collide
  // ---------------------------------------------------------------------------

  it('two concurrent settleBuyPayment for DIFFERENT buys sharing treasury → no P2002, each credited once', async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const a = await seedSettlingTransaction(userA);
    const b = await seedSettlingTransaction(userB);

    const [ra, rb] = await Promise.all([
      executionService.settleBuyPayment({ reference: a.reference }),
      executionService.settleBuyPayment({ reference: b.reference }),
    ]);

    expect(ra.status).toBe('completed');
    expect(rb.status).toBe('completed');
    expect(ra.receiptNumber).not.toBe(rb.receiptNumber);

    // Each user credited exactly once.
    for (const t of [a, b]) {
      const walletEntries = await prisma.ledgerEntry.findMany({
        where: {
          transactionId: t.transactionId,
          accountType: 'user_wallet',
          accountId: t.walletId,
        },
      });
      expect(walletEntries).toHaveLength(1);
    }

    // The SHARED treasury USDT account got two debits with DISTINCT sequential sequences.
    const treasuryEntries = await prisma.ledgerEntry.findMany({
      where: {
        accountType: 'treasury_reserve',
        accountId: 'usdt_treasury',
        currency: 'USDT',
      },
      orderBy: { sequence: 'asc' },
    });
    const seqs = treasuryEntries.map((e) => e.sequence);
    expect(new Set(seqs).size).toBe(seqs.length); // all distinct — no P2002 collision
  });

  // ---------------------------------------------------------------------------
  // BUG 2 — multi-asset ledger sequence. A wallet that already holds one asset
  // must accept a credit in a DIFFERENT asset. The ledger allocates `sequence`
  // PER (accountType, accountId, currency), but the unique constraint was
  // (accountType, accountId, sequence) — currency-less. So the FIRST time a
  // wallet account received a 2nd currency, the new per-currency sequence (1)
  // collided with the existing currency's sequence (1) → deterministic P2002,
  // blocking every multi-asset user. Constraint now includes `currency`.
  // ---------------------------------------------------------------------------

  it('credits a 2nd asset into a wallet that already holds another asset (multi-asset sequence) → no P2002', async () => {
    const userId = await seedUser();
    const { transactionId, reference, walletId } =
      await seedSettlingTransaction(userId);

    // The user ALREADY holds TRX on this wallet: a prior TRX ledger entry at
    // sequence 1. The USDT buy credits the SAME (accountType, accountId); its
    // per-currency sequence is also 1 — which collided under the old constraint.
    await prisma.ledgerEntry.create({
      data: {
        transactionId,
        accountType: 'user_wallet',
        accountId: walletId,
        currency: 'TRX',
        amount: '5',
        direction: 'credit',
        description: 'seed: prior TRX holding on this wallet',
        balanceAfter: '5',
        sequence: 1,
        postedAt: new Date(),
      },
    });

    // Settle the USDT buy — must NOT collide with the TRX seq-1 row.
    const res = await executionService.settleBuyPayment({ reference });
    expect(res.status).toBe('completed');

    // The wallet now holds BOTH assets, each at its own per-currency sequence
    // (both sequence=1, disambiguated by currency in the unique constraint).
    const trx = await prisma.ledgerEntry.findMany({
      where: {
        accountType: 'user_wallet',
        accountId: walletId,
        currency: 'TRX',
      },
    });
    const usdt = await prisma.ledgerEntry.findMany({
      where: {
        accountType: 'user_wallet',
        accountId: walletId,
        currency: 'USDT',
        transactionId,
      },
    });
    expect(trx).toHaveLength(1);
    expect(usdt).toHaveLength(1);
    expect(usdt[0].sequence).toBe(1);
  });
});
