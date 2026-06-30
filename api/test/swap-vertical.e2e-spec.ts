/**
 * Integration test: swap vertical — propose → execute → settle with a STUBBED
 * swap provider (Testcontainers Postgres).
 *
 * Regression guard for the swap-addressId defect:
 *
 *  BUG — executeSwap passed addressId = params.walletId (the DB Wallet.id) to the
 *  Blockradar swap getQuote/execute calls. Blockradar requires the child-address
 *  id (= Wallet.providerReference), NOT the system-of-record Wallet.id. Proposal-
 *  time getQuote already used wallet.providerReference; executeSwap diverged and
 *  passed the wrong id, so every real swap would be rejected by the provider.
 *
 * The send path re-loads the wallet and threads providerReference through; the fix
 * makes executeSwap mirror it. This test asserts the stubbed swap provider's
 * getQuote AND execute both receive addressId === wallet.providerReference (the
 * value Blockradar assigned at provisioning), never the DB Wallet.id.
 *
 * Wiring is manual (no Nest DI), mirroring concurrent-settle-buy.e2e-spec.ts.
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
import { seedRegistryAssets } from './helpers/seed-registry-assets';

// Ports/types
import type { PrismaService } from '../src/core/prisma/prisma.service';
import type { IWalletProvider } from '../src/modules/wallets/application/ports/wallet-provider.port';
import type { IPaymentProvider } from '../src/modules/treasury/application/ports/payment-provider.port';
import type {
  ISwapProvider,
  GetSwapQuoteInput,
  ExecuteSwapInput,
} from '../src/modules/wallets/application/ports/swap-provider.port';

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
      return 'e2e-swap-vertical-signing-key-32-bytes-min!!' as T;
    }
    if (key === 'RECEIPT_SIGNING_KEY') {
      return 'e2e-swap-vertical-receipt-signing-key-32b!!' as T;
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

// The provider-assigned child-address id ("addressId" Blockradar expects).
// It is DISTINCT from the DB Wallet.id by construction so a regression that
// passes Wallet.id would be caught by the assertions below.
const FAKE_PROVIDER_REFERENCE = `fake_blockradar_ref_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

const fakeWalletProvider: IWalletProvider = {
  provisionAddress: jest.fn().mockResolvedValue({
    address: `TFakeSwap${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    providerReference: FAKE_PROVIDER_REFERENCE,
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

const FAKE_FLW_REF = 'flw_fake_ref_swap_vertical_001';

const fakePaymentProvider: IPaymentProvider = {
  createCollection: jest.fn().mockResolvedValue({
    accountNumber: '0987654399',
    bankName: 'Test Swap Bank',
    providerRef: FAKE_FLW_REF,
  }),
  // amount is intentionally large: settleBuyPayment passes when verified ≥ expected
  // and currency matches, so this verifies any buy used to fund the swap.
  verify: jest.fn().mockResolvedValue({
    status: 'successful',
    amount: '1000000',
    currency: 'NGN',
    providerRef: FAKE_FLW_REF,
  }),
  createPayout: jest.fn(),
  verifyPayout: jest.fn(),
  verifyWebhookSignature: jest.fn().mockReturnValue(true),
};

// ---------------------------------------------------------------------------
// Stubbed swap provider — captures every addressId it is called with.
// ---------------------------------------------------------------------------

const SWAP_RATE = '13'; // 1 USDT = 13 TRX (illustrative); no drift on re-quote.

class CapturingSwapProvider implements ISwapProvider {
  readonly getQuoteAddressIds: string[] = [];
  readonly executeAddressIds: string[] = [];

  getQuote(input: GetSwapQuoteInput) {
    this.getQuoteAddressIds.push(input.addressId);
    const toAmount = (Number(input.amount) * Number(SWAP_RATE)).toString();
    return Promise.resolve({
      toAmount,
      rate: SWAP_RATE,
      minAmount: '1',
      slippage: 50,
      networkFee: '1',
      transactionFee: '0.5',
      estimatedArrivalSec: 60,
    });
  }

  execute(input: ExecuteSwapInput) {
    this.executeAddressIds.push(input.addressId);
    return Promise.resolve({
      providerSwapId: `swap_${input.reference}`,
      status: 'pending' as const,
    });
  }
}

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

describe('Swap vertical — propose → execute → settle (Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  let executionService: ExecutionService;
  let directiveService: DirectiveService;
  let proposalService: ProposalService;
  let pinService: PinService;
  let swapProvider: CapturingSwapProvider;

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
    const ledgerRepo = new LedgerPrismaRepository(ps);

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
    seedRegistryAssets(assetRegistry);
    const walletService = new WalletService(
      fakeWalletProvider,
      walletRepo,
      clock,
      assetRegistry,
    );
    swapProvider = new CapturingSwapProvider();

    proposalService = new ProposalService(
      quotesService,
      kycGateService,
      quoteRepo,
      proposalRepo,
      clock,
      walletService,
      { getById: () => Promise.resolve(null) } as never,
      assetRegistry,
      // Real ledger repo so the swap balance check reads the seeded USDT balance.
      ledgerRepo,
      {
        screenSendDestination: () =>
          Promise.resolve({ passed: true, complianceEventId: '' }),
      } as never,
      config,
      // swapProvider — used by the swap proposal path (getQuote at propose time).
      swapProvider,
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
      ledgerRepo,
      undefined, // identityService
      undefined, // whatsAppSender
      undefined, // complianceService (not needed for swap)
      undefined, // sessionService (not needed for swap)
      swapProvider, // SWAP_PROVIDER
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
      // tier_2: perTxFiatMax 500k / dailyFiatMax 2M — comfortably covers the
      // funding buy plus the swap below.
      data: { kycStatus: 'verified', kycTier: 'tier_2', status: 'active' },
    });
    await pinService.setPin(user.id, '123456');
    return user.id;
  }

  /**
   * Funds the user's wallet with USDT by running a real BUY end-to-end
   * (propose → execute → settle). This provisions the TRON wallet via the fake
   * provider (so providerReference === FAKE_PROVIDER_REFERENCE) and posts a real
   * USDT credit ledger entry tied to the buy transaction — exactly the state a
   * subsequent swap reads through getAccountBalance.
   */
  async function fundWalletWithUsdt(
    userId: string,
    fiatAmount: string,
  ): Promise<{ walletId: string; providerReference: string }> {
    const { proposalId } = await proposalService.createBuyProposal({
      userId,
      intent: {
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount,
        fiatCurrency: 'NGN',
      },
    });
    const { directiveId, nonce } = await directiveService.issue({
      proposalId,
      userId,
      ref: 'request_pin',
    });
    const buyKey = randomUUID();
    await executionService.executeBuy({
      userId,
      proposalId,
      directiveId,
      nonce,
      pin: '123456',
      idempotencyKey: buyKey,
    });
    await executionService.settleBuyPayment({ reference: buyKey });

    const wallet = await prisma.wallet.findFirst({
      where: { userId, network: 'TRON' },
    });
    return {
      walletId: wallet!.id,
      providerReference: wallet!.providerReference,
    };
  }

  // ---------------------------------------------------------------------------
  // BUG — addressId must be wallet.providerReference, NOT wallet.id
  // ---------------------------------------------------------------------------

  it('executeSwap passes wallet.providerReference (not wallet.id) as addressId to getQuote and execute', async () => {
    const userId = await seedUser();
    // 40,000 NGN buys ~24 USDT (baseRate 1600 + 150bps spread) — enough to swap 20.
    const { walletId, providerReference } = await fundWalletWithUsdt(
      userId,
      '40000',
    );

    // The two ids MUST differ so the assertion is meaningful.
    expect(providerReference).not.toBe(walletId);

    swapProvider.getQuoteAddressIds.length = 0;
    swapProvider.executeAddressIds.length = 0;

    // 1. Propose a USDT → TRX swap (20 USDT = 32,000 NGN-equiv, under tier_2 500k cap).
    const { proposalId } = await proposalService.createSwapProposal({
      userId,
      fromAsset: 'USDT',
      toAsset: 'TRX',
      amount: '20',
    });

    // The propose-time getQuote already used providerReference.
    expect(swapProvider.getQuoteAddressIds).toEqual([providerReference]);

    // 2. Issue the request_pin directive (swap step-up).
    const { directiveId, nonce } = await directiveService.issue({
      proposalId,
      userId,
      ref: 'request_pin',
    });

    // 3. Execute the swap.
    const idempotencyKey = randomUUID();
    const result = await executionService.executeSwap({
      userId,
      proposalId,
      directiveId,
      nonce,
      pin: '123456',
      idempotencyKey,
    });

    expect(result.status).toBe('settling');
    expect(result.swap.providerSwapId).toBe(`swap_${idempotencyKey}`);

    // CORE ASSERTION — execute-time getQuote (re-quote) AND execute both received
    // the providerReference, never the DB Wallet.id.
    expect(swapProvider.executeAddressIds).toEqual([providerReference]);
    expect(swapProvider.executeAddressIds).not.toContain(walletId);
    // getQuote was called once more (the execute-time re-quote) with providerReference.
    expect(swapProvider.getQuoteAddressIds).toEqual([
      providerReference,
      providerReference,
    ]);
    expect(swapProvider.getQuoteAddressIds).not.toContain(walletId);

    // The reserve debited the user's USDT (user_wallet → swap_clearing); the txn
    // is 'settling' awaiting Phase-2 settleSwap.
    const txn = await prisma.transaction.findUnique({
      where: { id: result.transactionId },
    });
    expect(txn!.status).toBe('settling');
    expect(txn!.type).toBe('swap');

    // 4. Settle the swap success (Phase 2) — credit TRX, finalize.
    const settle = await executionService.settleSwap({
      reference: idempotencyKey,
      success: true,
      toAmount: '260', // 20 USDT × 13
      hash: 'e2e-swap-onchain-hash',
    });
    expect(settle.status).toBe('completed');

    const settledTxn = await prisma.transaction.findUnique({
      where: { id: result.transactionId },
    });
    expect(settledTxn!.status).toBe('completed');

    // Ledger is balanced per currency for this transaction.
    const entries = await prisma.ledgerEntry.findMany({
      where: { transactionId: result.transactionId },
    });
    const byCurrency: Record<string, bigint> = {};
    for (const e of entries) {
      const amt = toScaled((e.amount as { toString(): string }).toString());
      byCurrency[e.currency] = (byCurrency[e.currency] ?? 0n) + amt;
    }
    for (const sum of Object.values(byCurrency)) {
      expect(sum).toBe(0n);
    }
  });
});
