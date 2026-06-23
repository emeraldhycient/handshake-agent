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

import type { QuoteBuyOutput } from '@handshake-agent/contracts';

import type { Clock } from '../../../core/common/clock';
import type { PinService } from '../../../core/auth/pin.service';
import type { KycGateService } from '../../identity/application/kyc-gate.service';
import type { QuotesService } from '../../quotes/application/quotes.service';
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
} from '../domain/execution-errors';
import { DirectiveReplayError } from '../domain/directive-errors';
import { PinInvalidError } from '../../../core/auth/domain/pin-errors';
import type {
  ISettlementRepository,
  SettleBuyAtomicOutput,
} from './ports/settlement.repository.port';

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
): jest.Mocked<ISettlementRepository> {
  return {
    findReceiptNumber: jest.fn().mockResolvedValue(receiptNumber),
    settleBuyAtomic: jest.fn().mockResolvedValue(atomicOutput),
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
    assertCanTransact: jest.fn<
      Promise<void>,
      [{ userId: string; fiatAmount: number; asset: string }]
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
  Pick<WalletService, 'getOrProvisionUsdtTronWallet'>
> {
  return {
    getOrProvisionUsdtTronWallet: jest.fn().mockResolvedValue({
      id: 'wallet-id',
      userId: USER_ID,
      asset: 'USDT',
      network: 'TRON',
      address: 'TTestAddress123',
      providerReference: 'blockradar-ref-001',
      status: 'active',
    }),
  };
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

// Stub ConfigService (returns the buy config value).
const stubConfig = {
  get: jest.fn((key: string) => {
    if (key === 'buy') return { maxDriftBps: 50 };
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
    walletService?: jest.Mocked<
      Pick<WalletService, 'getOrProvisionUsdtTronWallet'>
    >;
    paymentProvider?: jest.Mocked<
      Pick<IPaymentProvider, 'createCollection' | 'verify'>
    >;
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

    // Wallet was provisioned.
    expect(walletService.getOrProvisionUsdtTronWallet).toHaveBeenCalledWith(
      USER_ID,
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
  Pick<WalletService, 'getOrProvisionUsdtTronWallet'>
> {
  return {
    getOrProvisionUsdtTronWallet: jest.fn().mockResolvedValue(WALLET_RECORD),
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

    // wallet provisioned.
    expect(walletService.getOrProvisionUsdtTronWallet).toHaveBeenCalledWith(
      USER_ID,
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
