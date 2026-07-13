/**
 * Unit tests for ExecutionService.executeBuy (task 4.5a, CLAUDE.md §3.1).
 *
 * All external dependencies are mocked. Tests verify:
 *   1. Happy path — full gauntlet passes, Transaction created, outbox enqueued.
 *   2. Expired proposal → ProposalExpiredError, no Transaction created.
 *   3. Wrong owner / bad status → ProposalNotExecutableError.
 *   4. Drift exceeded → QuoteDriftError, no Transaction.
 *   5. KYC gate throws → propagates, no Transaction.
 *   6. Directive consume throws (replay) → propagates after PIN check, no Transaction.
 *   7. PIN invalid → propagates WITHOUT consuming the directive (I5), no collection/outbox.
 *   8. Idempotent replay → returns existing result, no new side effects.
 *
 * Call ORDER is asserted to guarantee security invariants.
 *
 * TDD: tests written first (red), then ExecutionService is implemented.
 */

import type {
  QuoteBuyOutput,
  QuoteSellOutput,
} from '@handshake-agent/contracts';

import type { Clock } from '../../../core/common/clock';
import type { PinService } from '../../../core/auth/pin.service';
import type { SessionService } from '../../../core/auth/session.service';
import type {
  AssertCanTransactInput,
  KycGateService,
  OriginatorIdentity,
} from '../../identity/application/kyc-gate.service';
import type { QuotesService } from '../../quotes/application/quotes.service';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { WalletService } from '../../wallets/application/wallet.service';
import type { IPaymentProvider } from '../../treasury/application/ports/payment-provider.port';
import type {
  IProposalRepository,
  ProposalRecord,
} from './ports/proposal.repository.port';
import type {
  IQuoteRepository,
  QuoteRecord,
} from './ports/quote.repository.port';
import type {
  ITransactionRepository,
  TransactionRecord,
} from './ports/transaction.repository.port';
import type { ISettlementOutboxRepository } from './ports/settlement-outbox.repository.port';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { DirectiveService } from './directive.service';
import type { DirectiveGrantRecord } from './ports/directive.repository.port';
import { ExecutionService } from './execution.service';
import {
  ProposalExpiredError,
  ProposalNotExecutableError,
  QuoteDriftError,
  SettlementInvalidStatusError,
  InsufficientBalanceError,
  BaseRateMisconfiguredError,
  ProviderUnavailableError,
  SwapUnavailableError,
} from '../domain/execution-errors';
import { DirectiveReplayError } from '../domain/directive-errors';
import { PinInvalidError } from '../../../core/auth/domain/pin-errors';
import type {
  ISettlementRepository,
  SettleBuyAtomicOutput,
} from './ports/settlement.repository.port';
import type { BeneficiaryRecord } from '../../beneficiaries/application/ports/beneficiary.repository.port';
import { BeneficiaryCoolingOffError } from '../../beneficiaries/domain/beneficiary-errors';
import { SanctionsBlockedError } from '../../compliance/domain/compliance-errors';
import type { WalletRecord } from '../../wallets/application/ports/wallet.repository.port';

// ---------------------------------------------------------------------------
// Fixed test values
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2025-06-01T12:00:00.000Z');
const FUTURE = new Date('2025-06-01T13:00:00.000Z'); // 1h from now
const PAST = new Date('2025-06-01T11:00:00.000Z'); // 1h before now

const USER_ID = 'aaaaaaaa-0001-7000-8000-000000000001';
const OTHER_USER_ID = 'aaaaaaaa-0001-7000-8000-000000000099';
const PROPOSAL_ID = 'bbbbbbbb-0002-7000-8000-000000000002';
const QUOTE_ID = 'cccccccc-0003-7000-8000-000000000003';
const DIRECTIVE_ID = 'dddddddd-0004-7000-8000-000000000004';
const NONCE = 'a'.repeat(64);
const PIN = '123456';
const IDEMPOTENCY_KEY = 'eeeeeeee-0005-7000-8000-000000000005';
const TXN_ID = 'ffffffff-0006-7000-8000-000000000006';

const STORED_QUOTE: QuoteRecord = {
  id: QUOTE_ID,
  userId: USER_ID,
  type: 'buy',
  asset: 'USDT',
  fiatCurrency: 'NGN',
  fiatAmount: '10000',
  cryptoAmount: '6.123456',
  fxRate: '1600',
  baseRate: '1600',
  spreadBps: 150,
  processingFeeBps: 100,
  processingFeeAmount: '100.00',
  status: 'valid',
  expiresAt: FUTURE,
  createdAt: FIXED_NOW,
};

const FRESH_QUOTE: QuoteBuyOutput = {
  asset: 'USDT',
  fiatAmount: '10000',
  fiatCurrency: 'NGN',
  cryptoAmount: '6.123456',
  baseRate: '1600',
  fxRate: '1600', // same rate — no drift
  spreadBps: 150,
  processingFeeBps: 100,
  quotedAt: FIXED_NOW.toISOString(),
  expiresInSec: 30,
};

const STUB_PROPOSAL: ProposalRecord = {
  id: PROPOSAL_ID,
  userId: USER_ID,
  conversationId: null,
  type: 'buy',
  status: 'pending',
  parameters: { asset: 'USDT', fiatAmount: '10000', fiatCurrency: 'NGN' },
  parametersChecksum: 'a'.repeat(64),
  quoteId: QUOTE_ID,
  expiresAt: FUTURE,
  confirmedAt: null,
  createdAt: FIXED_NOW,
};

const STUB_GRANT: DirectiveGrantRecord = {
  directiveId: DIRECTIVE_ID,
  proposalId: PROPOSAL_ID,
  userId: USER_ID,
  directiveRef: 'request_pin',
  origin: 'engine',
  nonceHash: 'hash',
  signatureValue: 'sig',
  status: 'consumed',
  issuedAt: FIXED_NOW,
  expiresAt: FUTURE,
  consumedAt: FIXED_NOW,
  consumedProposalId: PROPOSAL_ID,
  failureReason: null,
  failureCount: 0,
};

const STUB_TXN: TransactionRecord = {
  id: TXN_ID,
  proposalId: PROPOSAL_ID,
  userId: USER_ID,
  type: 'buy',
  status: 'settling',
  idempotencyKey: IDEMPOTENCY_KEY,
  requestChecksum: 'checksum',
  fxRateSnapshot: '1600',
  metadata: { asset: 'USDT', fiatAmount: '10000', fiatCurrency: 'NGN' },
  processorTxRef: null,
  onChainTxHash: null,
  failureReason: null,
  pinVerifiedAt: FIXED_NOW,
  createdAt: FIXED_NOW,
  executedAt: null,
  completedAt: null,
  failedAt: null,
};

const STUB_COLLECTION = {
  accountNumber: '0123456789',
  bankName: 'Test Bank',
  providerRef: 'flw_ref_001',
};

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeProposalRepo(
  proposal: ProposalRecord | null = STUB_PROPOSAL,
): jest.Mocked<IProposalRepository> {
  return {
    create: jest.fn().mockResolvedValue({ id: PROPOSAL_ID }),
    findById: jest.fn().mockResolvedValue(proposal),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    getType: jest.fn().mockResolvedValue(proposal?.type ?? null),
    listPendingForUser: jest.fn().mockResolvedValue([]),
  };
}

function makeQuoteRepo(
  quote: QuoteRecord | null = STORED_QUOTE,
): jest.Mocked<IQuoteRepository> {
  return {
    create: jest.fn().mockResolvedValue({ id: QUOTE_ID }),
    findById: jest.fn().mockResolvedValue(quote),
  };
}

function makeTransactionRepo(
  existing: TransactionRecord | null = null,
  created: TransactionRecord = STUB_TXN,
): jest.Mocked<ITransactionRepository> {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByIdempotencyKey: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockResolvedValue(created),
    createSettlingWithProposal: jest.fn().mockResolvedValue(created),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    mergeMetadata: jest.fn().mockResolvedValue(undefined),
    listByUserInRange: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    findByUserId: jest.fn().mockResolvedValue([]),
    listAll: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listByStatus: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  };
}

function makeOutboxRepo(): jest.Mocked<ISettlementOutboxRepository> {
  return {
    create: jest.fn().mockResolvedValue({
      id: 'outbox-id',
      transactionId: TXN_ID,
      settlementType: 'processor_collection',
      payload: {},
      idempotencyKey: IDEMPOTENCY_KEY,
      status: 'pending',
      processorRef: 'flw_ref_001',
      attempt: 1,
      lastAttemptAt: null,
      createdAt: FIXED_NOW,
    }),
    findPending: jest.fn().mockResolvedValue([]),
    markAttempt: jest.fn().mockResolvedValue(undefined),
    complete: jest.fn().mockResolvedValue(undefined),
    findByTransactionId: jest.fn().mockResolvedValue(null),
    resetToPending: jest.fn().mockResolvedValue(undefined),
  };
}

const STUB_RECEIPT_NUMBER = 'HS-2025-000001';

function makeSettlementRepo(
  receiptNumber: string | null = null,
  atomicOutput: SettleBuyAtomicOutput = { receiptNumber: STUB_RECEIPT_NUMBER },
  sellTxnOverride?: TransactionRecord,
  sendTxnOverride?: TransactionRecord,
): jest.Mocked<ISettlementRepository> {
  return {
    findReceiptNumber: jest.fn().mockResolvedValue(receiptNumber),
    settleBuyAtomic: jest.fn().mockResolvedValue(atomicOutput),
    postSellReserveAtomic: jest.fn().mockResolvedValue(undefined),
    // Lazy so callers that do NOT need sell can pass undefined; sell tests
    // call buildSellService which passes STUB_SELL_TXN explicitly.
    createSellSettlingWithReserveAtomic: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ txn: sellTxnOverride ?? STUB_TXN }),
      ),
    settleSellFinalizeAtomic: jest
      .fn()
      .mockResolvedValue({ receiptNumber: STUB_RECEIPT_NUMBER }),
    settleSellRefundAtomic: jest.fn().mockResolvedValue(undefined),
    // Send methods
    createSendSettlingWithReserveAtomic: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ txn: sendTxnOverride ?? STUB_TXN }),
      ),
    settleSendFinalizeAtomic: jest
      .fn()
      .mockResolvedValue({ receiptNumber: STUB_RECEIPT_NUMBER }),
    settleSendRefundAtomic: jest.fn().mockResolvedValue(undefined),
    // Swap methods — unused by buy/sell/send tests; swap tests override via makeSwapSettlementRepo.
    createSwapSettlingWithReserveAtomic: jest
      .fn()
      .mockResolvedValue({ txn: STUB_TXN }),
    settleSwapFinalizeAtomic: jest
      .fn()
      .mockResolvedValue({ receiptNumber: STUB_RECEIPT_NUMBER }),
    settleSwapRefundAtomic: jest.fn().mockResolvedValue(undefined),
    // Manual credit — admin-only path, never exercised by execution-engine tests.
    settleManualCreditAtomic: jest.fn().mockResolvedValue({
      credited: true,
      newBalance: '0',
      receiptNumber: STUB_RECEIPT_NUMBER,
    }),
  };
}

function makeQuotesService(
  quote: QuoteBuyOutput = FRESH_QUOTE,
): jest.Mocked<Pick<QuotesService, 'quoteBuy'>> {
  return { quoteBuy: jest.fn().mockResolvedValue(quote) };
}

function makeKycGate(
  throws?: Error,
  originatorName: string | null = null,
): jest.Mocked<
  Pick<
    KycGateService,
    'assertCanTransact' | 'getOriginatorName' | 'getOriginatorIdentity'
  >
> {
  const svc = {
    // Fix-C: fiatAmount is now a string (exact NGN decimal).
    // Task 1.3: input is typed against the real AssertCanTransactInput (now
    // requires `capability`) so this mock stays assignable to KycGateService.
    assertCanTransact: jest.fn<Promise<void>, [AssertCanTransactInput]>(),
    getOriginatorName: jest.fn<Promise<string | null>, [string]>(),
    getOriginatorIdentity: jest.fn<Promise<OriginatorIdentity>, [string]>(),
  };
  if (throws) {
    svc.assertCanTransact.mockRejectedValue(throws);
  } else {
    svc.assertCanTransact.mockResolvedValue(undefined);
  }
  svc.getOriginatorName.mockResolvedValue(originatorName);
  // Default: no captured name/email → executeBuy substitutes safe placeholders.
  svc.getOriginatorIdentity.mockResolvedValue({
    firstName: null,
    lastName: null,
    email: null,
  });
  return svc;
}

function makeDirectiveService(
  result: DirectiveGrantRecord | Error = STUB_GRANT,
): jest.Mocked<Pick<DirectiveService, 'consume'>> {
  const svc = { consume: jest.fn() };
  if (result instanceof Error) {
    svc.consume.mockRejectedValue(result);
  } else {
    svc.consume.mockResolvedValue(result);
  }
  return svc;
}

function makePinService(
  throws?: Error,
): jest.Mocked<Pick<PinService, 'verifyPin'>> {
  const svc = { verifyPin: jest.fn<Promise<void>, [string, string]>() };
  if (throws) {
    svc.verifyPin.mockRejectedValue(throws);
  } else {
    svc.verifyPin.mockResolvedValue(undefined);
  }
  return svc;
}

function makeWalletService(): jest.Mocked<
  Pick<WalletService, 'getOrProvisionNetworkWallet'>
> {
  const walletRecord = {
    id: 'wallet-id',
    userId: USER_ID,
    network: 'TRON',
    address: 'TTestAddress123',
    providerReference: 'blockradar-ref-001',
    status: 'active',
  };
  return {
    getOrProvisionNetworkWallet: jest.fn().mockResolvedValue(walletRecord),
  };
}

function makeWalletServiceWithWithdraw(
  providerReference = 'blockradar-tx-ref-001',
): jest.Mocked<
  Pick<WalletService, 'getOrProvisionNetworkWallet' | 'withdraw'>
> {
  const walletRecord: WalletRecord = {
    id: 'wallet-id',
    userId: USER_ID,
    network: 'TRON',
    address: 'TTestAddress123',
    providerReference: 'blockradar-ref-001',
    status: 'active',
  };
  return {
    getOrProvisionNetworkWallet: jest.fn().mockResolvedValue(walletRecord),
    withdraw: jest.fn().mockResolvedValue({
      providerReference,
      status: 'pending' as const,
    }),
  };
}

/**
 * Minimal AssetRegistry stub for ExecutionService tests.
 * ExecutionService only uses defaultNetworkFor() in executeBuy (step 8a).
 */
function makeAssetRegistry(): jest.Mocked<AssetRegistry> {
  return {
    defaultNetworkFor: jest.fn().mockReturnValue('TRON'),
    asset: jest.fn(),
    network: jest.fn(),
    fiat: jest.fn(),
    assetProviderId: jest
      .fn()
      .mockReturnValue('f56d297c-a3db-4cda-95bd-180b54679070'),
    defaultCryptoAsset: jest.fn().mockReturnValue('USDT'),
    defaultFiat: jest.fn().mockReturnValue('NGN'),
    isAssetEnabled: jest.fn().mockReturnValue(true),
    isNetworkEnabled: jest.fn().mockReturnValue(true),
    isFiatEnabled: jest.fn().mockReturnValue(true),
    isCapabilityEnabled: jest.fn().mockReturnValue(true),
    requireCapability: jest.fn(),
    formatCrypto: jest.fn(),
    formatFiat: jest.fn(),
    validateAddress: jest.fn().mockReturnValue(true),
  } as unknown as jest.Mocked<AssetRegistry>;
}

function makePaymentProvider(
  throws?: Error,
  verifyResult?: {
    status: string;
    amount: string;
    currency: string;
    providerRef: string;
  },
): jest.Mocked<Pick<IPaymentProvider, 'createCollection' | 'verify'>> {
  const svc = {
    createCollection: jest.fn(),
    verify: jest.fn(),
  };
  if (throws) {
    svc.createCollection.mockRejectedValue(throws);
  } else {
    svc.createCollection.mockResolvedValue(STUB_COLLECTION);
  }
  svc.verify.mockResolvedValue(
    verifyResult ?? {
      status: 'successful',
      amount: '10000',
      currency: 'NGN',
      providerRef: 'flw_ref_001',
    },
  );
  return svc;
}

const stubClock: Clock = { now: () => FIXED_NOW };

// Stub EffectiveConfigService (returns the buy/sell/swap/pricing config values).
// A `buyMaxDriftBps` override simulates a DB AppSetting override of buy.maxDriftBps
// flowing through the engine's constructor read.
function makeStubConfig(opts: { buyMaxDriftBps?: number } = {}): {
  get: jest.Mock;
} {
  return {
    get: jest.fn((key: string) => {
      if (key === 'buy') return { maxDriftBps: opts.buyMaxDriftBps ?? 50 };
      if (key === 'sell') return { maxDriftBps: 50 };
      // pricing.assets.USDT.baseRates.NGN is required by executeSend's KYC-gate guard.
      if (key === 'pricing')
        return {
          assets: {
            USDT: { baseRates: { NGN: 1600 } },
            BTC: { baseRates: { NGN: 85_000_000 } },
          },
        };
      return undefined;
    }),
  };
}

const stubConfig = makeStubConfig();

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

function buildService(
  overrides: {
    proposalRepo?: jest.Mocked<IProposalRepository>;
    quoteRepo?: jest.Mocked<IQuoteRepository>;
    transactionRepo?: jest.Mocked<ITransactionRepository>;
    outboxRepo?: jest.Mocked<ISettlementOutboxRepository>;
    settlementRepo?: jest.Mocked<ISettlementRepository>;
    quotesService?: jest.Mocked<Pick<QuotesService, 'quoteBuy'>>;
    kycGate?: jest.Mocked<Pick<KycGateService, 'assertCanTransact'>>;
    directiveService?: jest.Mocked<Pick<DirectiveService, 'consume'>>;
    pinService?: jest.Mocked<Pick<PinService, 'verifyPin'>>;
    walletService?: jest.Mocked<
      Pick<WalletService, 'getOrProvisionNetworkWallet'>
    >;
    paymentProvider?: jest.Mocked<
      Pick<IPaymentProvider, 'createCollection' | 'verify'>
    >;
    assetRegistry?: jest.Mocked<AssetRegistry>;
    config?: EffectiveConfigService;
  } = {},
): ExecutionService {
  return new ExecutionService(
    overrides.proposalRepo ?? makeProposalRepo(),
    overrides.quoteRepo ?? makeQuoteRepo(),
    overrides.transactionRepo ?? makeTransactionRepo(),
    overrides.outboxRepo ?? makeOutboxRepo(),
    overrides.settlementRepo ?? makeSettlementRepo(),
    (overrides.quotesService as unknown as QuotesService) ??
      (makeQuotesService() as unknown as QuotesService),
    (overrides.kycGate as unknown as KycGateService) ??
      (makeKycGate() as unknown as KycGateService),
    (overrides.directiveService as unknown as DirectiveService) ??
      (makeDirectiveService() as unknown as DirectiveService),
    (overrides.pinService as unknown as PinService) ??
      (makePinService() as unknown as PinService),
    (overrides.walletService as unknown as WalletService) ??
      (makeWalletService() as unknown as WalletService),
    (overrides.paymentProvider as unknown as IPaymentProvider) ??
      (makePaymentProvider() as unknown as IPaymentProvider),
    (overrides.config as unknown as EffectiveConfigService) ??
      (stubConfig as unknown as EffectiveConfigService),
    stubClock,
    overrides.assetRegistry ?? makeAssetRegistry(),
    // beneficiaryService stub (sell tests override via buildSellService helper)
    { getById: jest.fn().mockResolvedValue(null) } as never,
    // ledgerRepo stub
    {
      getAccountBalance: jest.fn().mockResolvedValue('100'),
      listLedgerEntries: jest.fn().mockResolvedValue([]),
      listByTransaction: jest.fn().mockResolvedValue([]),
      getAccountHistory: jest.fn().mockResolvedValue([]),
      verifyTransactionIntegrity: jest
        .fn()
        .mockResolvedValue({ balanced: true, legCount: 0, brokenAt: null }),
      listGlobal: jest.fn(),
      verifyGlobalSequenceIntegrity: jest.fn(),
    },
    // identityService: optional, buy path does not notify
    undefined,
    // whatsAppSender: optional, buy path does not notify
    undefined,
    // complianceService: buy path has no sanctions gate; executeSend not called
    undefined,
  );
}

const BASE_INPUT = {
  userId: USER_ID,
  proposalId: PROPOSAL_ID,
  directiveId: DIRECTIVE_ID,
  nonce: NONCE,
  pin: PIN,
  idempotencyKey: IDEMPOTENCY_KEY,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExecutionService.executeBuy', () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it('happy path: creates Transaction (settling), consumes directive, verifies PIN, provisions wallet, creates collection, enqueues outbox, returns payment VA', async () => {
    const proposalRepo = makeProposalRepo();
    const quoteRepo = makeQuoteRepo();
    const transactionRepo = makeTransactionRepo();
    const outboxRepo = makeOutboxRepo();
    const directiveService = makeDirectiveService();
    const pinService = makePinService();
    const walletService = makeWalletService();
    const paymentProvider = makePaymentProvider();

    const svc = buildService({
      proposalRepo,
      quoteRepo,
      transactionRepo,
      outboxRepo,
      directiveService,
      pinService,
      walletService,
      paymentProvider,
    });

    const result = await svc.executeBuy(BASE_INPUT);

    // Returns correct shape.
    expect(result.transactionId).toBe(TXN_ID);
    expect(result.status).toBe('settling');
    expect(result.payment.accountNumber).toBe(STUB_COLLECTION.accountNumber);
    expect(result.payment.bankName).toBe(STUB_COLLECTION.bankName);
    expect(result.payment.providerRef).toBe(STUB_COLLECTION.providerRef);
    expect(result.payment.amount).toBe('10000');
    expect(result.payment.currency).toBe('NGN');

    // Directive was consumed.
    expect(directiveService.consume).toHaveBeenCalledTimes(1);
    expect(directiveService.consume).toHaveBeenCalledWith({
      directiveId: DIRECTIVE_ID,
      nonce: NONCE,
      proposalId: PROPOSAL_ID,
    });

    // PIN was verified.
    expect(pinService.verifyPin).toHaveBeenCalledWith(USER_ID, PIN);

    // Transaction + Proposal update must be atomic (C1): createSettlingWithProposal called.
    expect(transactionRepo.createSettlingWithProposal).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const expectedTxnData = expect.objectContaining({
      type: 'buy',
      status: 'settling',
      userId: USER_ID,
      proposalId: PROPOSAL_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      pinVerifiedAt: FIXED_NOW,
    });
    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    expect(transactionRepo.createSettlingWithProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: PROPOSAL_ID,
        confirmedAt: FIXED_NOW,
        txnData: expectedTxnData,
      }),
    );
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    // The separate create + proposalRepo.updateStatus calls must NOT be made (C1).
    expect(transactionRepo.create).not.toHaveBeenCalled();
    expect(proposalRepo.updateStatus).not.toHaveBeenCalled();

    // VA details persisted after createCollection (C2).
    expect(transactionRepo.mergeMetadata).toHaveBeenCalledWith(
      TXN_ID,
      expect.objectContaining({
        accountNumber: STUB_COLLECTION.accountNumber,
        bankName: STUB_COLLECTION.bankName,
        providerRef: STUB_COLLECTION.providerRef,
      }),
    );

    // Wallet was provisioned via per-network method with network from registry (WN-2).
    expect(walletService.getOrProvisionNetworkWallet).toHaveBeenCalledWith(
      USER_ID,
      'TRON',
    );

    // Collection was created.
    expect(paymentProvider.createCollection).toHaveBeenCalledTimes(1);
    expect(paymentProvider.createCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '10000',
        currency: 'NGN',
        reference: IDEMPOTENCY_KEY,
      }),
    );

    // Outbox was enqueued.
    expect(outboxRepo.create).toHaveBeenCalledTimes(1);
    expect(outboxRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: TXN_ID,
        settlementType: 'processor_collection',
        status: 'pending',
      }),
    );
  });

  // ── Customer attribution on the collection (real KYC identity) ────────────

  it('threads the real KYC firstName/lastName/email into createCollection.customer', async () => {
    const kycGate = makeKycGate();
    kycGate.getOriginatorIdentity.mockResolvedValue({
      firstName: 'Adaeze',
      lastName: 'Okonkwo',
      email: 'adaeze@example.com',
    });
    const paymentProvider = makePaymentProvider();

    const svc = buildService({ kycGate, paymentProvider });
    await svc.executeBuy(BASE_INPUT);

    // Originator identity is resolved for the transacting user.
    expect(kycGate.getOriginatorIdentity).toHaveBeenCalledWith(USER_ID);

    // The real KYC name + verified email reach the payment provider — not the
    // "Handshake User" / synthetic-email placeholders.
    expect(paymentProvider.createCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: {
          firstname: 'Adaeze',
          lastname: 'Okonkwo',
          email: 'adaeze@example.com',
        },
      }),
    );
  });

  it('falls back to safe placeholders when the KYC name/email are null', async () => {
    // makeKycGate defaults getOriginatorIdentity to all-null.
    const paymentProvider = makePaymentProvider();

    const svc = buildService({ paymentProvider });
    await svc.executeBuy(BASE_INPUT);

    expect(paymentProvider.createCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: {
          firstname: 'Handshake',
          lastname: 'User',
          email: `user+${USER_ID}@handshake.internal`,
        },
      }),
    );
  });

  // ── Velocity increment passed to atomic write (V1 — §3.3 gap fix) ──────────

  it('passes velocityIncrement (fiatAmountStr + now) to createSettlingWithProposal so counters are written atomically (V1)', async () => {
    const transactionRepo = makeTransactionRepo();

    const svc = buildService({ transactionRepo });
    await svc.executeBuy(BASE_INPUT);

    // The atomic write must include velocityIncrement with the correct fields.
    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    expect(transactionRepo.createSettlingWithProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        velocityIncrement: expect.objectContaining({
          userId: USER_ID,
          fiatAmountStr: STORED_QUOTE.fiatAmount, // '10000'
          now: FIXED_NOW,
        }),
      }),
    );
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
  });

  it('does NOT pass velocityIncrement on idempotent replay (no counter double-write)', async () => {
    // On replay the engine returns early after the findByIdempotencyKey hit.
    const existingTxn: TransactionRecord = { ...STUB_TXN, status: 'settling' };
    const transactionRepo = makeTransactionRepo(existingTxn);

    const svc = buildService({ transactionRepo });
    await svc.executeBuy(BASE_INPUT);

    // createSettlingWithProposal must NOT be called on replay.
    expect(transactionRepo.createSettlingWithProposal).not.toHaveBeenCalled();
  });

  it('asserts directive + PIN are called BEFORE atomic Transaction+Proposal write (security-critical order)', async () => {
    const callOrder: string[] = [];

    const directiveService = {
      consume: jest.fn().mockImplementation(() => {
        callOrder.push('directive');
        return Promise.resolve(STUB_GRANT);
      }),
    };
    const pinService = {
      verifyPin: jest.fn().mockImplementation(() => {
        callOrder.push('pin');
        return Promise.resolve();
      }),
    };
    const transactionRepo = {
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(STUB_TXN),
      createSettlingWithProposal: jest.fn().mockImplementation(() => {
        callOrder.push('create_txn');
        return Promise.resolve(STUB_TXN);
      }),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      mergeMetadata: jest.fn().mockResolvedValue(undefined),
      listByUserInRange: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      findByUserId: jest.fn().mockResolvedValue([]),
    };

    const svc = buildService({
      directiveService: directiveService as unknown as jest.Mocked<
        Pick<DirectiveService, 'consume'>
      >,
      pinService: pinService as unknown as jest.Mocked<
        Pick<PinService, 'verifyPin'>
      >,
      transactionRepo:
        transactionRepo as unknown as jest.Mocked<ITransactionRepository>,
    });

    await svc.executeBuy(BASE_INPUT);

    // Directive and PIN must both come before Transaction creation.
    expect(callOrder.indexOf('directive')).toBeLessThan(
      callOrder.indexOf('create_txn'),
    );
    expect(callOrder.indexOf('pin')).toBeLessThan(
      callOrder.indexOf('create_txn'),
    );
    // I5: PIN comes BEFORE the directive is consumed — a wrong PIN must not burn
    // the single-use directive.
    expect(callOrder.indexOf('pin')).toBeLessThan(
      callOrder.indexOf('directive'),
    );
  });

  it('asserts idempotency check happens AFTER auth and BEFORE atomic write', async () => {
    const callOrder: string[] = [];

    const directiveService = {
      consume: jest.fn().mockImplementation(() => {
        callOrder.push('directive');
        return Promise.resolve(STUB_GRANT);
      }),
    };
    const pinService = {
      verifyPin: jest.fn().mockImplementation(() => {
        callOrder.push('pin');
        return Promise.resolve();
      }),
    };
    const transactionRepo = {
      findByIdempotencyKey: jest.fn().mockImplementation(() => {
        callOrder.push('idempotency_check');
        return Promise.resolve(null);
      }),
      create: jest.fn().mockResolvedValue(STUB_TXN),
      createSettlingWithProposal: jest.fn().mockImplementation(() => {
        callOrder.push('create_txn');
        return Promise.resolve(STUB_TXN);
      }),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      mergeMetadata: jest.fn().mockResolvedValue(undefined),
      listByUserInRange: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      findByUserId: jest.fn().mockResolvedValue([]),
    };

    const svc = buildService({
      directiveService: directiveService as unknown as jest.Mocked<
        Pick<DirectiveService, 'consume'>
      >,
      pinService: pinService as unknown as jest.Mocked<
        Pick<PinService, 'verifyPin'>
      >,
      transactionRepo:
        transactionRepo as unknown as jest.Mocked<ITransactionRepository>,
    });

    await svc.executeBuy(BASE_INPUT);

    expect(callOrder.indexOf('pin')).toBeLessThan(
      callOrder.indexOf('idempotency_check'),
    );
    expect(callOrder.indexOf('idempotency_check')).toBeLessThan(
      callOrder.indexOf('create_txn'),
    );
  });

  // ── Expired proposal ──────────────────────────────────────────────────────

  it('expired proposal → ProposalExpiredError; no Transaction created', async () => {
    const expired = { ...STUB_PROPOSAL, expiresAt: PAST };
    const transactionRepo = makeTransactionRepo();

    const svc = buildService({
      proposalRepo: makeProposalRepo(expired),
      transactionRepo,
    });

    await expect(svc.executeBuy(BASE_INPUT)).rejects.toBeInstanceOf(
      ProposalExpiredError,
    );
    expect(transactionRepo.createSettlingWithProposal).not.toHaveBeenCalled();
  });

  // ── Wrong owner ───────────────────────────────────────────────────────────

  it('wrong owner → ProposalNotExecutableError; no Transaction created', async () => {
    const wrongOwner = { ...STUB_PROPOSAL, userId: OTHER_USER_ID };
    const transactionRepo = makeTransactionRepo();

    const svc = buildService({
      proposalRepo: makeProposalRepo(wrongOwner),
      transactionRepo,
    });

    await expect(svc.executeBuy(BASE_INPUT)).rejects.toBeInstanceOf(
      ProposalNotExecutableError,
    );
    expect(transactionRepo.createSettlingWithProposal).not.toHaveBeenCalled();
  });

  // ── Bad status ────────────────────────────────────────────────────────────

  it('bad status (executing) → ProposalNotExecutableError; no Transaction created', async () => {
    const executing: ProposalRecord = { ...STUB_PROPOSAL, status: 'executing' };
    const transactionRepo = makeTransactionRepo();

    const svc = buildService({
      proposalRepo: makeProposalRepo(executing),
      transactionRepo,
    });

    await expect(svc.executeBuy(BASE_INPUT)).rejects.toBeInstanceOf(
      ProposalNotExecutableError,
    );
    expect(transactionRepo.createSettlingWithProposal).not.toHaveBeenCalled();
  });

  it('bad status (failed) → ProposalNotExecutableError', async () => {
    const failed: ProposalRecord = { ...STUB_PROPOSAL, status: 'failed' };
    const svc = buildService({ proposalRepo: makeProposalRepo(failed) });
    await expect(svc.executeBuy(BASE_INPUT)).rejects.toBeInstanceOf(
      ProposalNotExecutableError,
    );
  });

  it('proposal not found → ProposalNotExecutableError', async () => {
    const svc = buildService({ proposalRepo: makeProposalRepo(null) });
    await expect(svc.executeBuy(BASE_INPUT)).rejects.toBeInstanceOf(
      ProposalNotExecutableError,
    );
  });

  // ── Drift exceeded ────────────────────────────────────────────────────────

  it('drift exceeded → QuoteDriftError; no Transaction created', async () => {
    // Stored rate: 1600. Fresh rate: 1700. Drift = |100/1600| * 10000 = 625 bps > 50.
    const highDriftQuote: QuoteBuyOutput = {
      ...FRESH_QUOTE,
      fxRate: '1700',
    };
    const transactionRepo = makeTransactionRepo();

    const svc = buildService({
      quotesService: makeQuotesService(highDriftQuote),
      transactionRepo,
    });

    await expect(svc.executeBuy(BASE_INPUT)).rejects.toBeInstanceOf(
      QuoteDriftError,
    );
    expect(transactionRepo.createSettlingWithProposal).not.toHaveBeenCalled();
  });

  it('drift within tolerance (0 bps) → succeeds', async () => {
    // Same rate → 0 drift.
    const svc = buildService({
      quotesService: makeQuotesService(FRESH_QUOTE),
    });
    const result = await svc.executeBuy(BASE_INPUT);
    expect(result.status).toBe('settling');
  });

  it('honors a DB AppSetting override of buy.maxDriftBps (EffectiveConfigService flows through the engine)', async () => {
    // Stored rate 1600, fresh rate 1601 → drift ≈ 6.25 bps.
    // Base config (50 bps) would ACCEPT this. An admin override tightening
    // buy.maxDriftBps to 1 bp must make the SAME drift throw QuoteDriftError,
    // proving the override flows through the engine's constructor read.
    const smallDriftQuote: QuoteBuyOutput = { ...FRESH_QUOTE, fxRate: '1601' };
    const transactionRepo = makeTransactionRepo();

    const svc = buildService({
      quotesService: makeQuotesService(smallDriftQuote),
      transactionRepo,
      config: makeStubConfig({
        buyMaxDriftBps: 1,
      }) as unknown as EffectiveConfigService,
    });

    await expect(svc.executeBuy(BASE_INPUT)).rejects.toBeInstanceOf(
      QuoteDriftError,
    );
    expect(transactionRepo.createSettlingWithProposal).not.toHaveBeenCalled();
  });

  // ── KYC gate throws ───────────────────────────────────────────────────────

  it('KYC gate throws → propagates; no Transaction created', async () => {
    const gateError = new Error('KYC_NOT_VERIFIED');
    const transactionRepo = makeTransactionRepo();

    const svc = buildService({
      kycGate: makeKycGate(gateError),
      transactionRepo,
    });

    await expect(svc.executeBuy(BASE_INPUT)).rejects.toThrow(
      'KYC_NOT_VERIFIED',
    );
    expect(transactionRepo.createSettlingWithProposal).not.toHaveBeenCalled();
  });

  // ── Directive consume throws (replay) ─────────────────────────────────────

  it('directive consume throws replay → DirectiveReplayError propagates; no Transaction (replay protection intact after I5 reorder)', async () => {
    const replayError = new DirectiveReplayError();
    const pinService = makePinService();
    const transactionRepo = makeTransactionRepo();

    const svc = buildService({
      directiveService: makeDirectiveService(replayError),
      pinService,
      transactionRepo,
    });

    await expect(svc.executeBuy(BASE_INPUT)).rejects.toBeInstanceOf(
      DirectiveReplayError,
    );
    // I5 reorder: PIN is now verified BEFORE the directive consume, so PIN IS
    // checked here — but a replayed directive is still rejected at consume and
    // NO transaction is created. Single-use replay protection is fully intact.
    expect(pinService.verifyPin).toHaveBeenCalledTimes(1);
    expect(transactionRepo.createSettlingWithProposal).not.toHaveBeenCalled();
  });

  // ── PIN invalid ───────────────────────────────────────────────────────────

  it('I5: wrong PIN propagates WITHOUT consuming the one-shot directive (legitimate retry survives); no collection/outbox', async () => {
    const pinError = new PinInvalidError(4);
    const paymentProvider = makePaymentProvider();
    const outboxRepo = makeOutboxRepo();
    const transactionRepo = makeTransactionRepo();
    const directiveService = makeDirectiveService();

    const svc = buildService({
      pinService: makePinService(pinError),
      paymentProvider,
      outboxRepo,
      transactionRepo,
      directiveService,
    });

    await expect(svc.executeBuy(BASE_INPUT)).rejects.toBeInstanceOf(
      PinInvalidError,
    );
    // I5: PIN is verified BEFORE the directive is consumed, so a wrong-PIN typo
    // must NOT burn the single-use directive — the user can retry the SAME
    // directive instead of being forced to re-authorize from scratch.
    expect(directiveService.consume).not.toHaveBeenCalled();
    expect(paymentProvider.createCollection).not.toHaveBeenCalled();
    expect(outboxRepo.create).not.toHaveBeenCalled();
    expect(transactionRepo.createSettlingWithProposal).not.toHaveBeenCalled();
  });

  // ── Payment provider failure (graceful mapping) ───────────────────────────

  it('createCollection failure → ProviderUnavailableError (mapped to a clear error, not a raw 500)', async () => {
    // The real Flutterwave adapter throws a descriptive Error on a non-2xx /
    // network failure. The engine must translate ANY such failure into a typed
    // ProviderUnavailableError so the chat surface returns a clear message
    // instead of leaking an opaque 500.
    const providerError = new Error(
      'Flutterwave createCollection error (HTTP 503): service unavailable',
    );
    const paymentProvider = makePaymentProvider(providerError);

    const svc = buildService({ paymentProvider });

    await expect(svc.executeBuy(BASE_INPUT)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it('createCollection failure → marks the Transaction failed (no zombie settling buy), no outbox row, re-throws', async () => {
    // FUNDS-SAFETY (§3.1): the buy reserve posts NO ledger entry (the user pays
    // NGN later), so a createCollection failure means no funds moved. But the
    // settling Transaction + consumed proposal/velocity are committed at Step 7.
    // Leaving it 'settling' with no VA is a zombie buy the user can never pay for
    // and the reconciler cannot act on (no outbox row). The engine must mark the
    // Transaction failed so the idempotent-replay path does not return an empty
    // payment block. No reserve refund is needed (the buy never debited the user).
    const providerError = new Error(
      'Flutterwave createCollection error (HTTP 503): service unavailable',
    );
    const paymentProvider = makePaymentProvider(providerError);
    const transactionRepo = makeTransactionRepo();
    const outboxRepo = makeOutboxRepo();

    const svc = buildService({ paymentProvider, transactionRepo, outboxRepo });

    await expect(svc.executeBuy(BASE_INPUT)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );

    // Transaction marked failed so it is not a zombie 'settling' buy.
    expect(transactionRepo.updateStatus).toHaveBeenCalledTimes(1);
    const [failedId, failedStatus, failedFields] =
      transactionRepo.updateStatus.mock.calls[0];
    expect(failedId).toBe(TXN_ID);
    expect(failedStatus).toBe('failed');
    expect(failedFields?.failedAt).toBeInstanceOf(Date);
    // No VA was persisted and no outbox row was enqueued.
    expect(transactionRepo.mergeMetadata).not.toHaveBeenCalled();
    expect(outboxRepo.create).not.toHaveBeenCalled();
  });

  // ── Idempotent replay ─────────────────────────────────────────────────────

  it('idempotent replay → returns existing transactionId; createCollection NOT called', async () => {
    const existingTxn: TransactionRecord = {
      ...STUB_TXN,
      status: 'settling',
    };
    const paymentProvider = makePaymentProvider();
    const outboxRepo = makeOutboxRepo();
    const transactionRepo = makeTransactionRepo(existingTxn);

    const svc = buildService({ transactionRepo, paymentProvider, outboxRepo });

    const result = await svc.executeBuy(BASE_INPUT);

    expect(result.transactionId).toBe(TXN_ID);
    expect(result.status).toBe('settling');
    // No new collection or outbox.
    expect(paymentProvider.createCollection).not.toHaveBeenCalled();
    expect(outboxRepo.create).not.toHaveBeenCalled();
    expect(transactionRepo.createSettlingWithProposal).not.toHaveBeenCalled();
  });

  it('idempotent replay with completed status → returns status=completed', async () => {
    const completedTxn: TransactionRecord = {
      ...STUB_TXN,
      status: 'completed',
    };
    const svc = buildService({
      transactionRepo: makeTransactionRepo(completedTxn),
    });
    const result = await svc.executeBuy(BASE_INPUT);
    expect(result.status).toBe('completed');
  });

  // ── Directive ref not request_pin ─────────────────────────────────────────

  it('directive ref is not request_pin → ProposalNotExecutableError; no Transaction', async () => {
    const wrongRefGrant: DirectiveGrantRecord = {
      ...STUB_GRANT,
      directiveRef: 'show_confirmation',
    };
    const transactionRepo = makeTransactionRepo();

    const svc = buildService({
      directiveService: makeDirectiveService(wrongRefGrant),
      transactionRepo,
    });

    await expect(svc.executeBuy(BASE_INPUT)).rejects.toBeInstanceOf(
      ProposalNotExecutableError,
    );
    expect(transactionRepo.createSettlingWithProposal).not.toHaveBeenCalled();
  });

  // ── Task 5: fiatCurrency threaded from quote (not hardcoded 'NGN') ──────────

  it('uses the quote fiatCurrency for the collection and result, not a literal', async () => {
    const paymentProvider = makePaymentProvider();
    const settlementRepo = makeSettlementRepo();

    const svc = buildService({ paymentProvider, settlementRepo });

    const res = await svc.executeBuy(BASE_INPUT);

    // Result currency must come from the stored quote (STORED_QUOTE.fiatCurrency = 'NGN').
    expect(res.payment.currency).toBe('NGN');

    // createCollection must be called with the quote's fiatCurrency, not a literal.
    expect(paymentProvider.createCollection).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'NGN' }),
    );

    // settleBuyAtomic is only called during settleBuyPayment, not executeBuy —
    // the real regression guard is in the settleBuyPayment suite below.
  });

  // ── Idempotent replay returns non-empty VA details (C2) ───────────────────

  it('idempotent replay returns populated VA details (accountNumber/bankName/providerRef) from metadata', async () => {
    // The existing Transaction already has VA details in its metadata (as persisted
    // by mergeMetadata after createCollection on the first execution).
    const existingTxnWithVA: TransactionRecord = {
      ...STUB_TXN,
      status: 'settling',
      metadata: {
        asset: 'USDT',
        fiatAmount: '10000',
        fiatCurrency: 'NGN',
        // VA details merged in after first createCollection (C2).
        accountNumber: STUB_COLLECTION.accountNumber,
        bankName: STUB_COLLECTION.bankName,
        providerRef: STUB_COLLECTION.providerRef,
      },
    };

    const paymentProvider = makePaymentProvider();
    const outboxRepo = makeOutboxRepo();
    const transactionRepo = makeTransactionRepo(existingTxnWithVA);

    const svc = buildService({ transactionRepo, paymentProvider, outboxRepo });

    const result = await svc.executeBuy(BASE_INPUT);

    // transactionId and status must match.
    expect(result.transactionId).toBe(TXN_ID);
    expect(result.status).toBe('settling');

    // VA details must be populated — not empty strings (C2).
    expect(result.payment.accountNumber).toBe(STUB_COLLECTION.accountNumber);
    expect(result.payment.bankName).toBe(STUB_COLLECTION.bankName);
    expect(result.payment.providerRef).toBe(STUB_COLLECTION.providerRef);

    // No duplicate side effects.
    expect(paymentProvider.createCollection).not.toHaveBeenCalled();
    expect(outboxRepo.create).not.toHaveBeenCalled();
    expect(transactionRepo.createSettlingWithProposal).not.toHaveBeenCalled();
    expect(transactionRepo.mergeMetadata).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// settleBuyPayment tests (Task 4.5b)
// ---------------------------------------------------------------------------

const SETTLING_TXN: TransactionRecord = {
  ...STUB_TXN,
  status: 'settling',
  metadata: {
    asset: 'USDT',
    fiatAmount: '10000',
    fiatCurrency: 'NGN',
    cryptoAmount: '6.123456',
    processingFeeAmount: '100.00',
  },
};

const COMPLETED_TXN: TransactionRecord = {
  ...STUB_TXN,
  status: 'completed',
  metadata: {
    asset: 'USDT',
    fiatAmount: '10000',
    fiatCurrency: 'NGN',
    cryptoAmount: '6.123456',
    processingFeeAmount: '100.00',
  },
};

const WALLET_RECORD = {
  id: 'wallet-uuid-001',
  userId: USER_ID,
  asset: 'USDT',
  network: 'TRON',
  address: 'TTestAddress123',
  providerReference: 'blockradar-ref-001',
  status: 'active',
};

function makeWalletServiceWithId(): jest.Mocked<
  Pick<WalletService, 'getOrProvisionNetworkWallet'>
> {
  return {
    getOrProvisionNetworkWallet: jest.fn().mockResolvedValue(WALLET_RECORD),
  };
}

// Stub that also returns a transactionId on findByIdempotencyKey
function makeTransactionRepoForSettle(
  txn: TransactionRecord | null = SETTLING_TXN,
): jest.Mocked<ITransactionRepository> {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByIdempotencyKey: jest.fn().mockResolvedValue(txn),
    create: jest.fn().mockResolvedValue(SETTLING_TXN),
    createSettlingWithProposal: jest.fn().mockResolvedValue(SETTLING_TXN),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    mergeMetadata: jest.fn().mockResolvedValue(undefined),
    listByUserInRange: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    findByUserId: jest.fn().mockResolvedValue([]),
    listAll: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listByStatus: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  };
}

describe('ExecutionService.settleBuyPayment', () => {
  const SETTLE_INPUT = { reference: IDEMPOTENCY_KEY };

  // ── Happy path ────────────────────────────────────────────────────────────

  it('happy path: verify successful → calls settleBuyAtomic, returns completed + receiptNumber', async () => {
    const transactionRepo = makeTransactionRepoForSettle(SETTLING_TXN);
    const settlementRepo = makeSettlementRepo(null, {
      receiptNumber: STUB_RECEIPT_NUMBER,
    });
    const walletService = makeWalletServiceWithId();
    const paymentProvider = makePaymentProvider();

    const svc = buildService({
      transactionRepo,
      settlementRepo,
      walletService,
      paymentProvider,
    });

    const result = await svc.settleBuyPayment(SETTLE_INPUT);

    expect(result.transactionId).toBe(TXN_ID);
    expect(result.status).toBe('completed');
    expect(result.receiptNumber).toBe(STUB_RECEIPT_NUMBER);

    // verify was called with the reference.
    expect(paymentProvider.verify).toHaveBeenCalledWith(IDEMPOTENCY_KEY);

    // wallet provisioned via per-network method with network from registry (WN-2).
    expect(walletService.getOrProvisionNetworkWallet).toHaveBeenCalledWith(
      USER_ID,
      'TRON',
    );

    // atomic settle was called.
    expect(settlementRepo.settleBuyAtomic).toHaveBeenCalledTimes(1);
    expect(settlementRepo.settleBuyAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: TXN_ID,
        userId: USER_ID,
        walletId: WALLET_RECORD.id,
        fiatAmount: '10000',
        cryptoAmount: '6.123456',
      }),
    );
  });

  // ── Already completed → idempotent return ─────────────────────────────────

  it('already completed → returns existing receiptNumber, settleBuyAtomic NOT called', async () => {
    const transactionRepo = makeTransactionRepoForSettle(COMPLETED_TXN);
    const settlementRepo = makeSettlementRepo(STUB_RECEIPT_NUMBER);
    const paymentProvider = makePaymentProvider();

    const svc = buildService({
      transactionRepo,
      settlementRepo,
      paymentProvider,
    });

    const result = await svc.settleBuyPayment(SETTLE_INPUT);

    expect(result.transactionId).toBe(TXN_ID);
    expect(result.status).toBe('completed');
    expect(result.receiptNumber).toBe(STUB_RECEIPT_NUMBER);

    // No re-credit.
    expect(settlementRepo.settleBuyAtomic).not.toHaveBeenCalled();
    // No provider verify on idempotent path.
    expect(paymentProvider.verify).not.toHaveBeenCalled();
  });

  // ── Task 5: settleBuyAtomic receives fiatCurrency from metadata ──────────────

  it('settleBuyAtomic is called with fiatCurrency read from transaction metadata (not hardcoded NGN)', async () => {
    const transactionRepo = makeTransactionRepoForSettle(SETTLING_TXN);
    const settlementRepo = makeSettlementRepo(null, {
      receiptNumber: STUB_RECEIPT_NUMBER,
    });
    const walletService = makeWalletServiceWithId();
    const paymentProvider = makePaymentProvider();

    const svc = buildService({
      transactionRepo,
      settlementRepo,
      walletService,
      paymentProvider,
    });

    await svc.settleBuyPayment(SETTLE_INPUT);

    // fiatCurrency must be threaded from meta.fiatCurrency (SETTLING_TXN.metadata.fiatCurrency = 'NGN').
    expect(settlementRepo.settleBuyAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ fiatCurrency: 'NGN' }),
    );
  });

  // ── Provider verify not successful → return pending ───────────────────────

  it('provider verify returns pending → returns pending, settleBuyAtomic NOT called', async () => {
    const transactionRepo = makeTransactionRepoForSettle(SETTLING_TXN);
    const settlementRepo = makeSettlementRepo();
    const paymentProvider = makePaymentProvider(undefined, {
      status: 'pending',
      amount: '10000',
      currency: 'NGN',
      providerRef: 'flw_ref_001',
    });

    const svc = buildService({
      transactionRepo,
      settlementRepo,
      paymentProvider,
    });

    const result = await svc.settleBuyPayment(SETTLE_INPUT);

    expect(result.transactionId).toBe(TXN_ID);
    expect(result.status).toBe('pending');
    expect(result.receiptNumber).toBeUndefined();
    expect(settlementRepo.settleBuyAtomic).not.toHaveBeenCalled();
  });

  // ── Amount mismatch → return pending ─────────────────────────────────────

  it('provider verify: amount mismatch → returns pending, no settle', async () => {
    const transactionRepo = makeTransactionRepoForSettle(SETTLING_TXN);
    const settlementRepo = makeSettlementRepo();
    const paymentProvider = makePaymentProvider(undefined, {
      status: 'successful',
      amount: '5000', // less than 10000
      currency: 'NGN',
      providerRef: 'flw_ref_001',
    });

    const svc = buildService({
      transactionRepo,
      settlementRepo,
      paymentProvider,
    });

    const result = await svc.settleBuyPayment(SETTLE_INPUT);

    expect(result.status).toBe('pending');
    expect(settlementRepo.settleBuyAtomic).not.toHaveBeenCalled();
  });

  // ── Currency mismatch → return pending ───────────────────────────────────

  it('provider verify: currency mismatch → returns pending, no settle', async () => {
    const transactionRepo = makeTransactionRepoForSettle(SETTLING_TXN);
    const settlementRepo = makeSettlementRepo();
    const paymentProvider = makePaymentProvider(undefined, {
      status: 'successful',
      amount: '10000',
      currency: 'USD', // wrong currency
      providerRef: 'flw_ref_001',
    });

    const svc = buildService({
      transactionRepo,
      settlementRepo,
      paymentProvider,
    });

    const result = await svc.settleBuyPayment(SETTLE_INPUT);

    expect(result.status).toBe('pending');
    expect(settlementRepo.settleBuyAtomic).not.toHaveBeenCalled();
  });

  // ── Unknown reference → throws ────────────────────────────────────────────

  it('unknown reference → throws ProposalNotExecutableError', async () => {
    const transactionRepo = makeTransactionRepoForSettle(null);

    const svc = buildService({ transactionRepo });

    await expect(svc.settleBuyPayment(SETTLE_INPUT)).rejects.toBeInstanceOf(
      ProposalNotExecutableError,
    );
  });

  // ── Invalid status (not settling / completed) → throws ───────────────────

  it('transaction status is failed → throws SettlementInvalidStatusError', async () => {
    const failedTxn: TransactionRecord = { ...SETTLING_TXN, status: 'failed' };
    const transactionRepo = makeTransactionRepoForSettle(failedTxn);

    const svc = buildService({ transactionRepo });

    await expect(svc.settleBuyPayment(SETTLE_INPUT)).rejects.toBeInstanceOf(
      SettlementInvalidStatusError,
    );
  });
});

// =============================================================================
// ExecutionService.executeSell (task S4b)
// =============================================================================

const SELL_PROPOSAL_ID = 'sell-proposal-id';
const SELL_QUOTE_ID = 'sell-quote-id';
const SELL_TXN_ID = 'sell-txn-id';
const SELL_IDEMPOTENCY_KEY = 'sell-idempotency-key';
const BENEFICIARY_ID = 'beneficiary-id';
const PROVIDER_REF = 'flw_transfer_001';

const STORED_SELL_QUOTE: QuoteRecord = {
  id: SELL_QUOTE_ID,
  userId: USER_ID,
  type: 'sell',
  asset: 'USDT',
  fiatCurrency: 'NGN',
  fiatAmount: '24600', // net NGN the user receives
  cryptoAmount: '16.000000', // USDT the user is selling
  fxRate: '1600',
  baseRate: '1600',
  spreadBps: 150,
  processingFeeBps: 100,
  processingFeeAmount: '0',
  status: 'valid',
  expiresAt: FUTURE,
  createdAt: FIXED_NOW,
};

const FRESH_SELL_QUOTE: QuoteSellOutput = {
  asset: 'USDT',
  cryptoAmount: '16.000000',
  fiatCurrency: 'NGN',
  netFiatAmount: '24600',
  baseRate: '1600',
  fxRate: '1600', // same rate → no drift
  spreadBps: 150,
  processingFeeBps: 100,
  processingFeeAmount: '0',
  quotedAt: FIXED_NOW.toISOString(),
  expiresInSec: 30,
};

const STUB_SELL_PROPOSAL: ProposalRecord = {
  id: SELL_PROPOSAL_ID,
  userId: USER_ID,
  conversationId: null,
  type: 'sell',
  status: 'pending',
  parameters: {
    asset: 'USDT',
    cryptoAmount: '16.000000',
    fiatCurrency: 'NGN',
    beneficiaryId: BENEFICIARY_ID,
  },
  parametersChecksum: 'b'.repeat(64),
  quoteId: SELL_QUOTE_ID,
  expiresAt: FUTURE,
  confirmedAt: null,
  createdAt: FIXED_NOW,
};

const STUB_SELL_GRANT: DirectiveGrantRecord = {
  directiveId: DIRECTIVE_ID,
  proposalId: SELL_PROPOSAL_ID,
  userId: USER_ID,
  directiveRef: 'request_pin',
  origin: 'engine',
  nonceHash: 'hash',
  signatureValue: 'sig',
  status: 'consumed',
  issuedAt: FIXED_NOW,
  expiresAt: FUTURE,
  consumedAt: FIXED_NOW,
  consumedProposalId: SELL_PROPOSAL_ID,
  failureReason: null,
  failureCount: 0,
};

const STUB_SELL_TXN: TransactionRecord = {
  id: SELL_TXN_ID,
  proposalId: SELL_PROPOSAL_ID,
  userId: USER_ID,
  type: 'sell',
  status: 'settling',
  idempotencyKey: SELL_IDEMPOTENCY_KEY,
  requestChecksum: 'sell-checksum',
  fxRateSnapshot: '1600',
  metadata: {
    asset: 'USDT',
    cryptoAmount: '16.000000',
    netFiatAmount: '24600',
    fiatCurrency: 'NGN',
    // BUG 2 — velocity contribution persisted at reserve, read back on refund.
    velocityFiatAmount: '24600',
    velocityFiatCurrency: 'NGN',
    beneficiaryId: BENEFICIARY_ID,
    walletId: 'wallet-id',
    providerRef: PROVIDER_REF,
  },
  processorTxRef: null,
  onChainTxHash: null,
  failureReason: null,
  pinVerifiedAt: FIXED_NOW,
  createdAt: FIXED_NOW,
  executedAt: null,
  completedAt: null,
  failedAt: null,
};

const STUB_BENEFICIARY = {
  id: BENEFICIARY_ID,
  userId: USER_ID,
  type: 'bank_account' as const,
  label: 'My Bank',
  accountNumber: '0123456789',
  accountHolderName: 'Test User',
  bankCode: '044',
  address: null,
  network: null,
  isDefault: false,
  createdAt: FIXED_NOW,
};

const SELL_BASE_INPUT = {
  userId: USER_ID,
  proposalId: SELL_PROPOSAL_ID,
  directiveId: DIRECTIVE_ID,
  nonce: NONCE,
  pin: PIN,
  idempotencyKey: SELL_IDEMPOTENCY_KEY,
};

/**
 * Builds a QuotesService stub that handles both quoteBuy and quoteSell.
 */
function makeSellQuotesService(
  freshSellQuote: QuoteSellOutput = FRESH_SELL_QUOTE,
): jest.Mocked<Pick<QuotesService, 'quoteBuy' | 'quoteSell'>> {
  return {
    quoteBuy: jest.fn().mockResolvedValue(FRESH_QUOTE),
    quoteSell: jest.fn().mockResolvedValue(freshSellQuote),
  };
}

/**
 * Builds a BeneficiaryService stub.
 */
function makeBeneficiaryService(
  result: typeof STUB_BENEFICIARY | null = STUB_BENEFICIARY,
): { getById: jest.Mock } {
  return {
    getById: jest.fn().mockResolvedValue(result),
  };
}

/**
 * Builds a LedgerRepository stub with sufficient balance by default.
 */
function makeLedgerRepo(balance: string = '100'): {
  getAccountBalance: jest.Mock;
  listLedgerEntries: jest.Mock;
  listByTransaction: jest.Mock;
  getAccountHistory: jest.Mock;
  verifyTransactionIntegrity: jest.Mock;
  listGlobal: jest.Mock;
  verifyGlobalSequenceIntegrity: jest.Mock;
} {
  return {
    getAccountBalance: jest.fn().mockResolvedValue(balance),
    listLedgerEntries: jest.fn().mockResolvedValue([]),
    listByTransaction: jest.fn().mockResolvedValue([]),
    getAccountHistory: jest.fn().mockResolvedValue([]),
    verifyTransactionIntegrity: jest
      .fn()
      .mockResolvedValue({ balanced: true, legCount: 0, brokenAt: null }),
    listGlobal: jest.fn(),
    verifyGlobalSequenceIntegrity: jest.fn(),
  };
}

/**
 * Builds a PaymentProvider stub that handles createPayout and verifyPayout
 * in addition to buy-side methods.
 */
function makeSellPaymentProvider(
  payoutThrows?: Error,
  verifyPayoutResult?: {
    status: 'successful' | 'pending' | 'failed';
    amount: string;
    currency: string;
    providerRef: string;
  },
): jest.Mocked<
  Pick<
    IPaymentProvider,
    'createCollection' | 'verify' | 'createPayout' | 'verifyPayout'
  >
> {
  const svc = {
    createCollection: jest.fn().mockResolvedValue(STUB_COLLECTION),
    verify: jest.fn().mockResolvedValue({
      status: 'successful',
      amount: '10000',
      currency: 'NGN',
      providerRef: 'flw_ref_001',
    }),
    createPayout: jest.fn(),
    verifyPayout: jest.fn(),
  };

  if (payoutThrows) {
    svc.createPayout.mockRejectedValue(payoutThrows);
  } else {
    svc.createPayout.mockResolvedValue({
      providerRef: PROVIDER_REF,
      status: 'pending' as const,
    });
  }

  svc.verifyPayout.mockResolvedValue(
    verifyPayoutResult ?? {
      status: 'successful' as const,
      amount: '24600',
      currency: 'NGN',
      providerRef: PROVIDER_REF,
    },
  );

  return svc;
}

/** A IdentityService stub that returns a WhatsApp address. */
function makeIdentityService(waAddress: string | null = '+2349000000001'): {
  findWhatsAppAddress: jest.Mock;
} {
  return { findWhatsAppAddress: jest.fn().mockResolvedValue(waAddress) };
}

/** A IWhatsAppSender stub. */
function makeWhatsAppSender(): { sendText: jest.Mock } {
  return {
    sendText: jest.fn().mockResolvedValue({ externalMessageId: 'wamid.test' }),
  };
}

/** A SessionService stub (Fix G). Records step-up silently; resolve device succeeds. */
function makeSessionService(
  opts: { pinnedDeviceId?: string | null } = {},
): jest.Mocked<
  Pick<SessionService, 'startOrTouch' | 'recordStepUp' | 'assertStepUpFresh'>
> & { findPinnedDeviceId: jest.Mock } {
  // When opts.pinnedDeviceId is explicitly null → no bound device → return null.
  // When opts.pinnedDeviceId is undefined → not specified → fall back to stub.
  const resolvedPinnedDeviceId =
    'pinnedDeviceId' in opts ? opts.pinnedDeviceId : 'device-id-stub';
  return {
    startOrTouch: jest.fn().mockResolvedValue({ id: 'session-id' }),
    recordStepUp: jest.fn().mockResolvedValue(undefined),
    assertStepUpFresh: jest.fn().mockResolvedValue(undefined),
    // Used internally by executeSend to resolve the bound device.
    findPinnedDeviceId: jest.fn().mockResolvedValue(resolvedPinnedDeviceId),
  };
}

/**
 * Builds ExecutionService with sell-specific stubs.
 * Overrides the default buildService factory to inject sell deps.
 */
function buildSellService(
  overrides: {
    proposalRepo?: jest.Mocked<IProposalRepository>;
    quoteRepo?: jest.Mocked<IQuoteRepository>;
    transactionRepo?: jest.Mocked<ITransactionRepository>;
    outboxRepo?: jest.Mocked<ISettlementOutboxRepository>;
    settlementRepo?: jest.Mocked<ISettlementRepository>;
    quotesService?: jest.Mocked<Pick<QuotesService, 'quoteBuy' | 'quoteSell'>>;
    kycGate?: jest.Mocked<Pick<KycGateService, 'assertCanTransact'>>;
    directiveService?: jest.Mocked<Pick<DirectiveService, 'consume'>>;
    pinService?: jest.Mocked<Pick<PinService, 'verifyPin'>>;
    walletService?: jest.Mocked<
      Pick<WalletService, 'getOrProvisionNetworkWallet'>
    >;
    paymentProvider?: ReturnType<typeof makeSellPaymentProvider>;
    beneficiaryService?: ReturnType<typeof makeBeneficiaryService>;
    ledgerRepo?: ReturnType<typeof makeLedgerRepo>;
    identityService?: ReturnType<typeof makeIdentityService>;
    whatsAppSender?: ReturnType<typeof makeWhatsAppSender>;
  } = {},
): ExecutionService {
  return new ExecutionService(
    overrides.proposalRepo ?? makeProposalRepo(STUB_SELL_PROPOSAL),
    overrides.quoteRepo ?? makeQuoteRepo(STORED_SELL_QUOTE),
    overrides.transactionRepo ?? makeTransactionRepo(null, STUB_SELL_TXN),
    overrides.outboxRepo ?? makeOutboxRepo(),
    // Default sell settlement repo uses STUB_SELL_TXN for the atomic create.
    overrides.settlementRepo ??
      makeSettlementRepo(
        null,
        { receiptNumber: STUB_RECEIPT_NUMBER },
        STUB_SELL_TXN,
      ),
    (overrides.quotesService as unknown as QuotesService) ??
      (makeSellQuotesService() as unknown as QuotesService),
    (overrides.kycGate as unknown as KycGateService) ??
      (makeKycGate() as unknown as KycGateService),
    (overrides.directiveService as unknown as DirectiveService) ??
      (makeDirectiveService(STUB_SELL_GRANT) as unknown as DirectiveService),
    (overrides.pinService as unknown as PinService) ??
      (makePinService() as unknown as PinService),
    (overrides.walletService as unknown as WalletService) ??
      (makeWalletService() as unknown as WalletService),
    (overrides.paymentProvider as unknown as IPaymentProvider) ??
      (makeSellPaymentProvider() as unknown as IPaymentProvider),
    stubConfig as never,
    stubClock,
    makeAssetRegistry(),
    (overrides.beneficiaryService as never) ??
      (makeBeneficiaryService() as never),
    (overrides.ledgerRepo as never) ?? makeLedgerRepo(),
    (overrides.identityService as never) ?? (makeIdentityService() as never),
    (overrides.whatsAppSender as never) ?? (makeWhatsAppSender() as never),
    // complianceService: sell path has no sanctions gate; executeSend not called
    undefined,
    // sessionService: sell path does not use step-up session recording
    undefined,
  );
}

describe('ExecutionService.executeSell', () => {
  // ── Happy path ──────────────────────────────────────────────────────────────

  it('happy path: creates Transaction (settling), reserves USDT atomically, initiates payout, enqueues outbox', async () => {
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      STUB_SELL_TXN,
    );
    const outboxRepo = makeOutboxRepo();
    const paymentProvider = makeSellPaymentProvider();

    const svc = buildSellService({
      settlementRepo,
      outboxRepo,
      paymentProvider,
    });

    const result = await svc.executeSell(SELL_BASE_INPUT);

    expect(result.status).toBe('settling');
    expect(result.transactionId).toBe(SELL_TXN_ID);
    expect(result.payout.providerRef).toBe(PROVIDER_REF);

    // C1 fix: only the atomic combined method must be called (not the two-step pattern).
    expect(
      settlementRepo.createSellSettlingWithReserveAtomic,
    ).toHaveBeenCalledTimes(1);
    // The old separate calls must NOT be made.
    expect(settlementRepo.postSellReserveAtomic).not.toHaveBeenCalled();
    expect(paymentProvider.createPayout).toHaveBeenCalledTimes(1);
    expect(outboxRepo.create).toHaveBeenCalledTimes(1);
  });

  // ── Deterministic providerRef in atomic metadata (crash-safety) ────────────

  it('includes providerRef: idempotencyKey in atomic metadata write so settleSellPayout can verify without post-write mergeMetadata', async () => {
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      STUB_SELL_TXN,
    );
    const paymentProvider = makeSellPaymentProvider();

    const svc = buildSellService({ settlementRepo, paymentProvider });

    await svc.executeSell(SELL_BASE_INPUT);

    // The atomic write must include providerRef: idempotencyKey in txnData.metadata
    // so that if the process crashes after the write but before mergeMetadata,
    // settleSellPayout can still call verifyPayout(reference) correctly.
    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    expect(
      settlementRepo.createSellSettlingWithReserveAtomic,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        txnData: expect.objectContaining({
          metadata: expect.objectContaining({
            providerRef: SELL_IDEMPOTENCY_KEY,
          }),
        }),
      }),
    );
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
  });

  // ── BUG 2: velocity contribution persisted to metadata for later reversal ──

  it('persists velocityFiatAmount + velocityFiatCurrency in atomic metadata so a later refund can reverse the daily-spend it consumed', async () => {
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      STUB_SELL_TXN,
    );
    const paymentProvider = makeSellPaymentProvider();

    const svc = buildSellService({ settlementRepo, paymentProvider });

    await svc.executeSell(SELL_BASE_INPUT);

    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    expect(
      settlementRepo.createSellSettlingWithReserveAtomic,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        txnData: expect.objectContaining({
          metadata: expect.objectContaining({
            velocityFiatAmount: expect.any(String),
            velocityFiatCurrency: 'NGN',
          }),
        }),
      }),
    );
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
  });

  // ── Proposal not found ─────────────────────────────────────────────────────

  it('proposal not found → ProposalNotExecutableError, no Transaction', async () => {
    const proposalRepo = makeProposalRepo(null);
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      STUB_SELL_TXN,
    );

    const svc = buildSellService({ proposalRepo, settlementRepo });

    await expect(svc.executeSell(SELL_BASE_INPUT)).rejects.toBeInstanceOf(
      ProposalNotExecutableError,
    );
    expect(
      settlementRepo.createSellSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
  });

  // ── Wrong owner ────────────────────────────────────────────────────────────

  it('userId mismatch → ProposalNotExecutableError', async () => {
    const otherProposal: ProposalRecord = {
      ...STUB_SELL_PROPOSAL,
      userId: OTHER_USER_ID,
    };
    const proposalRepo = makeProposalRepo(otherProposal);

    const svc = buildSellService({ proposalRepo });

    await expect(svc.executeSell(SELL_BASE_INPUT)).rejects.toBeInstanceOf(
      ProposalNotExecutableError,
    );
  });

  // ── Wrong proposal type ────────────────────────────────────────────────────

  it('proposal type is buy → ProposalNotExecutableError', async () => {
    const buyProposal: ProposalRecord = {
      ...STUB_SELL_PROPOSAL,
      type: 'buy',
    };
    const proposalRepo = makeProposalRepo(buyProposal);

    const svc = buildSellService({ proposalRepo });

    await expect(svc.executeSell(SELL_BASE_INPUT)).rejects.toBeInstanceOf(
      ProposalNotExecutableError,
    );
  });

  // ── Expired proposal ───────────────────────────────────────────────────────

  it('expired proposal → ProposalExpiredError', async () => {
    const expired: ProposalRecord = {
      ...STUB_SELL_PROPOSAL,
      expiresAt: PAST,
    };
    const proposalRepo = makeProposalRepo(expired);

    const svc = buildSellService({ proposalRepo });

    await expect(svc.executeSell(SELL_BASE_INPUT)).rejects.toBeInstanceOf(
      ProposalExpiredError,
    );
  });

  // ── Quote drift exceeded ───────────────────────────────────────────────────

  it('FX rate drifted beyond maxDriftBps → QuoteDriftError, no Transaction', async () => {
    // Fresh rate is 10% higher than stored → 1000 bps > 50 bps
    const driftedFreshQuote: QuoteSellOutput = {
      ...FRESH_SELL_QUOTE,
      fxRate: '1760', // +10%
    };
    const quotesService = makeSellQuotesService(driftedFreshQuote);
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      STUB_SELL_TXN,
    );

    const svc = buildSellService({ quotesService, settlementRepo });

    await expect(svc.executeSell(SELL_BASE_INPUT)).rejects.toBeInstanceOf(
      QuoteDriftError,
    );
    expect(
      settlementRepo.createSellSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
  });

  // ── Insufficient balance ───────────────────────────────────────────────────

  it('ledger balance < cryptoAmount → InsufficientBalanceError, no Transaction; directiveService NOT called', async () => {
    // STORED_SELL_QUOTE.cryptoAmount = '16.000000'
    // Ledger balance is only 1 USDT
    const ledgerRepo = makeLedgerRepo('1.000000');
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      STUB_SELL_TXN,
    );
    const directiveService = makeDirectiveService(STUB_SELL_GRANT);

    const svc = buildSellService({
      ledgerRepo,
      settlementRepo,
      directiveService,
    });

    await expect(svc.executeSell(SELL_BASE_INPUT)).rejects.toBeInstanceOf(
      InsufficientBalanceError,
    );
    expect(
      settlementRepo.createSellSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
    // Balance check gates directive consumption — directive must NOT be called on insufficient balance.
    expect(directiveService.consume).not.toHaveBeenCalled();
  });

  // ── KYC gate throws ───────────────────────────────────────────────────────

  it('KYC gate throws → propagates, no Transaction', async () => {
    const kycError = new Error('KYC tier 1 exceeded');
    const kycGate = makeKycGate(kycError);
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      STUB_SELL_TXN,
    );

    const svc = buildSellService({ kycGate, settlementRepo });

    await expect(svc.executeSell(SELL_BASE_INPUT)).rejects.toThrow(kycError);
    expect(
      settlementRepo.createSellSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
  });

  // ── Directive replay ─────────────────────────────────────────────────────

  it('directive already consumed → DirectiveReplayError, no Transaction', async () => {
    const directiveService = makeDirectiveService(new DirectiveReplayError());
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      STUB_SELL_TXN,
    );
    const pinService = makePinService();

    const svc = buildSellService({
      directiveService,
      settlementRepo,
      pinService,
    });

    await expect(svc.executeSell(SELL_BASE_INPUT)).rejects.toBeInstanceOf(
      DirectiveReplayError,
    );
    expect(
      settlementRepo.createSellSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
    // I5 reorder: PIN is verified before the directive consume, so PIN IS checked
    // here — but the replayed directive is still rejected and no Transaction is
    // created. Replay protection is intact.
    expect(pinService.verifyPin).toHaveBeenCalledTimes(1);
  });

  // ── PIN invalid ───────────────────────────────────────────────────────────

  it('I5: wrong PIN propagates WITHOUT consuming the one-shot directive (legitimate retry survives); no collection/outbox', async () => {
    const pinService = makePinService(new PinInvalidError(4));
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      STUB_SELL_TXN,
    );
    const outboxRepo = makeOutboxRepo();
    const directiveService = makeDirectiveService(STUB_SELL_GRANT);

    const svc = buildSellService({
      pinService,
      settlementRepo,
      outboxRepo,
      directiveService,
    });

    await expect(svc.executeSell(SELL_BASE_INPUT)).rejects.toBeInstanceOf(
      PinInvalidError,
    );
    // I5: PIN before directive consume — a wrong PIN must not burn the directive.
    expect(directiveService.consume).not.toHaveBeenCalled();
    expect(
      settlementRepo.createSellSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
    expect(outboxRepo.create).not.toHaveBeenCalled();
  });

  // ── Idempotent replay ─────────────────────────────────────────────────────

  it('idempotent replay: returns existing result, no new side-effects', async () => {
    const transactionRepo = makeTransactionRepo(STUB_SELL_TXN);
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      STUB_SELL_TXN,
    );
    const paymentProvider = makeSellPaymentProvider();

    const svc = buildSellService({
      transactionRepo,
      settlementRepo,
      paymentProvider,
    });

    const result = await svc.executeSell(SELL_BASE_INPUT);

    expect(result.transactionId).toBe(SELL_TXN_ID);
    expect(result.status).toBe('settling');
    expect(
      settlementRepo.createSellSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
    expect(settlementRepo.postSellReserveAtomic).not.toHaveBeenCalled();
    expect(paymentProvider.createPayout).not.toHaveBeenCalled();
  });

  // ── Missing beneficiary ───────────────────────────────────────────────────

  it('beneficiaryId not found → ProposalNotExecutableError', async () => {
    const beneficiaryService = makeBeneficiaryService(null);
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      STUB_SELL_TXN,
    );

    const svc = buildSellService({ beneficiaryService, settlementRepo });

    await expect(svc.executeSell(SELL_BASE_INPUT)).rejects.toBeInstanceOf(
      ProposalNotExecutableError,
    );
    expect(
      settlementRepo.createSellSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
  });

  // ── Wrong beneficiary type ────────────────────────────────────────────────

  it('beneficiary type is crypto_address → ProposalNotExecutableError', async () => {
    const cryptoBeneficiary = {
      ...STUB_BENEFICIARY,
      type: 'crypto_address' as const,
      accountNumber: null,
      bankCode: null,
    };
    const beneficiaryService = makeBeneficiaryService(
      cryptoBeneficiary as never,
    );
    const svc = buildSellService({ beneficiaryService });

    await expect(svc.executeSell(SELL_BASE_INPUT)).rejects.toBeInstanceOf(
      ProposalNotExecutableError,
    );
  });

  // ── Gauntlet order: balance → directive → pin → idempotency → atomic create ──

  it('asserts balance-check → pin.verify → directive.consume → idempotency → atomic create, in order (I5: PIN before directive)', async () => {
    const callOrder: string[] = [];

    const ledgerRepo = {
      getAccountBalance: jest.fn().mockImplementation(() => {
        callOrder.push('balance_check');
        return Promise.resolve('100');
      }),
      listLedgerEntries: jest.fn().mockResolvedValue([]),
      listByTransaction: jest.fn().mockResolvedValue([]),
      getAccountHistory: jest.fn().mockResolvedValue([]),
      verifyTransactionIntegrity: jest
        .fn()
        .mockResolvedValue({ balanced: true, legCount: 0, brokenAt: null }),
      listGlobal: jest.fn(),
      verifyGlobalSequenceIntegrity: jest.fn(),
    };
    const directiveService = {
      consume: jest.fn().mockImplementation(() => {
        callOrder.push('directive');
        return Promise.resolve(STUB_SELL_GRANT);
      }),
    };
    const pinService = {
      verifyPin: jest.fn().mockImplementation(() => {
        callOrder.push('pin');
        return Promise.resolve();
      }),
    };
    const transactionRepo = {
      findByIdempotencyKey: jest.fn().mockImplementation(() => {
        callOrder.push('idempotency');
        return Promise.resolve(null);
      }),
      create: jest.fn().mockResolvedValue(STUB_SELL_TXN),
      createSettlingWithProposal: jest.fn().mockResolvedValue(STUB_SELL_TXN),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      mergeMetadata: jest.fn().mockResolvedValue(undefined),
      listByUserInRange: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      findByUserId: jest.fn().mockResolvedValue([]),
    };
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      STUB_SELL_TXN,
    );
    settlementRepo.createSellSettlingWithReserveAtomic = jest
      .fn()
      .mockImplementation(() => {
        callOrder.push('atomic_create');
        return Promise.resolve({ txn: STUB_SELL_TXN });
      });

    const svc = buildSellService({
      ledgerRepo: ledgerRepo,
      directiveService: directiveService as unknown as jest.Mocked<
        Pick<DirectiveService, 'consume'>
      >,
      pinService: pinService as unknown as jest.Mocked<
        Pick<PinService, 'verifyPin'>
      >,
      transactionRepo:
        transactionRepo as unknown as jest.Mocked<ITransactionRepository>,
      settlementRepo,
    });

    await svc.executeSell(SELL_BASE_INPUT);

    expect(callOrder.indexOf('balance_check')).toBeLessThan(
      callOrder.indexOf('pin'),
    );
    // I5: PIN is verified before the directive is consumed.
    expect(callOrder.indexOf('pin')).toBeLessThan(
      callOrder.indexOf('directive'),
    );
    // Directive is still consumed before the idempotency check.
    expect(callOrder.indexOf('directive')).toBeLessThan(
      callOrder.indexOf('idempotency'),
    );
    expect(callOrder.indexOf('idempotency')).toBeLessThan(
      callOrder.indexOf('atomic_create'),
    );
  });

  // ── FUNDS-SAFETY: synchronous createPayout rejection (§3.1) ─────────────────
  // The USDT reserve (Step 9, user_wallet → clearing) is committed BEFORE the
  // fiat payout is initiated (Step 10). When createPayout throws synchronously
  // the engine must compensate ONLY on a DEFINITIVE rejection (HTTP 4xx — the
  // payout request was rejected and NEVER processed). On an AMBIGUOUS failure
  // (5xx / timeout / no status) the transfer MIGHT be in flight, so refunding
  // would risk a double-payout — those are left 'settling' for the reconciler.

  it('createPayout rejected with a definitive 4xx → refunds the reserve, no outbox row, re-throws', async () => {
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      STUB_SELL_TXN,
    );
    const outboxRepo = makeOutboxRepo();
    // Mirrors the processor adapter on a 422 "invalid bank account": a definitive
    // client rejection that was NEVER processed/disbursed.
    const paymentProvider = makeSellPaymentProvider(
      Object.assign(
        new Error('Flutterwave createPayout error (HTTP 422): invalid account'),
        { httpStatus: 422 },
      ),
    );

    const svc = buildSellService({
      settlementRepo,
      outboxRepo,
      paymentProvider,
    });

    await expect(svc.executeSell(SELL_BASE_INPUT)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );

    // The reserve must be refunded (clearing → user_wallet) and the tx marked failed.
    expect(settlementRepo.settleSellRefundAtomic).toHaveBeenCalledTimes(1);
    expect(settlementRepo.settleSellRefundAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: SELL_TXN_ID,
        userId: USER_ID,
        walletId: 'wallet-id',
        cryptoAmount: '16.000000',
        asset: 'USDT',
      }),
    );
    // No processor_payout outbox row — the payout never happened.
    expect(outboxRepo.create).not.toHaveBeenCalled();
  });

  it('createPayout fails with an ambiguous 5xx → leaves tx settling (NO refund), no outbox row, re-throws', async () => {
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      STUB_SELL_TXN,
    );
    const outboxRepo = makeOutboxRepo();
    const paymentProvider = makeSellPaymentProvider(
      Object.assign(
        new Error('Flutterwave createPayout error (HTTP 503): upstream down'),
        { httpStatus: 503 },
      ),
    );

    const svc = buildSellService({
      settlementRepo,
      outboxRepo,
      paymentProvider,
    });

    await expect(svc.executeSell(SELL_BASE_INPUT)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );

    // Ambiguous — the payout may be in flight; refunding risks a double-payout.
    expect(settlementRepo.settleSellRefundAtomic).not.toHaveBeenCalled();
    expect(outboxRepo.create).not.toHaveBeenCalled();
  });

  it('createPayout fails with a network error (no HTTP status) → leaves tx settling (NO refund), re-throws', async () => {
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      STUB_SELL_TXN,
    );
    const paymentProvider = makeSellPaymentProvider(
      new Error('socket hang up'),
    );

    const svc = buildSellService({ settlementRepo, paymentProvider });

    await expect(svc.executeSell(SELL_BASE_INPUT)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );

    // No HTTP status → ambiguous → never refund.
    expect(settlementRepo.settleSellRefundAtomic).not.toHaveBeenCalled();
  });
});

// =============================================================================
// ExecutionService.settleSellPayout (task S4b)
// =============================================================================

const SETTLING_SELL_TXN: TransactionRecord = {
  ...STUB_SELL_TXN,
  status: 'settling',
};

const SETTLE_SELL_INPUT = { reference: SELL_IDEMPOTENCY_KEY };

/**
 * Transaction repo for settle tests that uses findByIdempotencyKey
 * (same pattern as the buy settlement tests above).
 */
function makeTransactionRepoForSellSettle(
  txn: TransactionRecord | null,
): jest.Mocked<ITransactionRepository> {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByIdempotencyKey: jest.fn().mockResolvedValue(txn),
    create: jest.fn(),
    createSettlingWithProposal: jest.fn(),
    updateStatus: jest.fn(),
    mergeMetadata: jest.fn().mockResolvedValue(undefined),
    listByUserInRange: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    findByUserId: jest.fn().mockResolvedValue([]),
    listAll: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listByStatus: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  };
}

describe('ExecutionService.settleSellPayout', () => {
  // ── verifyPayout uses reference directly (not meta.providerRef) ────────────

  it('calls verifyPayout with the incoming reference directly (not meta.providerRef) to eliminate the crash-window race', async () => {
    // Transaction has an EMPTY providerRef in metadata to simulate a crash between
    // the atomic write and the subsequent mergeMetadata call.
    const crashWindowTxn: TransactionRecord = {
      ...SETTLING_SELL_TXN,
      metadata: {
        ...STUB_SELL_TXN.metadata,
        // Simulate: providerRef not yet written by post-payout mergeMetadata.
        providerRef: '',
      },
    };
    const transactionRepo = makeTransactionRepoForSellSettle(crashWindowTxn);
    const paymentProvider = makeSellPaymentProvider(undefined, {
      status: 'successful',
      amount: '24600',
      currency: 'NGN',
      providerRef: PROVIDER_REF,
    });

    const svc = buildSellService({ transactionRepo, paymentProvider });

    const result = await svc.settleSellPayout(SETTLE_SELL_INPUT);

    // Must succeed even with empty meta.providerRef because the reference
    // (= SELL_IDEMPOTENCY_KEY) is used directly for verifyPayout.
    expect(result.status).toBe('completed');
    // verifyPayout must be called with the incoming reference, NOT meta.providerRef.
    expect(paymentProvider.verifyPayout).toHaveBeenCalledWith(
      SELL_IDEMPOTENCY_KEY,
    );
    // Ensure verifyPayout was NOT called with empty string (the crash-window fallback).
    expect(paymentProvider.verifyPayout).not.toHaveBeenCalledWith('');
  });

  // ── Happy path: payout successful → finalize ──────────────────────────────

  it('payout successful → calls settleSellFinalizeAtomic, returns completed', async () => {
    const transactionRepo = makeTransactionRepoForSellSettle(SETTLING_SELL_TXN);
    const settlementRepo = makeSettlementRepo();
    const paymentProvider = makeSellPaymentProvider(undefined, {
      status: 'successful',
      amount: '24600',
      currency: 'NGN',
      providerRef: PROVIDER_REF,
    });

    const svc = buildSellService({
      transactionRepo,
      settlementRepo,
      paymentProvider,
    });

    const result = await svc.settleSellPayout(SETTLE_SELL_INPUT);

    expect(result.status).toBe('completed');
    expect(result.receiptNumber).toBe(STUB_RECEIPT_NUMBER);
    expect(settlementRepo.settleSellFinalizeAtomic).toHaveBeenCalledTimes(1);
    expect(settlementRepo.settleSellRefundAtomic).not.toHaveBeenCalled();
  });

  // ── Task 6: fiatCurrency threads into settleSellFinalizeAtomic (not hardcoded) ──

  it('settleSellFinalizeAtomic receives fiatCurrency threaded from transaction metadata, not a hardcoded default', async () => {
    // Use a NON-NGN currency so the assertion would FAIL if the code reverted
    // to a hardcoded 'NGN' default (the regression this guards against).
    const ghsTxn: TransactionRecord = {
      ...SETTLING_SELL_TXN,
      metadata: {
        ...SETTLING_SELL_TXN.metadata,
        fiatCurrency: 'GHS',
      },
    };
    const transactionRepo = makeTransactionRepoForSellSettle(ghsTxn);
    const settlementRepo = makeSettlementRepo();
    const paymentProvider = makeSellPaymentProvider(undefined, {
      status: 'successful',
      amount: '24600',
      currency: 'GHS',
      providerRef: PROVIDER_REF,
    });

    const svc = buildSellService({
      transactionRepo,
      settlementRepo,
      paymentProvider,
    });

    await svc.settleSellPayout(SETTLE_SELL_INPUT);

    expect(settlementRepo.settleSellFinalizeAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ fiatCurrency: 'GHS' }),
    );
  });

  // ── Payout pending ────────────────────────────────────────────────────────

  it('payout still pending → returns pending, no settle or refund', async () => {
    const transactionRepo = makeTransactionRepoForSellSettle(SETTLING_SELL_TXN);
    const settlementRepo = makeSettlementRepo();
    const paymentProvider = makeSellPaymentProvider(undefined, {
      status: 'pending',
      amount: '24600',
      currency: 'NGN',
      providerRef: PROVIDER_REF,
    });

    const svc = buildSellService({
      transactionRepo,
      settlementRepo,
      paymentProvider,
    });

    const result = await svc.settleSellPayout(SETTLE_SELL_INPUT);

    expect(result.status).toBe('pending');
    expect(settlementRepo.settleSellFinalizeAtomic).not.toHaveBeenCalled();
    expect(settlementRepo.settleSellRefundAtomic).not.toHaveBeenCalled();
  });

  // ── Payout failed → refund ────────────────────────────────────────────────

  it('payout failed → calls settleSellRefundAtomic, returns failed', async () => {
    const transactionRepo = makeTransactionRepoForSellSettle(SETTLING_SELL_TXN);
    const settlementRepo = makeSettlementRepo();
    const paymentProvider = makeSellPaymentProvider(undefined, {
      status: 'failed',
      amount: '0',
      currency: 'NGN',
      providerRef: PROVIDER_REF,
    });

    const svc = buildSellService({
      transactionRepo,
      settlementRepo,
      paymentProvider,
    });

    const result = await svc.settleSellPayout(SETTLE_SELL_INPUT);

    expect(result.status).toBe('failed');
    expect(settlementRepo.settleSellRefundAtomic).toHaveBeenCalledTimes(1);
    expect(settlementRepo.settleSellFinalizeAtomic).not.toHaveBeenCalled();

    // BUG 2 — the refund reverses the velocity this sell consumed at reserve,
    // using the exact amount/currency persisted in metadata.
    expect(settlementRepo.settleSellRefundAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest objectContaining matcher is typed `any`
        velocityReversal: expect.objectContaining({
          userId: USER_ID,
          fiatCurrency: 'NGN',
          fiatAmountStr: '24600',
        }),
      }),
    );
  });

  // ── Idempotent: already completed ─────────────────────────────────────────

  it('transaction already completed → returns completed (idempotent), no finalize called', async () => {
    const completedTxn: TransactionRecord = {
      ...SETTLING_SELL_TXN,
      status: 'completed',
    };
    const transactionRepo = makeTransactionRepoForSellSettle(completedTxn);
    const settlementRepo = makeSettlementRepo(STUB_RECEIPT_NUMBER);
    const paymentProvider = makeSellPaymentProvider();

    const svc = buildSellService({
      transactionRepo,
      settlementRepo,
      paymentProvider,
    });

    const result = await svc.settleSellPayout(SETTLE_SELL_INPUT);

    expect(result.status).toBe('completed');
    expect(settlementRepo.settleSellFinalizeAtomic).not.toHaveBeenCalled();
    expect(paymentProvider.verifyPayout).not.toHaveBeenCalled();
  });

  // ── Unknown reference ─────────────────────────────────────────────────────

  it('unknown reference → ProposalNotExecutableError', async () => {
    const transactionRepo = makeTransactionRepoForSellSettle(null);

    const svc = buildSellService({ transactionRepo });

    await expect(
      svc.settleSellPayout(SETTLE_SELL_INPUT),
    ).rejects.toBeInstanceOf(ProposalNotExecutableError);
  });

  // ── Invalid status ────────────────────────────────────────────────────────

  it('transaction status is failed → throws SettlementInvalidStatusError', async () => {
    const failedTxn: TransactionRecord = {
      ...SETTLING_SELL_TXN,
      status: 'failed',
    };
    const transactionRepo = makeTransactionRepoForSellSettle(failedTxn);

    const svc = buildSellService({ transactionRepo });

    await expect(
      svc.settleSellPayout(SETTLE_SELL_INPUT),
    ).rejects.toBeInstanceOf(SettlementInvalidStatusError);
  });

  // ── Notify on success ─────────────────────────────────────────────────────

  it('payout successful → sends WhatsApp receipt to user WA address', async () => {
    const transactionRepo = makeTransactionRepoForSellSettle(SETTLING_SELL_TXN);
    const paymentProvider = makeSellPaymentProvider(undefined, {
      status: 'successful',
      amount: '24600',
      currency: 'NGN',
      providerRef: PROVIDER_REF,
    });
    const identityService = makeIdentityService('+2349000000099');
    const whatsAppSender = makeWhatsAppSender();

    const svc = buildSellService({
      transactionRepo,
      paymentProvider,
      identityService,
      whatsAppSender,
    });

    await svc.settleSellPayout(SETTLE_SELL_INPUT);

    expect(identityService.findWhatsAppAddress).toHaveBeenCalledWith(USER_ID);
    expect(whatsAppSender.sendText).toHaveBeenCalledWith(
      '+2349000000099',
      expect.stringContaining('sell is complete'),
    );
  });

  it('payout successful but findWhatsAppAddress throws → settlement still returns completed (notify swallowed)', async () => {
    const transactionRepo = makeTransactionRepoForSellSettle(SETTLING_SELL_TXN);
    const paymentProvider = makeSellPaymentProvider(undefined, {
      status: 'successful',
      amount: '24600',
      currency: 'NGN',
      providerRef: PROVIDER_REF,
    });
    const identityService = {
      findWhatsAppAddress: jest.fn().mockRejectedValue(new Error('DB down')),
    };

    const svc = buildSellService({
      transactionRepo,
      paymentProvider,
      identityService: identityService,
    });

    // Should not throw — notify error is swallowed.
    const result = await svc.settleSellPayout(SETTLE_SELL_INPUT);
    expect(result.status).toBe('completed');
  });

  // ── Notify on failure/refund ──────────────────────────────────────────────

  it('payout failed → sends WhatsApp refund notice to user WA address', async () => {
    const transactionRepo = makeTransactionRepoForSellSettle(SETTLING_SELL_TXN);
    const paymentProvider = makeSellPaymentProvider(undefined, {
      status: 'failed',
      amount: '0',
      currency: 'NGN',
      providerRef: PROVIDER_REF,
    });
    const identityService = makeIdentityService('+2349000000099');
    const whatsAppSender = makeWhatsAppSender();

    const svc = buildSellService({
      transactionRepo,
      paymentProvider,
      identityService,
      whatsAppSender,
    });

    await svc.settleSellPayout(SETTLE_SELL_INPUT);

    expect(identityService.findWhatsAppAddress).toHaveBeenCalledWith(USER_ID);
    expect(whatsAppSender.sendText).toHaveBeenCalledWith(
      '+2349000000099',
      expect.stringContaining('payout failed'),
    );
  });
});

// =============================================================================
// ExecutionService.executeSend (task N3b)
// =============================================================================

const SEND_PROPOSAL_ID = 'send-proposal-id';
const SEND_TXN_ID = 'send-txn-id';
const SEND_IDEMPOTENCY_KEY = 'send-idempotency-key';
const SEND_PROVIDER_REF = 'blockradar-send-ref-001';
const SEND_TO_ADDRESS = 'TValidTronAddress1234567890123456';

const STUB_SEND_PROPOSAL: ProposalRecord = {
  id: SEND_PROPOSAL_ID,
  userId: USER_ID,
  conversationId: null,
  type: 'send',
  status: 'pending',
  parameters: {
    asset: 'USDT',
    cryptoAmount: '10.000000',
    networkFeeCrypto: '1.000000',
    totalDebit: '11.000000',
    beneficiaryId: BENEFICIARY_ID,
    walletId: 'wallet-id',
    toAddress: SEND_TO_ADDRESS,
    network: 'TRON',
    requiresTravelRule: 'false',
  },
  parametersChecksum: 'c'.repeat(64),
  quoteId: null, // send proposals have NO quote
  expiresAt: FUTURE,
  confirmedAt: null,
  createdAt: FIXED_NOW,
};

const STUB_SEND_GRANT: DirectiveGrantRecord = {
  directiveId: DIRECTIVE_ID,
  proposalId: SEND_PROPOSAL_ID,
  userId: USER_ID,
  directiveRef: 'request_step_up', // send uses step-up, not request_pin
  origin: 'engine',
  nonceHash: 'hash',
  signatureValue: 'sig',
  status: 'consumed',
  issuedAt: FIXED_NOW,
  expiresAt: FUTURE,
  consumedAt: FIXED_NOW,
  consumedProposalId: SEND_PROPOSAL_ID,
  failureReason: null,
  failureCount: 0,
};

const STUB_SEND_TXN: TransactionRecord = {
  id: SEND_TXN_ID,
  proposalId: SEND_PROPOSAL_ID,
  userId: USER_ID,
  type: 'send',
  status: 'settling',
  idempotencyKey: SEND_IDEMPOTENCY_KEY,
  requestChecksum: 'send-checksum',
  fxRateSnapshot: null,
  metadata: {
    asset: 'USDT',
    cryptoAmount: '10.000000',
    networkFeeCrypto: '1.000000',
    totalDebit: '11.000000',
    beneficiaryId: BENEFICIARY_ID,
    walletId: 'wallet-id',
    toAddress: SEND_TO_ADDRESS,
    network: 'TRON',
    providerRef: SEND_PROVIDER_REF,
    // BUG 2 — velocity contribution persisted at reserve, read back on refund.
    velocityFiatAmount: '16000',
    velocityFiatCurrency: 'NGN',
  },
  processorTxRef: null,
  onChainTxHash: null,
  failureReason: null,
  pinVerifiedAt: FIXED_NOW,
  createdAt: FIXED_NOW,
  executedAt: null,
  completedAt: null,
  failedAt: null,
};

const STUB_CRYPTO_BENEFICIARY: BeneficiaryRecord = {
  id: BENEFICIARY_ID,
  userId: USER_ID,
  type: 'crypto_address',
  label: 'My TRON Wallet',
  accountNumber: null,
  accountHolderName: null,
  bankCode: null,
  payoutCurrency: null,
  bankCountry: null,
  cryptoAddress: SEND_TO_ADDRESS,
  cryptoAsset: 'USDT',
  cryptoNetwork: 'TRON',
  verificationStatus: 'verified',
  verifiedAt: FIXED_NOW,
  isDefault: false,
  firstUseLockedUntil: null, // past cooling-off by default
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
  deletedAt: null,
};

const SEND_BASE_INPUT = {
  userId: USER_ID,
  proposalId: SEND_PROPOSAL_ID,
  directiveId: DIRECTIVE_ID,
  nonce: NONCE,
  pin: PIN,
  idempotencyKey: SEND_IDEMPOTENCY_KEY,
};

function makeComplianceService(opts: { passed: boolean } = { passed: true }): {
  screenSendDestination: jest.Mock;
} {
  return {
    screenSendDestination: jest.fn().mockResolvedValue({
      passed: opts.passed,
      complianceEventId: 'compliance-event-id',
      ...(opts.passed ? {} : { reason: 'sanctioned address' }),
    }),
  };
}

function makeBeneficiaryServiceForSend(
  record: BeneficiaryRecord | null = STUB_CRYPTO_BENEFICIARY,
): { getById: jest.Mock } {
  return {
    getById: jest.fn().mockResolvedValue(record),
  };
}

function makeTransactionRepoForSend(
  existing: TransactionRecord | null = null,
  created: TransactionRecord = STUB_SEND_TXN,
): jest.Mocked<ITransactionRepository> {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByIdempotencyKey: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockResolvedValue(created),
    createSettlingWithProposal: jest.fn().mockResolvedValue(created),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    mergeMetadata: jest.fn().mockResolvedValue(undefined),
    listByUserInRange: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    findByUserId: jest.fn().mockResolvedValue([]),
    listAll: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listByStatus: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  };
}

function buildSendService(
  overrides: {
    proposalRepo?: jest.Mocked<IProposalRepository>;
    transactionRepo?: jest.Mocked<ITransactionRepository>;
    outboxRepo?: jest.Mocked<ISettlementOutboxRepository>;
    settlementRepo?: jest.Mocked<ISettlementRepository>;
    kycGate?: jest.Mocked<
      Pick<KycGateService, 'assertCanTransact' | 'getOriginatorName'>
    >;
    directiveService?: jest.Mocked<Pick<DirectiveService, 'consume'>>;
    pinService?: jest.Mocked<Pick<PinService, 'verifyPin'>>;
    walletService?: jest.Mocked<
      Pick<WalletService, 'getOrProvisionNetworkWallet' | 'withdraw'>
    >;
    beneficiaryService?: ReturnType<typeof makeBeneficiaryServiceForSend>;
    ledgerRepo?: ReturnType<typeof makeLedgerRepo>;
    identityService?: ReturnType<typeof makeIdentityService>;
    whatsAppSender?: ReturnType<typeof makeWhatsAppSender>;
    complianceService?: ReturnType<typeof makeComplianceService>;
    sessionService?: ReturnType<typeof makeSessionService>;
  } = {},
): ExecutionService {
  const defaultSettlementRepo = makeSettlementRepo(
    null,
    { receiptNumber: STUB_RECEIPT_NUMBER },
    undefined,
    STUB_SEND_TXN,
  );

  return new ExecutionService(
    overrides.proposalRepo ?? makeProposalRepo(STUB_SEND_PROPOSAL),
    // quoteRepo — not used by send
    makeQuoteRepo(null),
    overrides.transactionRepo ?? makeTransactionRepoForSend(),
    overrides.outboxRepo ?? makeOutboxRepo(),
    overrides.settlementRepo ?? defaultSettlementRepo,
    // quotesService — not used by send
    makeQuotesService() as unknown as QuotesService,
    (overrides.kycGate as unknown as KycGateService) ??
      (makeKycGate() as unknown as KycGateService),
    (overrides.directiveService as unknown as DirectiveService) ??
      (makeDirectiveService(STUB_SEND_GRANT) as unknown as DirectiveService),
    (overrides.pinService as unknown as PinService) ??
      (makePinService() as unknown as PinService),
    (overrides.walletService as unknown as WalletService) ??
      (makeWalletServiceWithWithdraw() as unknown as WalletService),
    // paymentProvider — not used by send
    makePaymentProvider() as unknown as IPaymentProvider,
    stubConfig as never,
    stubClock,
    makeAssetRegistry(),
    (overrides.beneficiaryService as never) ??
      (makeBeneficiaryServiceForSend() as never),
    (overrides.ledgerRepo as never) ?? makeLedgerRepo('100'),
    (overrides.identityService as never) ?? (makeIdentityService() as never),
    (overrides.whatsAppSender as never) ?? (makeWhatsAppSender() as never),
    (overrides.complianceService as never) ??
      (makeComplianceService() as never),
    (overrides.sessionService as never) ?? (makeSessionService() as never),
  );
}

describe('ExecutionService.executeSend', () => {
  // ── Happy path ──────────────────────────────────────────────────────────────

  it('happy path: creates Transaction(settling), reserves totalDebit atomically, calls walletService.withdraw, enqueues outbox(onchain_send)', async () => {
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );
    const outboxRepo = makeOutboxRepo();
    const walletService = makeWalletServiceWithWithdraw(SEND_PROVIDER_REF);
    const transactionRepo = makeTransactionRepoForSend();

    const svc = buildSendService({
      settlementRepo,
      outboxRepo,
      walletService,
      transactionRepo,
    });

    const result = await svc.executeSend(SEND_BASE_INPUT);

    expect(result.status).toBe('settling');
    expect(result.transactionId).toBe(SEND_TXN_ID);
    expect(result.onChain.providerRef).toBe(SEND_PROVIDER_REF);

    // Atomic combined create+reserve must be called
    expect(
      settlementRepo.createSendSettlingWithReserveAtomic,
    ).toHaveBeenCalledTimes(1);
    expect(
      settlementRepo.createSendSettlingWithReserveAtomic,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: 'wallet-id',
        totalDebit: '11.000000',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        txnData: expect.objectContaining({
          type: 'send',
          status: 'settling',
          userId: USER_ID,
          proposalId: SEND_PROPOSAL_ID,
        }),
      }),
    );

    // walletService.withdraw was called
    expect(walletService.withdraw).toHaveBeenCalledTimes(1);
    expect(walletService.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({ providerReference: 'blockradar-ref-001' }),
      SEND_TO_ADDRESS,
      '10.000000',
      expect.any(String), // assetId
      SEND_IDEMPOTENCY_KEY,
    );

    // Outbox enqueued with onchain_send
    expect(outboxRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: SEND_TXN_ID,
        settlementType: 'onchain_send',
        status: 'pending',
      }),
    );
  });

  // ── FUNDS-SAFETY: synchronous withdraw rejection (§3.1) ─────────────────────
  // The reserve (Step 10) is committed BEFORE walletService.withdraw (Step 11).
  // When withdraw throws synchronously, the engine must compensate ONLY when the
  // rejection is DEFINITIVE (HTTP 4xx — the request was rejected and NEVER
  // broadcast on-chain). For an AMBIGUOUS failure (5xx / timeout / no status) the
  // withdrawal MIGHT be in-flight, so refunding would risk a double-spend — those
  // are left 'settling' for the reconciler (current behaviour).

  it('withdraw rejected with a definitive 4xx → refunds the reserve, marks failed, no outbox row, re-throws', async () => {
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );
    const outboxRepo = makeOutboxRepo();
    const walletService = makeWalletServiceWithWithdraw();
    // Mirrors BlockradarProvider.wrapError on a 422 "Insufficient TRX balance":
    // a definitive client rejection that was NEVER broadcast on-chain.
    walletService.withdraw.mockRejectedValue(
      Object.assign(
        new Error(
          'Blockradar withdraw error (HTTP 422): Insufficient TRX balance',
        ),
        { httpStatus: 422 },
      ),
    );

    const svc = buildSendService({ settlementRepo, outboxRepo, walletService });

    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );

    // The reserve must be refunded (clearing → user_wallet) and the tx marked failed.
    expect(settlementRepo.settleSendRefundAtomic).toHaveBeenCalledTimes(1);
    expect(settlementRepo.settleSendRefundAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: SEND_TXN_ID,
        userId: USER_ID,
        walletId: 'wallet-id',
        totalDebit: '11.000000',
        asset: 'USDT',
      }),
    );
    // No onchain_send outbox row — the withdrawal never happened.
    expect(outboxRepo.create).not.toHaveBeenCalled();
  });

  it('withdraw fails with an ambiguous 5xx → leaves tx settling (NO refund), no outbox row, re-throws', async () => {
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );
    const outboxRepo = makeOutboxRepo();
    const walletService = makeWalletServiceWithWithdraw();
    walletService.withdraw.mockRejectedValue(
      Object.assign(
        new Error('Blockradar withdraw error (HTTP 503): upstream unavailable'),
        { httpStatus: 503 },
      ),
    );

    const svc = buildSendService({ settlementRepo, outboxRepo, walletService });

    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );

    // Ambiguous — the withdrawal may be in-flight; refunding risks a double-spend.
    expect(settlementRepo.settleSendRefundAtomic).not.toHaveBeenCalled();
    expect(outboxRepo.create).not.toHaveBeenCalled();
  });

  it('withdraw fails with a network error (no HTTP status) → leaves tx settling (NO refund), re-throws', async () => {
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );
    const walletService = makeWalletServiceWithWithdraw();
    walletService.withdraw.mockRejectedValue(new Error('socket hang up'));

    const svc = buildSendService({ settlementRepo, walletService });

    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );

    // No HTTP status → ambiguous → never refund.
    expect(settlementRepo.settleSendRefundAtomic).not.toHaveBeenCalled();
  });

  // ── Wrong proposal type ────────────────────────────────────────────────────

  it('proposal type is sell → ProposalNotExecutableError, no Transaction', async () => {
    const wrongTypeProposal: ProposalRecord = {
      ...STUB_SEND_PROPOSAL,
      type: 'sell',
    };
    const proposalRepo = makeProposalRepo(wrongTypeProposal);
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );

    const svc = buildSendService({ proposalRepo, settlementRepo });

    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toBeInstanceOf(
      ProposalNotExecutableError,
    );
    expect(
      settlementRepo.createSendSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
  });

  // ── Expired proposal ───────────────────────────────────────────────────────

  it('expired proposal → ProposalExpiredError, no Transaction', async () => {
    const expired: ProposalRecord = {
      ...STUB_SEND_PROPOSAL,
      expiresAt: PAST,
    };
    const proposalRepo = makeProposalRepo(expired);

    const svc = buildSendService({ proposalRepo });

    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toBeInstanceOf(
      ProposalExpiredError,
    );
  });

  // ── Insufficient balance ───────────────────────────────────────────────────

  it('ledger balance < totalDebit → InsufficientBalanceError, no Transaction', async () => {
    // totalDebit = 11.000000, balance is only 1 USDT
    const ledgerRepo = makeLedgerRepo('1.000000');
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );
    const directiveService = makeDirectiveService(STUB_SEND_GRANT);

    const svc = buildSendService({
      ledgerRepo,
      settlementRepo,
      directiveService,
    });

    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toBeInstanceOf(
      InsufficientBalanceError,
    );
    expect(
      settlementRepo.createSendSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
    // Balance check gates directive — directive must NOT be called
    expect(directiveService.consume).not.toHaveBeenCalled();
  });

  // ── Cooling-off active ─────────────────────────────────────────────────────

  it('beneficiary in cooling-off → BeneficiaryCoolingOffError, no Transaction', async () => {
    const coolingOffBen: BeneficiaryRecord = {
      ...STUB_CRYPTO_BENEFICIARY,
      firstUseLockedUntil: FUTURE, // still locked
    };
    const beneficiaryService = makeBeneficiaryServiceForSend(coolingOffBen);
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );

    const svc = buildSendService({ beneficiaryService, settlementRepo });

    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toBeInstanceOf(
      BeneficiaryCoolingOffError,
    );
    expect(
      settlementRepo.createSendSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
  });

  // ── Sanctions blocked ──────────────────────────────────────────────────────

  it('sanctions check fails → SanctionsBlockedError, no Transaction', async () => {
    const complianceService = makeComplianceService({ passed: false });
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );
    const directiveService = makeDirectiveService(STUB_SEND_GRANT);

    const svc = buildSendService({
      complianceService,
      settlementRepo,
      directiveService,
    });

    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toBeInstanceOf(
      SanctionsBlockedError,
    );
    expect(
      settlementRepo.createSendSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
    // Sanctions gates directive
    expect(directiveService.consume).not.toHaveBeenCalled();
  });

  // ── Wrong directive ref ────────────────────────────────────────────────────

  it('directive ref is request_pin instead of request_step_up → ProposalNotExecutableError', async () => {
    const wrongRefGrant: DirectiveGrantRecord = {
      ...STUB_SEND_GRANT,
      directiveRef: 'request_pin',
    };
    const directiveService = makeDirectiveService(wrongRefGrant);
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );

    const svc = buildSendService({ directiveService, settlementRepo });

    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toBeInstanceOf(
      ProposalNotExecutableError,
    );
    expect(
      settlementRepo.createSendSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
  });

  // ── PIN invalid ────────────────────────────────────────────────────────────

  it('I5: wrong PIN propagates WITHOUT consuming the one-shot step-up directive (legitimate retry survives); no Transaction, no withdraw', async () => {
    const pinService = makePinService(new PinInvalidError(4));
    const walletService = makeWalletServiceWithWithdraw();
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );
    const directiveService = makeDirectiveService(STUB_SEND_GRANT);

    const svc = buildSendService({
      pinService,
      walletService,
      settlementRepo,
      directiveService,
    });

    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toBeInstanceOf(
      PinInvalidError,
    );
    // I5: PIN before step-up directive consume — a wrong PIN must not burn the
    // one-shot step-up grant.
    expect(directiveService.consume).not.toHaveBeenCalled();
    expect(
      settlementRepo.createSendSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
    expect(walletService.withdraw).not.toHaveBeenCalled();
  });

  // ── Idempotent replay ─────────────────────────────────────────────────────

  it('idempotent replay: returns existing transactionId, no new Transaction/withdraw/outbox', async () => {
    const existingTxn: TransactionRecord = {
      ...STUB_SEND_TXN,
      status: 'settling',
    };
    const transactionRepo = makeTransactionRepoForSend(existingTxn);
    const walletService = makeWalletServiceWithWithdraw();
    const outboxRepo = makeOutboxRepo();
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );

    const svc = buildSendService({
      transactionRepo,
      walletService,
      outboxRepo,
      settlementRepo,
    });

    const result = await svc.executeSend(SEND_BASE_INPUT);

    expect(result.transactionId).toBe(SEND_TXN_ID);
    expect(result.status).toBe('settling');
    // No new side-effects
    expect(
      settlementRepo.createSendSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
    expect(walletService.withdraw).not.toHaveBeenCalled();
    expect(outboxRepo.create).not.toHaveBeenCalled();
  });

  // ── TravelRule flag: does not block execution ──────────────────────────────

  it('requiresTravelRule=true in parameters: execution succeeds (flag stored in metadata)', async () => {
    const travelRuleProposal: ProposalRecord = {
      ...STUB_SEND_PROPOSAL,
      parameters: {
        ...STUB_SEND_PROPOSAL.parameters,
        requiresTravelRule: 'true',
      },
    };
    const proposalRepo = makeProposalRepo(travelRuleProposal);
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );

    const svc = buildSendService({ proposalRepo, settlementRepo });

    const result = await svc.executeSend(SEND_BASE_INPUT);
    expect(result.status).toBe('settling');
  });

  // ── Fix-D: Travel Rule originator/beneficiary enrichment ──────────────────

  it('Fix-D: requiresTravelRule=true + KycProfile present → travelRule payload contains originatorName + beneficiaryName populated from real sources', async () => {
    const ORIGINATOR_NAME = 'Ada Okafor';
    const travelRuleProposal: ProposalRecord = {
      ...STUB_SEND_PROPOSAL,
      parameters: {
        ...STUB_SEND_PROPOSAL.parameters,
        requiresTravelRule: 'true',
      },
    };
    const proposalRepo = makeProposalRepo(travelRuleProposal);
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );
    // KycGate returns a real name for this user (Fix-D: populated from KycProfile).
    const kycGate = makeKycGate(undefined, ORIGINATOR_NAME);

    const svc = buildSendService({ proposalRepo, settlementRepo, kycGate });

    await svc.executeSend(SEND_BASE_INPUT);

    // The atomic write must receive a non-null travelRule payload with the
    // originatorName sourced from KycProfile and beneficiaryName from the
    // Beneficiary record (label for crypto_address type).
    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    expect(
      settlementRepo.createSendSettlingWithReserveAtomic,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        travelRule: expect.objectContaining({
          originatorName: ORIGINATOR_NAME,
          beneficiaryName: STUB_CRYPTO_BENEFICIARY.label,
          beneficiaryAddress: SEND_TO_ADDRESS,
          originatorUserId: USER_ID,
          // Wave D: the fiat the equivalent was valued in is snapshot at capture
          // (the registry default fiat used for the threshold gate) — never an
          // assumed NGN downstream.
          fiatCurrency: 'NGN',
        }),
      }),
    );
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
  });

  it('Fix-D: requiresTravelRule=true + KycProfile absent → travelRule.originatorName is null (graceful degradation, documented)', async () => {
    const travelRuleProposal: ProposalRecord = {
      ...STUB_SEND_PROPOSAL,
      parameters: {
        ...STUB_SEND_PROPOSAL.parameters,
        requiresTravelRule: 'true',
      },
    };
    const proposalRepo = makeProposalRepo(travelRuleProposal);
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );
    // KycGate returns null (no KycProfile created yet, or names are absent).
    const kycGate = makeKycGate(undefined, null);

    const svc = buildSendService({ proposalRepo, settlementRepo, kycGate });

    await svc.executeSend(SEND_BASE_INPUT);

    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    expect(
      settlementRepo.createSendSettlingWithReserveAtomic,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        travelRule: expect.objectContaining({
          originatorName: null,
          // beneficiaryName still comes from the Beneficiary label.
          beneficiaryName: STUB_CRYPTO_BENEFICIARY.label,
        }),
      }),
    );
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
  });

  it('Fix-D: requiresTravelRule=false → travelRule payload is null (getOriginatorName not called)', async () => {
    // STUB_SEND_PROPOSAL has requiresTravelRule: 'false'
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );
    const kycGate = makeKycGate(undefined, 'Should Not Be Called');

    const svc = buildSendService({ settlementRepo, kycGate });

    await svc.executeSend(SEND_BASE_INPUT);

    // When below threshold, travelRule must be null.

    expect(
      settlementRepo.createSendSettlingWithReserveAtomic,
    ).toHaveBeenCalledWith(expect.objectContaining({ travelRule: null }));

    // getOriginatorName must NOT be called when requiresTravelRule is false.
    expect(kycGate.getOriginatorName).not.toHaveBeenCalled();
  });

  // ── IMPORTANT 1: fail-closed compliance — missing ComplianceService must throw ─

  it('missing complianceService (undefined) → throws rather than skipping sanctions (fail-CLOSED)', async () => {
    // Build a service without a complianceService to exercise the fail-closed path.
    const defaultSettlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );
    const svc = new ExecutionService(
      makeProposalRepo(STUB_SEND_PROPOSAL),
      makeQuoteRepo(null),
      makeTransactionRepoForSend(),
      makeOutboxRepo(),
      defaultSettlementRepo,
      makeQuotesService() as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      makeDirectiveService(STUB_SEND_GRANT) as unknown as DirectiveService,
      makePinService() as unknown as PinService,
      makeWalletServiceWithWithdraw() as unknown as WalletService,
      makePaymentProvider() as unknown as IPaymentProvider,
      stubConfig as never,
      stubClock,
      makeAssetRegistry(),
      makeBeneficiaryServiceForSend() as never,
      makeLedgerRepo('100'),
      makeIdentityService() as never,
      makeWhatsAppSender() as never,
      // complianceService deliberately omitted (undefined)
      undefined,
    );

    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toThrow();
  });

  // ── IMPORTANT 2: walletId null guard ──────────────────────────────────────

  it('proposal parameters missing walletId → ProposalNotExecutableError before any writes', async () => {
    const noWalletProposal: ProposalRecord = {
      ...STUB_SEND_PROPOSAL,
      parameters: {
        ...STUB_SEND_PROPOSAL.parameters,

        walletId: undefined,
      },
    };
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );

    const svc = buildSendService({
      proposalRepo: makeProposalRepo(noWalletProposal),
      settlementRepo,
    });

    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toBeInstanceOf(
      ProposalNotExecutableError,
    );
    expect(
      settlementRepo.createSendSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
  });

  // ── IMPORTANT 3: baseRate=0 → config error (KYC gate bypass prevention) ──

  it('baseRate is 0 or absent in pricing config → throws config error (not silently passing fiatAmount=0)', async () => {
    // Use a config that returns pricing.assets with no USDT entry → baseRate defaults to 0.
    const zeroRateConfig = {
      get: jest.fn((key: string) => {
        if (key === 'buy') return { maxDriftBps: 50 };
        if (key === 'sell') return { maxDriftBps: 50 };
        if (key === 'pricing') return { assets: {} }; // no USDT entry → baseRate = 0
        return undefined;
      }),
    };

    const defaultSettlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );
    // Hold the auth mocks so we can assert the config error fails closed at
    // Step 2 — BEFORE any single-use directive is consumed or PIN is attempted.
    const directiveService = makeDirectiveService(STUB_SEND_GRANT);
    const pinService = makePinService();
    const svc = new ExecutionService(
      makeProposalRepo(STUB_SEND_PROPOSAL),
      makeQuoteRepo(null),
      makeTransactionRepoForSend(),
      makeOutboxRepo(),
      defaultSettlementRepo,
      makeQuotesService() as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      directiveService as unknown as DirectiveService,
      pinService as unknown as PinService,
      makeWalletServiceWithWithdraw() as unknown as WalletService,
      makePaymentProvider() as unknown as IPaymentProvider,
      zeroRateConfig as never,
      stubClock,
      makeAssetRegistry(),
      makeBeneficiaryServiceForSend() as never,
      makeLedgerRepo('100'),
      makeIdentityService() as never,
      makeWhatsAppSender() as never,
      makeComplianceService() as never,
      makeSessionService() as never,
    );

    // Should throw the shared fail-closed config error — must NOT silently
    // proceed with fiatAmount=0 (same BaseRateMisconfiguredError as ProposalService).
    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toThrow(
      BaseRateMisconfiguredError,
    );
    expect(
      defaultSettlementRepo.createSendSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
    // A pure config error must not burn the single-use step-up directive or a
    // PIN attempt — the guard precedes both (gauntlet Steps 6 and 7).
    expect(directiveService.consume).not.toHaveBeenCalled();
    expect(pinService.verifyPin).not.toHaveBeenCalled();
  });

  // ── Fix-2: exact rate scaling — fractional baseRate handled exactly ────────

  it('KYC gate receives exact NGN-equivalent with fractional baseRate (no Math.round drift)', async () => {
    // baseRate 1600.45: 10 USDT × 1600.45 = 16004.5 NGN exactly.
    // Math.round(1600.45) = 1600 → would produce 16000 (wrong by 4.5 NGN).
    const fractionalRateConfig = {
      get: jest.fn((key: string) => {
        if (key === 'buy') return { maxDriftBps: 50 };
        if (key === 'sell') return { maxDriftBps: 50 };
        if (key === 'pricing')
          return { assets: { USDT: { baseRates: { NGN: 1600.45 } } } };
        return undefined;
      }),
    };

    const kycGate = makeKycGate();
    const defaultSettlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );
    const svc = new ExecutionService(
      makeProposalRepo(STUB_SEND_PROPOSAL),
      makeQuoteRepo(null),
      makeTransactionRepoForSend(),
      makeOutboxRepo(),
      defaultSettlementRepo,
      makeQuotesService() as unknown as QuotesService,
      kycGate as unknown as KycGateService,
      makeDirectiveService(STUB_SEND_GRANT) as unknown as DirectiveService,
      makePinService() as unknown as PinService,
      makeWalletServiceWithWithdraw() as unknown as WalletService,
      makePaymentProvider() as unknown as IPaymentProvider,
      fractionalRateConfig as never,
      stubClock,
      makeAssetRegistry(),
      makeBeneficiaryServiceForSend() as never,
      makeLedgerRepo('100'),
      makeIdentityService() as never,
      makeWhatsAppSender() as never,
      makeComplianceService() as never,
      makeSessionService() as never,
    );

    await svc.executeSend(SEND_BASE_INPUT);

    const calls = (
      kycGate.assertCanTransact as jest.MockedFunction<
        (input: {
          userId: string;
          fiatAmount: string;
          asset: string;
        }) => Promise<void>
      >
    ).mock.calls;
    const fiatAmount = calls[0][0].fiatAmount;

    // 10 USDT × 1600.45 = 16004.5 — exact scaling must produce this, not 16000.
    expect(fiatAmount).toBe('16004.5');
  });

  // ── Gauntlet order ─────────────────────────────────────────────────────────

  it('gauntlet order: balance→cooling-off→sanctions→pin→directive→idempotency→atomic (I5: PIN before directive)', async () => {
    const callOrder: string[] = [];

    const ledgerRepo = {
      getAccountBalance: jest.fn().mockImplementation(() => {
        callOrder.push('balance');
        return Promise.resolve('100');
      }),
      listLedgerEntries: jest.fn().mockResolvedValue([]),
      listByTransaction: jest.fn().mockResolvedValue([]),
      getAccountHistory: jest.fn().mockResolvedValue([]),
      verifyTransactionIntegrity: jest
        .fn()
        .mockResolvedValue({ balanced: true, legCount: 0, brokenAt: null }),
      listGlobal: jest.fn(),
      verifyGlobalSequenceIntegrity: jest.fn(),
    };
    const beneficiaryService = {
      getById: jest.fn().mockImplementation(() => {
        callOrder.push('cooling_off');
        return Promise.resolve(STUB_CRYPTO_BENEFICIARY);
      }),
    };
    const complianceService = {
      screenSendDestination: jest.fn().mockImplementation(() => {
        callOrder.push('sanctions');
        return Promise.resolve({ passed: true, complianceEventId: 'id' });
      }),
    };
    const directiveService = {
      consume: jest.fn().mockImplementation(() => {
        callOrder.push('directive');
        return Promise.resolve(STUB_SEND_GRANT);
      }),
    };
    const pinService = {
      verifyPin: jest.fn().mockImplementation(() => {
        callOrder.push('pin');
        return Promise.resolve();
      }),
    };
    const transactionRepo = {
      findByIdempotencyKey: jest.fn().mockImplementation(() => {
        callOrder.push('idempotency');
        return Promise.resolve(null);
      }),
      create: jest.fn().mockResolvedValue(STUB_SEND_TXN),
      createSettlingWithProposal: jest.fn().mockResolvedValue(STUB_SEND_TXN),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      mergeMetadata: jest.fn().mockResolvedValue(undefined),
      listByUserInRange: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      findByUserId: jest.fn().mockResolvedValue([]),
    };
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );
    settlementRepo.createSendSettlingWithReserveAtomic = jest
      .fn()
      .mockImplementation(() => {
        callOrder.push('atomic_create');
        return Promise.resolve({ txn: STUB_SEND_TXN });
      });

    const svc = buildSendService({
      ledgerRepo,
      beneficiaryService,
      complianceService,
      directiveService: directiveService as unknown as jest.Mocked<
        Pick<DirectiveService, 'consume'>
      >,
      pinService: pinService as unknown as jest.Mocked<
        Pick<PinService, 'verifyPin'>
      >,
      transactionRepo:
        transactionRepo as unknown as jest.Mocked<ITransactionRepository>,
      settlementRepo,
    });

    await svc.executeSend(SEND_BASE_INPUT);

    expect(callOrder.indexOf('balance')).toBeLessThan(
      callOrder.indexOf('cooling_off'),
    );
    expect(callOrder.indexOf('cooling_off')).toBeLessThan(
      callOrder.indexOf('sanctions'),
    );
    expect(callOrder.indexOf('sanctions')).toBeLessThan(
      callOrder.indexOf('pin'),
    );
    // I5: PIN is verified before the step-up directive is consumed.
    expect(callOrder.indexOf('pin')).toBeLessThan(
      callOrder.indexOf('directive'),
    );
    // Directive is still consumed before the idempotency check.
    expect(callOrder.indexOf('directive')).toBeLessThan(
      callOrder.indexOf('idempotency'),
    );
    expect(callOrder.indexOf('idempotency')).toBeLessThan(
      callOrder.indexOf('atomic_create'),
    );
  });

  // ── Fix G: session step-up recording ────────────────────────────────────────

  it('Fix G: happy path records step-up on session after PIN passes (via pinnedDeviceId)', async () => {
    const sessionService = makeSessionService({
      pinnedDeviceId: 'bound-device-id',
    });

    const svc = buildSendService({ sessionService });

    await svc.executeSend(SEND_BASE_INPUT);

    // startOrTouch must be called with the resolved device
    expect(sessionService.startOrTouch).toHaveBeenCalledWith(
      USER_ID,
      'bound-device-id',
    );
    // recordStepUp must be called with the same device + a timestamp
    expect(sessionService.recordStepUp).toHaveBeenCalledWith(
      USER_ID,
      'bound-device-id',
      expect.any(Date),
    );
  });

  it('Fix G: happy path uses deviceId from input when provided (overrides pinnedDeviceId lookup)', async () => {
    const sessionService = makeSessionService({
      pinnedDeviceId: 'pinned-device',
    });

    const svc = buildSendService({ sessionService });

    // Pass an explicit deviceId in the input
    await svc.executeSend({ ...SEND_BASE_INPUT, deviceId: 'input-device-id' });

    // Must use the explicit deviceId, not the pinned one
    expect(sessionService.startOrTouch).toHaveBeenCalledWith(
      USER_ID,
      'input-device-id',
    );
    expect(sessionService.recordStepUp).toHaveBeenCalledWith(
      USER_ID,
      'input-device-id',
      expect.any(Date),
    );
    // findPinnedDeviceId should NOT be called when explicit deviceId is provided
    expect(sessionService.findPinnedDeviceId).not.toHaveBeenCalled();
  });

  it('Fix G: no bound device (pinnedDeviceId null) + no deviceId in input → throws ProposalNotExecutableError (fail-closed)', async () => {
    const sessionService = makeSessionService({ pinnedDeviceId: null });

    const svc = buildSendService({ sessionService });

    // No device resolvable — must fail closed
    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toThrow();

    // No transaction must have been created
    expect(sessionService.recordStepUp).not.toHaveBeenCalled();
  });

  it('Fix G: sessionService absent (not wired) → throws (fail-closed, same posture as complianceService)', async () => {
    // Build a service without sessionService to verify fail-closed behaviour
    const svc = new ExecutionService(
      makeProposalRepo(STUB_SEND_PROPOSAL),
      makeQuoteRepo(null),
      makeTransactionRepoForSend(),
      makeOutboxRepo(),
      makeSettlementRepo(
        null,
        { receiptNumber: STUB_RECEIPT_NUMBER },
        undefined,
        STUB_SEND_TXN,
      ),
      makeQuotesService() as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      makeDirectiveService(STUB_SEND_GRANT) as unknown as DirectiveService,
      makePinService() as unknown as PinService,
      makeWalletServiceWithWithdraw() as unknown as WalletService,
      makePaymentProvider() as unknown as IPaymentProvider,
      stubConfig as never,
      stubClock,
      makeAssetRegistry(),
      makeBeneficiaryServiceForSend() as never,
      makeLedgerRepo('100'),
      makeIdentityService() as never,
      makeWhatsAppSender() as never,
      makeComplianceService() as never,
      // sessionService deliberately omitted
      undefined,
    );

    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toThrow();
  });
});

// =============================================================================
// ExecutionService.settleSendOnChain (task N3b)
// =============================================================================

const SETTLING_SEND_TXN: TransactionRecord = {
  ...STUB_SEND_TXN,
  status: 'settling',
};

const SETTLE_SEND_SUCCESS_INPUT: import('./execution.service').SettleSendOnChainInput =
  {
    reference: SEND_IDEMPOTENCY_KEY,
    success: true,
    onChainTxHash: 'on_chain_hash_abc',
  };

const SETTLE_SEND_FAILURE_INPUT: import('./execution.service').SettleSendOnChainInput =
  {
    reference: SEND_IDEMPOTENCY_KEY,
    success: false,
  };

function makeTransactionRepoForSendSettle(
  txn: TransactionRecord | null,
): jest.Mocked<ITransactionRepository> {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByIdempotencyKey: jest.fn().mockResolvedValue(txn),
    create: jest.fn(),
    createSettlingWithProposal: jest.fn(),
    updateStatus: jest.fn(),
    mergeMetadata: jest.fn().mockResolvedValue(undefined),
    listByUserInRange: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    findByUserId: jest.fn().mockResolvedValue([]),
    listAll: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listByStatus: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  };
}

describe('ExecutionService.settleSendOnChain', () => {
  // ── Happy path: success=true → finalize ───────────────────────────────────

  it('success=true → calls settleSendFinalizeAtomic, returns completed + receiptNumber', async () => {
    const transactionRepo = makeTransactionRepoForSendSettle(SETTLING_SEND_TXN);
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );

    const svc = buildSendService({ transactionRepo, settlementRepo });

    const result = await svc.settleSendOnChain(SETTLE_SEND_SUCCESS_INPUT);

    expect(result.status).toBe('completed');
    expect(result.receiptNumber).toBe(STUB_RECEIPT_NUMBER);
    expect(settlementRepo.settleSendFinalizeAtomic).toHaveBeenCalledTimes(1);
    expect(settlementRepo.settleSendFinalizeAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: SEND_TXN_ID,
        onChainTxHash: 'on_chain_hash_abc',
      }),
    );
    expect(settlementRepo.settleSendRefundAtomic).not.toHaveBeenCalled();
  });

  // ── success=false → refund ─────────────────────────────────────────────────

  it('success=false → calls settleSendRefundAtomic, returns failed', async () => {
    const transactionRepo = makeTransactionRepoForSendSettle(SETTLING_SEND_TXN);
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );

    const svc = buildSendService({ transactionRepo, settlementRepo });

    const result = await svc.settleSendOnChain(SETTLE_SEND_FAILURE_INPUT);

    expect(result.status).toBe('failed');
    expect(settlementRepo.settleSendRefundAtomic).toHaveBeenCalledTimes(1);
    expect(settlementRepo.settleSendFinalizeAtomic).not.toHaveBeenCalled();

    // BUG 2 — the refund reverses the velocity this send consumed at reserve.
    expect(settlementRepo.settleSendRefundAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest objectContaining matcher is typed `any`
        velocityReversal: expect.objectContaining({
          userId: USER_ID,
          fiatCurrency: 'NGN',
          fiatAmountStr: '16000',
        }),
      }),
    );
  });

  // ── Already completed → idempotent ────────────────────────────────────────

  it('transaction already completed → returns completed (idempotent), no finalize called', async () => {
    const completedTxn: TransactionRecord = {
      ...SETTLING_SEND_TXN,
      status: 'completed',
    };
    const transactionRepo = makeTransactionRepoForSendSettle(completedTxn);
    const settlementRepo = makeSettlementRepo(STUB_RECEIPT_NUMBER);

    const svc = buildSendService({ transactionRepo, settlementRepo });

    const result = await svc.settleSendOnChain(SETTLE_SEND_SUCCESS_INPUT);

    expect(result.status).toBe('completed');
    expect(result.receiptNumber).toBe(STUB_RECEIPT_NUMBER);
    expect(settlementRepo.settleSendFinalizeAtomic).not.toHaveBeenCalled();
  });

  // ── Unknown reference ──────────────────────────────────────────────────────

  it('unknown reference → ProposalNotExecutableError', async () => {
    const transactionRepo = makeTransactionRepoForSendSettle(null);

    const svc = buildSendService({ transactionRepo });

    await expect(
      svc.settleSendOnChain(SETTLE_SEND_SUCCESS_INPUT),
    ).rejects.toBeInstanceOf(ProposalNotExecutableError);
  });

  // ── Wrong status (failed) → SettlementInvalidStatusError ─────────────────

  it('transaction status is failed → throws SettlementInvalidStatusError', async () => {
    const failedTxn: TransactionRecord = {
      ...SETTLING_SEND_TXN,
      status: 'failed',
    };
    const transactionRepo = makeTransactionRepoForSendSettle(failedTxn);

    const svc = buildSendService({ transactionRepo });

    await expect(
      svc.settleSendOnChain(SETTLE_SEND_SUCCESS_INPUT),
    ).rejects.toBeInstanceOf(SettlementInvalidStatusError);
  });

  // ── Notify on success ─────────────────────────────────────────────────────

  it('success=true → sends WhatsApp send-complete receipt to user', async () => {
    const transactionRepo = makeTransactionRepoForSendSettle(SETTLING_SEND_TXN);
    const identityService = makeIdentityService('+2349000000099');
    const whatsAppSender = makeWhatsAppSender();

    const svc = buildSendService({
      transactionRepo,
      identityService,
      whatsAppSender,
    });

    await svc.settleSendOnChain(SETTLE_SEND_SUCCESS_INPUT);

    expect(identityService.findWhatsAppAddress).toHaveBeenCalledWith(USER_ID);
    expect(whatsAppSender.sendText).toHaveBeenCalledWith(
      '+2349000000099',
      expect.stringContaining('send is complete'),
    );
  });

  // ── Notify on failure ─────────────────────────────────────────────────────

  it('success=false → sends WhatsApp send-failed notice to user', async () => {
    const transactionRepo = makeTransactionRepoForSendSettle(SETTLING_SEND_TXN);
    const identityService = makeIdentityService('+2349000000099');
    const whatsAppSender = makeWhatsAppSender();

    const svc = buildSendService({
      transactionRepo,
      identityService,
      whatsAppSender,
    });

    await svc.settleSendOnChain(SETTLE_SEND_FAILURE_INPUT);

    expect(identityService.findWhatsAppAddress).toHaveBeenCalledWith(USER_ID);
    expect(whatsAppSender.sendText).toHaveBeenCalledWith(
      '+2349000000099',
      expect.stringContaining('Send failed'),
    );
  });
});

// =============================================================================
// Task 6: sell-side 'NGN' literal replacement + TRON fallback removal
// =============================================================================

describe('ExecutionService.executeSell — Task 6: currency threaded from quote (not literal)', () => {
  it('uses the quote fiatCurrency for createPayout (not a hardcoded literal) and includes fiatCurrency in atomic metadata', async () => {
    // Use a quote with a NON-NGN fiatCurrency to prove currency is threaded, not hardcoded.
    const ghsQuote: QuoteRecord = {
      ...STORED_SELL_QUOTE,
      fiatCurrency: 'GHS',
    };
    // The proposal's STUB_SELL_TXN must reflect GHS in metadata for idempotency check;
    // override txn with GHS metadata so createSellSettlingWithReserveAtomic returns GHS txn.
    const ghsSellTxn: TransactionRecord = {
      ...STUB_SELL_TXN,
      metadata: {
        ...(STUB_SELL_TXN.metadata as Record<string, string>),
        fiatCurrency: 'GHS',
      },
    };
    const quoteRepo = makeQuoteRepo(ghsQuote);
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      ghsSellTxn,
    );
    const paymentProvider = makeSellPaymentProvider();

    const svc = buildSellService({
      quoteRepo,
      settlementRepo,
      paymentProvider,
    });

    await svc.executeSell(SELL_BASE_INPUT);

    // createPayout must receive currency: 'GHS' from the stored quote, NOT 'NGN'.
    expect(paymentProvider.createPayout).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'GHS' }),
    );
  });
});

describe('ExecutionService.executeSend — Task 6: fail-closed on missing network (no TRON default)', () => {
  it('fails closed when a send proposal has no network (no TRON default)', async () => {
    // Build a proposal whose parameters do NOT include 'network'.
    const proposalWithoutNetwork: ProposalRecord = {
      ...STUB_SEND_PROPOSAL,
      parameters: {
        asset: 'USDT',
        cryptoAmount: '10.000000',
        networkFeeCrypto: '1.000000',
        totalDebit: '11.000000',
        beneficiaryId: BENEFICIARY_ID,
        walletId: 'wallet-id',
        toAddress: SEND_TO_ADDRESS,
        // network intentionally omitted
        requiresTravelRule: 'false',
      },
    };
    const proposalRepo = makeProposalRepo(proposalWithoutNetwork);

    const svc = buildSendService({ proposalRepo });

    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toThrow(/network/i);
  });
});

// ============================================================================
// ExecutionService.executeSwap / settleSwap
// ============================================================================

// ---------------------------------------------------------------------------
// Swap fixtures
// ---------------------------------------------------------------------------

const SWAP_PROPOSAL_ID = 'swap-prop-1111-0000-7000-8000-000000000001';
const SWAP_QUOTE_ID = 'swap-quot-2222-0000-7000-8000-000000000002';
const SWAP_TXN_ID = 'swap-txn-3333-0000-7000-8000-000000000003';
const SWAP_IDEMPOTENCY_KEY = 'swap-idem-4444-0000-7000-8000-000000000004';
const SWAP_PROVIDER_REF = 'swap-provref-5555';

const STUB_SWAP_QUOTE_RECORD = {
  id: SWAP_QUOTE_ID,
  userId: USER_ID,
  type: 'swap',
  asset: 'USDT',
  fiatCurrency: 'NGN',
  fiatAmount: '64000',
  cryptoAmount: '40',
  fxRate: '1562.5',
  baseRate: '1600',
  spreadBps: 100,
  processingFeeBps: 0,
  processingFeeAmount: '0',
  status: 'valid',
  expiresAt: FUTURE,
  createdAt: FIXED_NOW,
};

const STUB_SWAP_PROPOSAL: ProposalRecord = {
  id: SWAP_PROPOSAL_ID,
  userId: USER_ID,
  conversationId: null,
  type: 'swap',
  status: 'pending',
  parameters: {
    fromAsset: 'USDT',
    toAsset: 'TRX',
    fromAmount: '40',
    toAmount: '62500',
    // Stored rate is the SPREAD-FOLDED effective rate proposeSwap persists
    // (provider raw 1562.5 × (1 − 100bps) = 1546.875). executeSwap folds the same
    // spread into the fresh provider rate before measuring drift, so an unchanged
    // provider rate yields zero drift (the drift gate measures provider slippage,
    // not our spread).
    rate: '1546.875',
    networkFee: '1',
    transactionFee: '0.5',
    estimatedArrivalSec: 120,
    walletId: 'wallet-id',
    fromAssetId: 'br_id_USDT',
    toAssetId: 'br_id_TRX',
    quoteId: SWAP_QUOTE_ID,
  },
  parametersChecksum: 'a'.repeat(64),
  quoteId: SWAP_QUOTE_ID,
  expiresAt: FUTURE,
  confirmedAt: null,
  createdAt: FIXED_NOW,
};

const STUB_SWAP_TXN: TransactionRecord = {
  id: SWAP_TXN_ID,
  proposalId: SWAP_PROPOSAL_ID,
  userId: USER_ID,
  type: 'swap',
  status: 'settling',
  idempotencyKey: SWAP_IDEMPOTENCY_KEY,
  requestChecksum: 'swap-checksum',
  fxRateSnapshot: '1562.5',
  metadata: {
    fromAsset: 'USDT',
    toAsset: 'TRX',
    fromAmount: '40',
    toAmount: '62500',
    walletId: 'wallet-id',
    providerSwapId: SWAP_PROVIDER_REF,
    // BUG 2 — velocity contribution persisted at reserve, read back on refund.
    velocityFiatAmount: '64000',
    velocityFiatCurrency: 'NGN',
  },
  processorTxRef: null,
  onChainTxHash: null,
  failureReason: null,
  pinVerifiedAt: FIXED_NOW,
  createdAt: FIXED_NOW,
  executedAt: null,
  completedAt: null,
  failedAt: null,
};

const STUB_SWAP_EXECUTE_OUTPUT = {
  providerSwapId: SWAP_PROVIDER_REF,
  status: 'pending' as const,
};

function makeSwapProviderMock(
  quoteResult = {
    toAmount: '62500',
    rate: '1562.5',
    minAmount: '62000',
    slippage: 50,
    networkFee: '1',
    transactionFee: '0.5',
    estimatedArrivalSec: 120,
  },
  executeResult = STUB_SWAP_EXECUTE_OUTPUT,
  throws?: Error,
) {
  const mock = {
    getQuote: jest.fn().mockResolvedValue(quoteResult),
    execute: jest.fn(),
  };
  if (throws) {
    mock.execute.mockRejectedValue(throws);
  } else {
    mock.execute.mockResolvedValue(executeResult);
  }
  return mock;
}

function makeSwapSettlementRepo(): jest.Mocked<ISettlementRepository> {
  return {
    ...makeSettlementRepo(),
    createSwapSettlingWithReserveAtomic: jest
      .fn()
      .mockResolvedValue({ txn: STUB_SWAP_TXN }),
    settleSwapFinalizeAtomic: jest
      .fn()
      .mockResolvedValue({ receiptNumber: STUB_RECEIPT_NUMBER }),
    settleSwapRefundAtomic: jest.fn().mockResolvedValue(undefined),
  };
}

const SWAP_STUB_CONFIG = {
  get: jest.fn((key: string) => {
    if (key === 'buy') return { maxDriftBps: 50 };
    if (key === 'sell') return { maxDriftBps: 50 };
    if (key === 'swap') return { maxDriftBps: 50, spreadBps: 100 };
    if (key === 'pricing')
      return { assets: { USDT: { baseRates: { NGN: 1600 } } } };
    return undefined;
  }),
};

function buildSwapService(
  overrides: {
    proposalRepo?: jest.Mocked<IProposalRepository>;
    quoteRepo?: jest.Mocked<IQuoteRepository>;
    transactionRepo?: jest.Mocked<ITransactionRepository>;
    outboxRepo?: jest.Mocked<ISettlementOutboxRepository>;
    settlementRepo?: jest.Mocked<ISettlementRepository>;
    kycGate?: unknown;
    directiveService?: unknown;
    pinService?: unknown;
    ledgerRepo?: {
      getAccountBalance: jest.Mock;
      listLedgerEntries: jest.Mock;
      listByTransaction?: jest.Mock;
      getAccountHistory?: jest.Mock;
      verifyTransactionIntegrity?: jest.Mock;
    };
    swapProvider?: { getQuote: jest.Mock; execute: jest.Mock };
    walletService?: jest.Mocked<
      Pick<WalletService, 'getOrProvisionNetworkWallet'>
    >;
  } = {},
): ExecutionService {
  const swapStepUpGrant: DirectiveGrantRecord = {
    ...STUB_GRANT,
    directiveRef: 'request_pin', // swap uses request_pin like buy/sell
  };
  return new ExecutionService(
    overrides.proposalRepo ?? makeProposalRepo(STUB_SWAP_PROPOSAL),
    overrides.quoteRepo ?? {
      create: jest.fn().mockResolvedValue({ id: SWAP_QUOTE_ID }),
      findById: jest.fn().mockResolvedValue(STUB_SWAP_QUOTE_RECORD),
    },
    overrides.transactionRepo ?? makeTransactionRepo(null, STUB_SWAP_TXN),
    overrides.outboxRepo ?? makeOutboxRepo(),
    overrides.settlementRepo ?? makeSwapSettlementRepo(),
    // quotesService: not used on swap path (no FX quote re-fetch)
    { quoteBuy: jest.fn(), quoteSell: jest.fn() } as unknown as QuotesService,
    (overrides.kycGate ?? makeKycGate()) as unknown as KycGateService,
    (overrides.directiveService ??
      makeDirectiveService(swapStepUpGrant)) as unknown as DirectiveService,
    (overrides.pinService ?? makePinService()) as unknown as PinService,
    (overrides.walletService as unknown as WalletService) ??
      (makeWalletService() as unknown as WalletService),
    // paymentProvider: not used on swap path
    makePaymentProvider() as unknown as IPaymentProvider,
    SWAP_STUB_CONFIG as never,
    stubClock,
    makeAssetRegistry(),
    { getById: jest.fn().mockResolvedValue(null) } as never,
    (overrides.ledgerRepo as never) ?? {
      getAccountBalance: jest.fn().mockResolvedValue('100'),
      listLedgerEntries: jest.fn().mockResolvedValue([]),
      listByTransaction: jest.fn().mockResolvedValue([]),
      getAccountHistory: jest.fn().mockResolvedValue([]),
      verifyTransactionIntegrity: jest
        .fn()
        .mockResolvedValue({ balanced: true, legCount: 0, brokenAt: null }),
      listGlobal: jest.fn(),
      verifyGlobalSequenceIntegrity: jest.fn(),
    },
    undefined, // identityService
    undefined, // whatsAppSender
    undefined, // complianceService (not needed for swap)
    undefined, // sessionService (not needed for swap)
    // swapProvider as the last arg
    overrides.swapProvider ?? makeSwapProviderMock(),
  );
}

const SWAP_BASE_INPUT = {
  userId: USER_ID,
  proposalId: SWAP_PROPOSAL_ID,
  directiveId: DIRECTIVE_ID,
  nonce: NONCE,
  pin: PIN,
  idempotencyKey: SWAP_IDEMPOTENCY_KEY,
};

describe('ExecutionService.executeSwap', () => {
  it('happy path: reserves fromAsset, calls SWAP_PROVIDER.execute, returns settling+providerSwapId', async () => {
    const settlementRepo = makeSwapSettlementRepo();
    const outboxRepo = makeOutboxRepo();
    const swapProvider = makeSwapProviderMock();

    const svc = buildSwapService({ settlementRepo, outboxRepo, swapProvider });
    const result = await svc.executeSwap(SWAP_BASE_INPUT);

    expect(result.status).toBe('settling');
    expect(result.swap.providerSwapId).toBe(SWAP_PROVIDER_REF);
    // Atomic reserve write
    expect(
      settlementRepo.createSwapSettlingWithReserveAtomic,
    ).toHaveBeenCalledTimes(1);
    expect(
      settlementRepo.createSwapSettlingWithReserveAtomic,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ fromAsset: 'USDT', fromAmount: '40' }),
    );
    // Provider called exactly once
    expect(swapProvider.execute).toHaveBeenCalledTimes(1);
    // Outbox enqueued
    expect(outboxRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ settlementType: 'swap' }),
    );
  });

  it('passes wallet.providerReference (Blockradar child-address id) as addressId — NOT wallet.id — to getQuote and execute', async () => {
    // The proposal params store walletId = wallet.id ('wallet-id'), but Blockradar's
    // swap getQuote/execute require the child-address id (wallet.providerReference).
    // executeSwap must re-load the wallet and thread providerReference through, mirroring
    // the send path. Passing wallet.id would make every real swap fail at the provider.
    const walletService = makeWalletService();
    const swapProvider = makeSwapProviderMock();

    const svc = buildSwapService({ walletService, swapProvider });
    await svc.executeSwap(SWAP_BASE_INPUT);

    // Wallet re-loaded by (userId, network) — network derived from fromAsset.
    expect(walletService.getOrProvisionNetworkWallet).toHaveBeenCalledWith(
      USER_ID,
      'TRON',
    );
    // Both provider calls receive the providerReference, never the DB wallet.id.
    expect(swapProvider.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ addressId: 'blockradar-ref-001' }),
    );
    expect(swapProvider.execute).toHaveBeenCalledWith(
      expect.objectContaining({ addressId: 'blockradar-ref-001' }),
    );
    expect(swapProvider.getQuote).not.toHaveBeenCalledWith(
      expect.objectContaining({ addressId: 'wallet-id' }),
    );
    expect(swapProvider.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ addressId: 'wallet-id' }),
    );
  });

  it('verifies PIN before consuming directive (I5: wrong-PIN must not burn the grant)', async () => {
    const callOrder: string[] = [];
    const pinService = {
      verifyPin: jest.fn(() => {
        callOrder.push('pin');
        return Promise.resolve();
      }),
    };
    const directiveService = {
      consume: jest.fn(() => {
        callOrder.push('directive');
        return Promise.resolve(STUB_GRANT);
      }),
    };

    const svc = buildSwapService({ pinService, directiveService });
    await svc.executeSwap(SWAP_BASE_INPUT);

    expect(callOrder.indexOf('pin')).toBeLessThan(
      callOrder.indexOf('directive'),
    );
  });

  it('idempotent replay: returns existing result when transaction found for key', async () => {
    const existingTxn: TransactionRecord = {
      ...STUB_SWAP_TXN,
      metadata: {
        fromAsset: 'USDT',
        toAsset: 'TRX',
        fromAmount: '40',
        toAmount: '62500',
        walletId: 'wallet-id',
        providerSwapId: 'existing-swap-ref',
      },
    };
    const transactionRepo = makeTransactionRepo(existingTxn, STUB_SWAP_TXN);
    const settlementRepo = makeSwapSettlementRepo();

    const svc = buildSwapService({ transactionRepo, settlementRepo });
    const result = await svc.executeSwap(SWAP_BASE_INPUT);

    expect(result.status).toBe('settling');
    expect(result.swap.providerSwapId).toBe('existing-swap-ref');
    // No new writes
    expect(
      settlementRepo.createSwapSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
  });

  it('propagates PIN error without consuming directive', async () => {
    const pinService = makePinService(new Error('wrong pin'));
    const directiveService = makeDirectiveService();

    const svc = buildSwapService({ pinService, directiveService });
    await expect(svc.executeSwap(SWAP_BASE_INPUT)).rejects.toThrow('wrong pin');
    expect(directiveService.consume).not.toHaveBeenCalled();
  });

  it('rejects when proposal type is not swap', async () => {
    const wrongTypeProposal: ProposalRecord = {
      ...STUB_SWAP_PROPOSAL,
      type: 'sell',
    };
    const proposalRepo = makeProposalRepo(wrongTypeProposal);

    const svc = buildSwapService({ proposalRepo });
    await expect(svc.executeSwap(SWAP_BASE_INPUT)).rejects.toThrow(
      ProposalNotExecutableError,
    );
  });

  it('deduces drift check — throws QuoteDriftError when provider rate drifted > maxDriftBps', async () => {
    // Stored rate = 1562.5; fresh rate = 2000 → large drift
    const swapProvider = makeSwapProviderMock({
      toAmount: '80000',
      rate: '2000', // drifted from 1562.5
      minAmount: '79000',
      slippage: 50,
      networkFee: '1',
      transactionFee: '0.5',
      estimatedArrivalSec: 120,
    });
    const svc = buildSwapService({ swapProvider });
    await expect(svc.executeSwap(SWAP_BASE_INPUT)).rejects.toThrow(
      QuoteDriftError,
    );
  });

  it('wraps SWAP_PROVIDER.execute failure in ProviderUnavailableError', async () => {
    const swapProvider = makeSwapProviderMock(
      undefined,
      undefined,
      new Error('provider down'),
    );
    const svc = buildSwapService({ swapProvider });
    await expect(svc.executeSwap(SWAP_BASE_INPUT)).rejects.toThrow(
      ProviderUnavailableError,
    );
  });

  // ── FUNDS-SAFETY: synchronous execute rejection (§3.1) ──────────────────────
  // Same reserve-then-callProvider shape as executeSend: the reserve (Step 6) is
  // committed BEFORE SWAP_PROVIDER.execute (Step 7). A definitive 4xx rejection
  // (request rejected, swap never performed) must refund the reserve; an ambiguous
  // 5xx/timeout might be in-flight and must be left 'settling' for the reconciler.

  it('execute rejected with a definitive 4xx → refunds the reserve, no outbox row, re-throws', async () => {
    const settlementRepo = makeSwapSettlementRepo();
    const outboxRepo = makeOutboxRepo();
    const swapProvider = makeSwapProviderMock(
      undefined,
      undefined,
      Object.assign(
        new Error(
          'Blockradar swap execute error (HTTP 422): insufficient balance',
        ),
        { httpStatus: 422 },
      ),
    );

    const svc = buildSwapService({ settlementRepo, outboxRepo, swapProvider });

    await expect(svc.executeSwap(SWAP_BASE_INPUT)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );

    expect(settlementRepo.settleSwapRefundAtomic).toHaveBeenCalledTimes(1);
    expect(settlementRepo.settleSwapRefundAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: SWAP_TXN_ID,
        userId: USER_ID,
        walletId: 'wallet-id',
        fromAmount: '40',
        fromAsset: 'USDT',
      }),
    );
    expect(outboxRepo.create).not.toHaveBeenCalled();
  });

  it('execute fails with an ambiguous 5xx → leaves tx settling (NO refund), re-throws', async () => {
    const settlementRepo = makeSwapSettlementRepo();
    const outboxRepo = makeOutboxRepo();
    const swapProvider = makeSwapProviderMock(
      undefined,
      undefined,
      Object.assign(
        new Error('Blockradar swap execute error (HTTP 502): bad gateway'),
        { httpStatus: 502 },
      ),
    );

    const svc = buildSwapService({ settlementRepo, outboxRepo, swapProvider });

    await expect(svc.executeSwap(SWAP_BASE_INPUT)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(settlementRepo.settleSwapRefundAtomic).not.toHaveBeenCalled();
    expect(outboxRepo.create).not.toHaveBeenCalled();
  });

  // ── SwapUnavailableError must propagate unchanged (#21/#22) ──────────────────
  // BlockradarSwapProvider maps HTTP 404 (swap not enrolled) to a typed
  // SwapUnavailableError so callers can show a graceful "not available" message.
  // callProvider must NOT clobber it into a retryable ProviderUnavailableError —
  // the execute path must match the proposal path's graceful semantics.

  it('swapGetQuote throws SwapUnavailableError → propagates unchanged (not wrapped as a retryable 502)', async () => {
    const swapProvider = makeSwapProviderMock();
    swapProvider.getQuote.mockRejectedValue(
      new SwapUnavailableError('Swap is not available on this account'),
    );
    const settlementRepo = makeSwapSettlementRepo();

    const svc = buildSwapService({ swapProvider, settlementRepo });

    await expect(svc.executeSwap(SWAP_BASE_INPUT)).rejects.toBeInstanceOf(
      SwapUnavailableError,
    );
    // The quote pre-check runs BEFORE the reserve — no debit, no refund needed.
    expect(
      settlementRepo.createSwapSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
  });

  it('swapExecute throws SwapUnavailableError → propagates unchanged (no clobber to ProviderUnavailableError)', async () => {
    const swapProvider = makeSwapProviderMock();
    swapProvider.execute.mockRejectedValue(
      new SwapUnavailableError('Swap not enrolled on this account'),
    );
    const settlementRepo = makeSwapSettlementRepo();
    const outboxRepo = makeOutboxRepo();

    const svc = buildSwapService({ swapProvider, settlementRepo, outboxRepo });

    await expect(svc.executeSwap(SWAP_BASE_INPUT)).rejects.toBeInstanceOf(
      SwapUnavailableError,
    );
    // SwapUnavailableError carries no httpStatus → not a definitive 4xx → no
    // refund (the reserve was committed; this surfaces as a non-retryable error
    // and the reconciler will not act on an in-flight that never happened).
    expect(outboxRepo.create).not.toHaveBeenCalled();
  });

  it('throws ProposalExpiredError when proposal is expired', async () => {
    const expiredProposal: ProposalRecord = {
      ...STUB_SWAP_PROPOSAL,
      expiresAt: PAST,
    };
    const proposalRepo = makeProposalRepo(expiredProposal);

    const svc = buildSwapService({ proposalRepo });
    await expect(svc.executeSwap(SWAP_BASE_INPUT)).rejects.toThrow(
      ProposalExpiredError,
    );
  });
});

describe('ExecutionService.settleSwap', () => {
  it('success path: credits toAsset, marks completed, mints receipt', async () => {
    const txnWithSettling: TransactionRecord = {
      ...STUB_SWAP_TXN,
      status: 'settling',
    };
    const transactionRepo = makeTransactionRepo(txnWithSettling, STUB_SWAP_TXN);
    transactionRepo.findByIdempotencyKey.mockResolvedValue(txnWithSettling);
    const settlementRepo = makeSwapSettlementRepo();

    const svc = buildSwapService({ transactionRepo, settlementRepo });
    const result = await svc.settleSwap({
      reference: SWAP_IDEMPOTENCY_KEY,
      success: true,
      toAmount: '62500',
      hash: 'on-chain-hash-abc',
    });

    expect(result.status).toBe('completed');
    expect(result.receiptNumber).toBe(STUB_RECEIPT_NUMBER);
    expect(settlementRepo.settleSwapFinalizeAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        toAmount: '62500',
        toAsset: 'TRX',
        fromAmount: '40',
        fromAsset: 'USDT',
      }),
    );
  });

  it('failure path: refunds fromAsset, marks failed', async () => {
    const txnWithSettling: TransactionRecord = {
      ...STUB_SWAP_TXN,
      status: 'settling',
    };
    const transactionRepo = makeTransactionRepo(txnWithSettling, STUB_SWAP_TXN);
    transactionRepo.findByIdempotencyKey.mockResolvedValue(txnWithSettling);
    const settlementRepo = makeSwapSettlementRepo();

    const svc = buildSwapService({ transactionRepo, settlementRepo });
    const result = await svc.settleSwap({
      reference: SWAP_IDEMPOTENCY_KEY,
      success: false,
    });

    expect(result.status).toBe('failed');
    expect(settlementRepo.settleSwapRefundAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ fromAmount: '40', fromAsset: 'USDT' }),
    );

    // BUG 2 — the refund reverses the velocity this swap consumed at reserve.
    expect(settlementRepo.settleSwapRefundAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest objectContaining matcher is typed `any`
        velocityReversal: expect.objectContaining({
          userId: USER_ID,
          fiatCurrency: 'NGN',
          fiatAmountStr: '64000',
        }),
      }),
    );
  });

  // ── FUNDS-SAFETY: malformed success payload with missing/zero toAmount (#12) ──
  // A swap.success webhook that omits or zeroes the converted-amount field must
  // NEVER credit 0 / strand. The reserve is preserved (no finalize, no refund)
  // and the row stays 'settling' so a corrected retry can finalize it.

  it('success=true but toAmount is undefined → returns pending, preserves reserve (no finalize, no refund)', async () => {
    const txnWithSettling: TransactionRecord = {
      ...STUB_SWAP_TXN,
      status: 'settling',
    };
    const transactionRepo = makeTransactionRepo(txnWithSettling, STUB_SWAP_TXN);
    transactionRepo.findByIdempotencyKey.mockResolvedValue(txnWithSettling);
    const settlementRepo = makeSwapSettlementRepo();

    const svc = buildSwapService({ transactionRepo, settlementRepo });
    const result = await svc.settleSwap({
      reference: SWAP_IDEMPOTENCY_KEY,
      success: true,
      // toAmount intentionally omitted (malformed provider payload)
    });

    expect(result.status).toBe('pending');
    // Never credit 0 and never refund — the reserve must be preserved.
    expect(settlementRepo.settleSwapFinalizeAtomic).not.toHaveBeenCalled();
    expect(settlementRepo.settleSwapRefundAtomic).not.toHaveBeenCalled();
  });

  it('success=true but toAmount is "0" → returns pending, preserves reserve (never credits 0)', async () => {
    const txnWithSettling: TransactionRecord = {
      ...STUB_SWAP_TXN,
      status: 'settling',
    };
    const transactionRepo = makeTransactionRepo(txnWithSettling, STUB_SWAP_TXN);
    transactionRepo.findByIdempotencyKey.mockResolvedValue(txnWithSettling);
    const settlementRepo = makeSwapSettlementRepo();

    const svc = buildSwapService({ transactionRepo, settlementRepo });
    const result = await svc.settleSwap({
      reference: SWAP_IDEMPOTENCY_KEY,
      success: true,
      toAmount: '0',
    });

    expect(result.status).toBe('pending');
    expect(settlementRepo.settleSwapFinalizeAtomic).not.toHaveBeenCalled();
    expect(settlementRepo.settleSwapRefundAtomic).not.toHaveBeenCalled();
  });

  it('idempotent path: returns completed without re-settling', async () => {
    const completedTxn: TransactionRecord = {
      ...STUB_SWAP_TXN,
      status: 'completed',
    };
    const transactionRepo = makeTransactionRepo(completedTxn, STUB_SWAP_TXN);
    transactionRepo.findByIdempotencyKey.mockResolvedValue(completedTxn);
    const settlementRepo = makeSwapSettlementRepo();
    settlementRepo.findReceiptNumber.mockResolvedValue(STUB_RECEIPT_NUMBER);

    const svc = buildSwapService({ transactionRepo, settlementRepo });
    const result = await svc.settleSwap({
      reference: SWAP_IDEMPOTENCY_KEY,
      success: true,
      toAmount: '62500',
    });

    expect(result.status).toBe('completed');
    expect(result.receiptNumber).toBe(STUB_RECEIPT_NUMBER);
    expect(settlementRepo.settleSwapFinalizeAtomic).not.toHaveBeenCalled();
  });

  it('throws SettlementInvalidStatusError when txn is not settling or completed', async () => {
    const failedTxn: TransactionRecord = { ...STUB_SWAP_TXN, status: 'failed' };
    const transactionRepo = makeTransactionRepo(failedTxn, STUB_SWAP_TXN);
    transactionRepo.findByIdempotencyKey.mockResolvedValue(failedTxn);

    const svc = buildSwapService({ transactionRepo });
    await expect(
      svc.settleSwap({ reference: SWAP_IDEMPOTENCY_KEY, success: true }),
    ).rejects.toThrow(SettlementInvalidStatusError);
  });

  it('throws ProposalNotExecutableError when no transaction found for reference', async () => {
    const transactionRepo = makeTransactionRepo(null, STUB_SWAP_TXN);
    transactionRepo.findByIdempotencyKey.mockResolvedValue(null);

    const svc = buildSwapService({ transactionRepo });
    await expect(
      svc.settleSwap({ reference: 'nonexistent-key', success: true }),
    ).rejects.toThrow(ProposalNotExecutableError);
  });
});
