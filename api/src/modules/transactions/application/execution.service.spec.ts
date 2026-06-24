/**
 * Unit tests for ExecutionService.executeBuy (task 4.5a, CLAUDE.md §3.1).
 *
 * All external dependencies are mocked. Tests verify:
 *   1. Happy path — full gauntlet passes, Transaction created, outbox enqueued.
 *   2. Expired proposal → ProposalExpiredError, no Transaction created.
 *   3. Wrong owner / bad status → ProposalNotExecutableError.
 *   4. Drift exceeded → QuoteDriftError, no Transaction.
 *   5. KYC gate throws → propagates, no Transaction.
 *   6. Directive consume throws (replay) → propagates, PIN NOT checked after.
 *   7. PIN invalid → propagates, no collection/outbox.
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
import type { KycGateService } from '../../identity/application/kyc-gate.service';
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
import type { DirectiveService } from './directive.service';
import type { DirectiveGrantRecord } from './ports/directive.repository.port';
import { ExecutionService } from './execution.service';
import {
  ProposalExpiredError,
  ProposalNotExecutableError,
  QuoteDriftError,
  SettlementInvalidStatusError,
  InsufficientBalanceError,
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
  pinVerifiedAt: FIXED_NOW,
  createdAt: FIXED_NOW,
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
    findByIdempotencyKey: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockResolvedValue(created),
    createSettlingWithProposal: jest.fn().mockResolvedValue(created),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    mergeMetadata: jest.fn().mockResolvedValue(undefined),
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
      createdAt: FIXED_NOW,
    }),
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
  };
}

function makeQuotesService(
  quote: QuoteBuyOutput = FRESH_QUOTE,
): jest.Mocked<Pick<QuotesService, 'quoteBuy'>> {
  return { quoteBuy: jest.fn().mockResolvedValue(quote) };
}

function makeKycGate(
  throws?: Error,
): jest.Mocked<Pick<KycGateService, 'assertCanTransact'>> {
  const svc = {
    // Fix-C: fiatAmount is now a string (exact NGN decimal).
    assertCanTransact: jest.fn<
      Promise<void>,
      [{ userId: string; fiatAmount: string; asset: string }]
    >(),
  };
  if (throws) {
    svc.assertCanTransact.mockRejectedValue(throws);
  } else {
    svc.assertCanTransact.mockResolvedValue(undefined);
  }
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
  Pick<WalletService, 'getOrProvisionWallet'>
> {
  const walletRecord = {
    id: 'wallet-id',
    userId: USER_ID,
    asset: 'USDT',
    network: 'TRON',
    address: 'TTestAddress123',
    providerReference: 'blockradar-ref-001',
    status: 'active',
  };
  return {
    getOrProvisionWallet: jest.fn().mockResolvedValue(walletRecord),
  };
}

function makeWalletServiceWithWithdraw(
  providerReference = 'blockradar-tx-ref-001',
): jest.Mocked<Pick<WalletService, 'getOrProvisionWallet' | 'withdraw'>> {
  const walletRecord: WalletRecord = {
    id: 'wallet-id',
    userId: USER_ID,
    asset: 'USDT',
    network: 'TRON',
    address: 'TTestAddress123',
    providerReference: 'blockradar-ref-001',
    status: 'active',
  };
  return {
    getOrProvisionWallet: jest.fn().mockResolvedValue(walletRecord),
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

// Stub ConfigService (returns the buy/sell config values).
const stubConfig = {
  get: jest.fn((key: string) => {
    if (key === 'buy') return { maxDriftBps: 50 };
    if (key === 'sell') return { maxDriftBps: 50 };
    // pricing.assets.USDT.baseRate is required by executeSend's KYC-gate guard.
    if (key === 'pricing')
      return {
        assets: { USDT: { baseRate: 1600 }, BTC: { baseRate: 85_000_000 } },
      };
    return undefined;
  }),
};

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
    walletService?: jest.Mocked<Pick<WalletService, 'getOrProvisionWallet'>>;
    paymentProvider?: jest.Mocked<
      Pick<IPaymentProvider, 'createCollection' | 'verify'>
    >;
    assetRegistry?: jest.Mocked<AssetRegistry>;
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
    stubConfig as never,
    stubClock,
    overrides.assetRegistry ?? makeAssetRegistry(),
    // beneficiaryService stub (sell tests override via buildSellService helper)
    { getById: jest.fn().mockResolvedValue(null) } as never,
    // ledgerRepo stub
    { getAccountBalance: jest.fn().mockResolvedValue('100') },
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

    // Wallet was provisioned via generic method with asset/network from registry.
    expect(walletService.getOrProvisionWallet).toHaveBeenCalledWith(
      USER_ID,
      'USDT',
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
    // Directive comes before PIN.
    expect(callOrder.indexOf('directive')).toBeLessThan(
      callOrder.indexOf('pin'),
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

  it('directive consume throws replay → propagates; PIN NOT called; no Transaction', async () => {
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
    // PIN must NOT be called after directive failure.
    expect(pinService.verifyPin).not.toHaveBeenCalled();
    expect(transactionRepo.createSettlingWithProposal).not.toHaveBeenCalled();
  });

  // ── PIN invalid ───────────────────────────────────────────────────────────

  it('PIN invalid → propagates; no collection/outbox created', async () => {
    const pinError = new PinInvalidError(4);
    const paymentProvider = makePaymentProvider();
    const outboxRepo = makeOutboxRepo();
    const transactionRepo = makeTransactionRepo();

    const svc = buildService({
      pinService: makePinService(pinError),
      paymentProvider,
      outboxRepo,
      transactionRepo,
    });

    await expect(svc.executeBuy(BASE_INPUT)).rejects.toBeInstanceOf(
      PinInvalidError,
    );
    expect(paymentProvider.createCollection).not.toHaveBeenCalled();
    expect(outboxRepo.create).not.toHaveBeenCalled();
    expect(transactionRepo.createSettlingWithProposal).not.toHaveBeenCalled();
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
  Pick<WalletService, 'getOrProvisionWallet'>
> {
  return {
    getOrProvisionWallet: jest.fn().mockResolvedValue(WALLET_RECORD),
  };
}

// Stub that also returns a transactionId on findByIdempotencyKey
function makeTransactionRepoForSettle(
  txn: TransactionRecord | null = SETTLING_TXN,
): jest.Mocked<ITransactionRepository> {
  return {
    findByIdempotencyKey: jest.fn().mockResolvedValue(txn),
    create: jest.fn().mockResolvedValue(SETTLING_TXN),
    createSettlingWithProposal: jest.fn().mockResolvedValue(SETTLING_TXN),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    mergeMetadata: jest.fn().mockResolvedValue(undefined),
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

    // wallet provisioned via generic method with asset/network from registry.
    expect(walletService.getOrProvisionWallet).toHaveBeenCalledWith(
      USER_ID,
      'USDT',
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
    beneficiaryId: BENEFICIARY_ID,
    walletId: 'wallet-id',
    providerRef: PROVIDER_REF,
  },
  processorTxRef: null,
  pinVerifiedAt: FIXED_NOW,
  createdAt: FIXED_NOW,
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
} {
  return {
    getAccountBalance: jest.fn().mockResolvedValue(balance),
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
    walletService?: jest.Mocked<Pick<WalletService, 'getOrProvisionWallet'>>;
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
    expect(pinService.verifyPin).not.toHaveBeenCalled();
  });

  // ── PIN invalid ───────────────────────────────────────────────────────────

  it('wrong PIN → PinInvalidError, no collection/outbox', async () => {
    const pinService = makePinService(new PinInvalidError(4));
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      STUB_SELL_TXN,
    );
    const outboxRepo = makeOutboxRepo();

    const svc = buildSellService({ pinService, settlementRepo, outboxRepo });

    await expect(svc.executeSell(SELL_BASE_INPUT)).rejects.toBeInstanceOf(
      PinInvalidError,
    );
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

  it('asserts balance-check → directive.consume → pin.verify → idempotency → atomic create, in order', async () => {
    const callOrder: string[] = [];

    const ledgerRepo = {
      getAccountBalance: jest.fn().mockImplementation(() => {
        callOrder.push('balance_check');
        return Promise.resolve('100');
      }),
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
      callOrder.indexOf('directive'),
    );
    expect(callOrder.indexOf('directive')).toBeLessThan(
      callOrder.indexOf('pin'),
    );
    expect(callOrder.indexOf('pin')).toBeLessThan(
      callOrder.indexOf('idempotency'),
    );
    expect(callOrder.indexOf('idempotency')).toBeLessThan(
      callOrder.indexOf('atomic_create'),
    );
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
    findByIdempotencyKey: jest.fn().mockResolvedValue(txn),
    create: jest.fn(),
    createSettlingWithProposal: jest.fn(),
    updateStatus: jest.fn(),
    mergeMetadata: jest.fn().mockResolvedValue(undefined),
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
  },
  processorTxRef: null,
  pinVerifiedAt: FIXED_NOW,
  createdAt: FIXED_NOW,
};

const STUB_CRYPTO_BENEFICIARY: BeneficiaryRecord = {
  id: BENEFICIARY_ID,
  userId: USER_ID,
  type: 'crypto_address',
  label: 'My TRON Wallet',
  accountNumber: null,
  accountHolderName: null,
  bankCode: null,
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
    findByIdempotencyKey: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockResolvedValue(created),
    createSettlingWithProposal: jest.fn().mockResolvedValue(created),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    mergeMetadata: jest.fn().mockResolvedValue(undefined),
  };
}

function buildSendService(
  overrides: {
    proposalRepo?: jest.Mocked<IProposalRepository>;
    transactionRepo?: jest.Mocked<ITransactionRepository>;
    outboxRepo?: jest.Mocked<ISettlementOutboxRepository>;
    settlementRepo?: jest.Mocked<ISettlementRepository>;
    kycGate?: jest.Mocked<Pick<KycGateService, 'assertCanTransact'>>;
    directiveService?: jest.Mocked<Pick<DirectiveService, 'consume'>>;
    pinService?: jest.Mocked<Pick<PinService, 'verifyPin'>>;
    walletService?: jest.Mocked<
      Pick<WalletService, 'getOrProvisionWallet' | 'withdraw'>
    >;
    beneficiaryService?: ReturnType<typeof makeBeneficiaryServiceForSend>;
    ledgerRepo?: ReturnType<typeof makeLedgerRepo>;
    identityService?: ReturnType<typeof makeIdentityService>;
    whatsAppSender?: ReturnType<typeof makeWhatsAppSender>;
    complianceService?: ReturnType<typeof makeComplianceService>;
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

  it('wrong PIN → PinInvalidError, no Transaction, no withdraw', async () => {
    const pinService = makePinService(new PinInvalidError(4));
    const walletService = makeWalletServiceWithWithdraw();
    const settlementRepo = makeSettlementRepo(
      null,
      { receiptNumber: STUB_RECEIPT_NUMBER },
      undefined,
      STUB_SEND_TXN,
    );

    const svc = buildSendService({ pinService, walletService, settlementRepo });

    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toBeInstanceOf(
      PinInvalidError,
    );
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
      zeroRateConfig as never,
      stubClock,
      makeAssetRegistry(),
      makeBeneficiaryServiceForSend() as never,
      makeLedgerRepo('100'),
      makeIdentityService() as never,
      makeWhatsAppSender() as never,
      makeComplianceService() as never,
    );

    // Should throw a config error — must NOT silently proceed with fiatAmount=0.
    await expect(svc.executeSend(SEND_BASE_INPUT)).rejects.toThrow(/baseRate/i);
    expect(
      defaultSettlementRepo.createSendSettlingWithReserveAtomic,
    ).not.toHaveBeenCalled();
  });

  // ── Gauntlet order ─────────────────────────────────────────────────────────

  it('gauntlet order: balance→cooling-off→sanctions→directive→pin→idempotency→atomic', async () => {
    const callOrder: string[] = [];

    const ledgerRepo = {
      getAccountBalance: jest.fn().mockImplementation(() => {
        callOrder.push('balance');
        return Promise.resolve('100');
      }),
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
      callOrder.indexOf('directive'),
    );
    expect(callOrder.indexOf('directive')).toBeLessThan(
      callOrder.indexOf('pin'),
    );
    expect(callOrder.indexOf('pin')).toBeLessThan(
      callOrder.indexOf('idempotency'),
    );
    expect(callOrder.indexOf('idempotency')).toBeLessThan(
      callOrder.indexOf('atomic_create'),
    );
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
    findByIdempotencyKey: jest.fn().mockResolvedValue(txn),
    create: jest.fn(),
    createSettlingWithProposal: jest.fn(),
    updateStatus: jest.fn(),
    mergeMetadata: jest.fn().mockResolvedValue(undefined),
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
