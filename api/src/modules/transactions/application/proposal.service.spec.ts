/**
 * Unit tests for ProposalService (task 4.1 + task S4a).
 *
 * All external dependencies are mocked:
 *   - QuotesService        → mock returning a fixed QuoteBuyOutput / QuoteSellOutput
 *   - KycGateService       → mock that resolves by default
 *   - QUOTE_REPOSITORY     → mock IQuoteRepository
 *   - PROPOSAL_REPOSITORY  → mock IProposalRepository
 *   - CLOCK                → stub returning a fixed Date
 *   - WalletService        → mock returning a fixed WalletRecord
 *   - BeneficiaryService   → mock returning a fixed BeneficiaryRecord
 *   - AssetRegistry        → mock returning 'TRON' for defaultNetworkFor
 *   - ILedgerRepository    → mock returning a fixed balance string
 *
 * TDD: tests written first (red), then ProposalService is implemented.
 */

import type {
  QuoteBuyOutput,
  QuoteSellOutput,
} from '@handshake-agent/contracts';
import {
  BuyProposalConfirmationSchema,
  SellProposalConfirmationSchema,
} from '@handshake-agent/contracts';

import type { Clock } from '../../../core/common/clock';
import type { QuotesService } from '../../quotes/application/quotes.service';
import type { KycGateService } from '../../identity/application/kyc-gate.service';
import type { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import type { WalletService } from '../../wallets/application/wallet.service';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { IQuoteRepository } from './ports/quote.repository.port';
import type {
  IProposalRepository,
  CreateProposalData,
} from './ports/proposal.repository.port';
import type { ILedgerRepository } from './ports/ledger.repository.port';
import { ProposalService } from './proposal.service';
import { InsufficientBalanceError } from '../domain/execution-errors';
import { BeneficiaryNotFoundError } from '../../beneficiaries/domain/beneficiary-errors';

// ---------------------------------------------------------------------------
// Fixed test values
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2024-06-01T12:00:00.000Z');
const FIXED_QUOTE_ID = 'aaaaaaaa-0000-7000-8000-000000000001';
const FIXED_PROPOSAL_ID = 'bbbbbbbb-0000-7000-8000-000000000002';

const STUB_QUOTE: QuoteBuyOutput = {
  asset: 'USDT',
  fiatAmount: '10000',
  fiatCurrency: 'NGN',
  cryptoAmount: '6.123456',
  // Raw pre-spread market rate (distinct from fxRate which is effective).
  baseRate: '1600',
  fxRate: '1600.123456',
  spreadBps: 100,
  processingFeeBps: 50,
  quotedAt: FIXED_NOW.toISOString(),
  expiresInSec: 60,
};

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeQuotesService(
  quote = STUB_QUOTE,
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

function makeQuoteRepo(id = FIXED_QUOTE_ID): jest.Mocked<IQuoteRepository> {
  return {
    create: jest.fn().mockResolvedValue({ id }),
    findById: jest.fn().mockResolvedValue(null),
  };
}

function makeProposalRepo(
  id = FIXED_PROPOSAL_ID,
): jest.Mocked<IProposalRepository> {
  return {
    create: jest.fn().mockResolvedValue({ id }),
    findById: jest.fn().mockResolvedValue(null),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  };
}

const stubClock: Clock = { now: () => FIXED_NOW };

// ---------------------------------------------------------------------------
// Sell-related stubs (S4a)
// ---------------------------------------------------------------------------

const FIXED_SELL_QUOTE_ID = 'cccccccc-0000-7000-8000-000000000003';
const FIXED_SELL_PROPOSAL_ID = 'dddddddd-0000-7000-8000-000000000004';
const FIXED_WALLET_ID = 'wallet-eeeeeeee-0000-7000-8000-000000000005';
const FIXED_BENEFICIARY_ID = 'ben-ffffffff-0000-7000-8000-000000000006';

const STUB_SELL_QUOTE: QuoteSellOutput = {
  asset: 'USDT',
  cryptoAmount: '5.0',
  fiatCurrency: 'NGN',
  netFiatAmount: '7500',
  baseRate: '1600',
  fxRate: '1550',
  spreadBps: 312,
  processingFeeBps: 50,
  processingFeeAmount: '40.00',
  quotedAt: FIXED_NOW.toISOString(),
  expiresInSec: 60,
};

const STUB_WALLET_RECORD = {
  id: FIXED_WALLET_ID,
  userId: 'user-id-1',
  asset: 'USDT',
  network: 'TRON',
  address: 'TFakeAddressForTests12345678',
  providerReference: 'br_fake_ref',
  status: 'active',
};

const STUB_BENEFICIARY_RECORD = {
  id: FIXED_BENEFICIARY_ID,
  userId: 'user-id-1',
  type: 'bank_account' as const,
  label: 'My GTBank',
  accountNumber: '0012345678',
  accountHolderName: 'Test User',
  bankCode: '058',
  cryptoAddress: null,
  cryptoAsset: null,
  cryptoNetwork: null,
  verificationStatus: 'verified',
  firstUseLockedUntil: null,
  verifiedAt: new Date(FIXED_NOW.getTime() - 86400_000),
  isDefault: true,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
  deletedAt: null,
};

function makeWalletService(
  wallet = STUB_WALLET_RECORD,
): jest.Mocked<Pick<WalletService, 'getOrProvisionWallet'>> {
  return {
    getOrProvisionWallet: jest.fn().mockResolvedValue(wallet),
  };
}

function makeBeneficiaryService(
  record: typeof STUB_BENEFICIARY_RECORD | null = STUB_BENEFICIARY_RECORD,
): jest.Mocked<Pick<BeneficiaryService, 'getById'>> {
  return {
    getById: jest.fn().mockResolvedValue(record),
  };
}

function makeAssetRegistry(
  network = 'TRON',
): jest.Mocked<Pick<AssetRegistry, 'defaultNetworkFor'>> {
  return {
    defaultNetworkFor: jest.fn().mockReturnValue(network),
  };
}

function makeLedgerRepo(balance = '10.0'): jest.Mocked<ILedgerRepository> {
  return {
    getAccountBalance: jest.fn().mockResolvedValue(balance),
  };
}

// ---------------------------------------------------------------------------
// Factory helpers — buy
// ---------------------------------------------------------------------------

/**
 * Creates a ProposalService wired for buy-proposal tests.
 * Sell-related deps (walletService, beneficiaryService, assetRegistry, ledgerRepo)
 * are minimal null-stubs because `createBuyProposal` never calls them.
 */
function makeBuySvc(
  quotesService: QuotesService = makeQuotesService() as unknown as QuotesService,
  kycGate: KycGateService = makeKycGate() as unknown as KycGateService,
  quoteRepo: IQuoteRepository = makeQuoteRepo(),
  proposalRepo: IProposalRepository = makeProposalRepo(),
): ProposalService {
  return new ProposalService(
    quotesService,
    kycGate,
    quoteRepo,
    proposalRepo,
    stubClock,
    makeWalletService() as unknown as WalletService,
    makeBeneficiaryService() as unknown as BeneficiaryService,
    makeAssetRegistry() as unknown as AssetRegistry,
    makeLedgerRepo(),
  );
}

/**
 * Creates a ProposalService wired for sell-proposal tests.
 */
function makeSellSvc(opts?: {
  quotesService?: Pick<QuotesService, 'quoteBuy' | 'quoteSell'>;
  kycGate?: Pick<KycGateService, 'assertCanTransact'>;
  quoteRepo?: IQuoteRepository;
  proposalRepo?: IProposalRepository;
  walletService?: Pick<WalletService, 'getOrProvisionWallet'>;
  beneficiaryService?: Pick<BeneficiaryService, 'getById'>;
  assetRegistry?: Pick<AssetRegistry, 'defaultNetworkFor'>;
  ledgerRepo?: ILedgerRepository;
}): ProposalService {
  return new ProposalService(
    (opts?.quotesService ?? {
      quoteBuy: jest.fn(),
      quoteSell: jest.fn().mockResolvedValue(STUB_SELL_QUOTE),
    }) as unknown as QuotesService,
    (opts?.kycGate ?? makeKycGate()) as unknown as KycGateService,
    opts?.quoteRepo ?? makeQuoteRepo(FIXED_SELL_QUOTE_ID),
    opts?.proposalRepo ?? makeProposalRepo(FIXED_SELL_PROPOSAL_ID),
    stubClock,
    (opts?.walletService ?? makeWalletService()) as unknown as WalletService,
    (opts?.beneficiaryService ??
      makeBeneficiaryService()) as unknown as BeneficiaryService,
    (opts?.assetRegistry ?? makeAssetRegistry()) as unknown as AssetRegistry,
    opts?.ledgerRepo ?? makeLedgerRepo(),
  );
}

const BASE_INPUT = {
  userId: 'user-id-1',
  conversationId: 'conv-id-1',
  intent: {
    action: 'buy_crypto' as const,
    asset: 'USDT' as const,
    fiatAmount: '10000',
    fiatCurrency: 'NGN' as const,
  },
};

const BASE_SELL_INPUT = {
  userId: 'user-id-1',
  conversationId: 'conv-id-1',
  intent: {
    action: 'sell_crypto' as const,
    asset: 'USDT' as const,
    cryptoAmount: '5.0',
    fiatCurrency: 'NGN' as const,
  },
  beneficiaryId: FIXED_BENEFICIARY_ID,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProposalService.createBuyProposal', () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns proposalId, quoteId, and a valid BuyProposalConfirmation', async () => {
    const svc = makeBuySvc();
    const result = await svc.createBuyProposal(BASE_INPUT);

    expect(result.quoteId).toBe(FIXED_QUOTE_ID);
    expect(result.proposalId).toBe(FIXED_PROPOSAL_ID);
    expect(result.confirmation.proposalId).toBe(FIXED_PROPOSAL_ID);
    expect(result.confirmation.asset).toBe('USDT');
    expect(result.confirmation.fiatAmount).toBe('10000');
    expect(result.confirmation.fiatCurrency).toBe('NGN');
    expect(result.confirmation.cryptoAmount).toBe('6.123456');
    expect(result.confirmation.fxRate).toBe('1600.123456');
    expect(result.confirmation.spreadBps).toBe(100);
    expect(result.confirmation.processingFeeBps).toBe(50);
  });

  it('processingFeeAmount = fiatAmount * processingFeeBps / 10000 (string, 2dp)', async () => {
    // 10000 * 50bps / 10000 = 50.00 (50 basis points = 0.5%)
    const svc = makeBuySvc();
    const result = await svc.createBuyProposal(BASE_INPUT);
    // 10000 * 50 / 10000 = 50.00
    expect(result.confirmation.processingFeeAmount).toBe('50.00');
  });

  it('totalFiat = fiatAmount + processingFeeAmount (string)', async () => {
    // 10000 + 50.00 = 10050.00
    const svc = makeBuySvc();
    const result = await svc.createBuyProposal(BASE_INPUT);
    expect(result.confirmation.totalFiat).toBe('10050.00');
  });

  it('expiresAt is now + expiresInSec as an ISO datetime string', async () => {
    const svc = makeBuySvc();
    const result = await svc.createBuyProposal(BASE_INPUT);
    // FIXED_NOW + 60 seconds
    const expectedExpiry = new Date(FIXED_NOW.getTime() + 60_000).toISOString();
    expect(result.confirmation.expiresAt).toBe(expectedExpiry);
  });

  it('persists the Quote row before the Proposal row', async () => {
    const callOrder: string[] = [];
    const quoteRepo: IQuoteRepository = {
      create: jest.fn().mockImplementation(() => {
        callOrder.push('quote');
        return Promise.resolve({ id: FIXED_QUOTE_ID });
      }),
      findById: jest.fn().mockResolvedValue(null),
    };
    const proposalRepo: IProposalRepository = {
      create: jest.fn().mockImplementation(() => {
        callOrder.push('proposal');
        return Promise.resolve({ id: FIXED_PROPOSAL_ID });
      }),
      findById: jest.fn().mockResolvedValue(null),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };

    const svc = makeBuySvc(
      makeQuotesService() as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      quoteRepo,
      proposalRepo,
    );

    await svc.createBuyProposal(BASE_INPUT);
    expect(callOrder).toEqual(['quote', 'proposal']);
  });

  it('parametersChecksum is a 64-character hex string', async () => {
    // Capture what is passed to proposalRepo.create to inspect the checksum.
    const proposalRepo = makeProposalRepo();
    const svc = makeBuySvc(
      makeQuotesService() as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      makeQuoteRepo(),
      proposalRepo,
    );

    await svc.createBuyProposal(BASE_INPUT);

    const calls = (
      proposalRepo.create as jest.Mock<
        Promise<{ id: string }>,
        [CreateProposalData]
      >
    ).mock.calls;
    const createArg = calls[0][0];
    expect(createArg.parametersChecksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('confirmation parses cleanly against BuyProposalConfirmationSchema', async () => {
    const svc = makeBuySvc();
    const result = await svc.createBuyProposal(BASE_INPUT);
    expect(() =>
      BuyProposalConfirmationSchema.parse(result.confirmation),
    ).not.toThrow();
  });

  // ── KYC gate failure ─────────────────────────────────────────────────────

  it('propagates KYC gate error and does NOT persist a Proposal', async () => {
    const gateError = new Error('KYC_NOT_VERIFIED');
    const kycGate = makeKycGate(gateError);
    const quoteRepo = makeQuoteRepo();
    const proposalRepo = makeProposalRepo();

    const svc = makeBuySvc(
      makeQuotesService() as unknown as QuotesService,
      kycGate as unknown as KycGateService,
      quoteRepo,
      proposalRepo,
    );

    await expect(svc.createBuyProposal(BASE_INPUT)).rejects.toThrow(
      'KYC_NOT_VERIFIED',
    );
    // Quote snapshot is always persisted (pricing record), Proposal is not.
    expect(quoteRepo.create).toHaveBeenCalledTimes(1);
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  it('persists the Quote row with raw baseRate (pre-spread) distinct from effective fxRate', async () => {
    const quoteRepo = makeQuoteRepo();
    const svc = makeBuySvc(
      makeQuotesService() as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      quoteRepo,
      makeProposalRepo(),
    );

    await svc.createBuyProposal(BASE_INPUT);

    const createArg = (
      quoteRepo.create as jest.Mock<
        Promise<{ id: string }>,
        [Parameters<IQuoteRepository['create']>[0]]
      >
    ).mock.calls[0][0];
    // baseRate must be the raw pre-spread rate from the quote, NOT fxRate.
    expect(createArg.baseRate).toBe(STUB_QUOTE.baseRate);
    expect(createArg.fxRate).toBe(STUB_QUOTE.fxRate);
    expect(createArg.baseRate).not.toBe(createArg.fxRate);
  });

  it('KYC gate is called AFTER the Quote is persisted but BEFORE the Proposal is persisted', async () => {
    const callOrder: string[] = [];
    const quoteRepo: IQuoteRepository = {
      create: jest.fn().mockImplementation(() => {
        callOrder.push('quote');
        return Promise.resolve({ id: FIXED_QUOTE_ID });
      }),
      findById: jest.fn().mockResolvedValue(null),
    };
    const proposalRepo: IProposalRepository = {
      create: jest.fn().mockImplementation(() => {
        callOrder.push('proposal');
        return Promise.resolve({ id: FIXED_PROPOSAL_ID });
      }),
      findById: jest.fn().mockResolvedValue(null),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };
    const kycGate = {
      assertCanTransact: jest.fn().mockImplementation(() => {
        callOrder.push('kyc');
        return Promise.resolve();
      }),
    };

    const svc = makeBuySvc(
      makeQuotesService() as unknown as QuotesService,
      kycGate as unknown as KycGateService,
      quoteRepo,
      proposalRepo,
    );

    await svc.createBuyProposal(BASE_INPUT);
    expect(callOrder).toEqual(['quote', 'kyc', 'proposal']);
  });

  // ── conversationId is optional ────────────────────────────────────────────

  it('works without conversationId', async () => {
    const svc = makeBuySvc();
    const input = { userId: 'user-id-1', intent: BASE_INPUT.intent };
    await expect(svc.createBuyProposal(input)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// ProposalService.createSellProposal (task S4a)
// ---------------------------------------------------------------------------

describe('ProposalService.createSellProposal', () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns proposalId, quoteId, and a valid SellProposalConfirmation', async () => {
    const svc = makeSellSvc();
    const result = await svc.createSellProposal(BASE_SELL_INPUT);

    expect(result.quoteId).toBe(FIXED_SELL_QUOTE_ID);
    expect(result.proposalId).toBe(FIXED_SELL_PROPOSAL_ID);
    expect(result.confirmation.proposalId).toBe(FIXED_SELL_PROPOSAL_ID);
    expect(result.confirmation.asset).toBe('USDT');
    expect(result.confirmation.cryptoAmount).toBe('5.0');
    expect(result.confirmation.fiatCurrency).toBe('NGN');
    expect(result.confirmation.netFiatAmount).toBe('7500');
    expect(result.confirmation.fxRate).toBe('1550');
    expect(result.confirmation.processingFeeAmount).toBe('40.00');
  });

  it('confirmation parses cleanly against SellProposalConfirmationSchema', async () => {
    const svc = makeSellSvc();
    const result = await svc.createSellProposal(BASE_SELL_INPUT);
    expect(() =>
      SellProposalConfirmationSchema.parse(result.confirmation),
    ).not.toThrow();
  });

  it('expiresAt is now + expiresInSec as an ISO datetime string', async () => {
    const svc = makeSellSvc();
    const result = await svc.createSellProposal(BASE_SELL_INPUT);
    const expectedExpiry = new Date(FIXED_NOW.getTime() + 60_000).toISOString();
    expect(result.confirmation.expiresAt).toBe(expectedExpiry);
  });

  it('includes beneficiaryLabel from the beneficiary record', async () => {
    const svc = makeSellSvc();
    const result = await svc.createSellProposal(BASE_SELL_INPUT);
    // STUB_BENEFICIARY_RECORD.label is 'My GTBank'
    expect(result.confirmation.beneficiaryLabel).toBe('My GTBank');
  });

  it('persists a sell Proposal row (type=sell, status=pending)', async () => {
    const proposalRepo = makeProposalRepo(FIXED_SELL_PROPOSAL_ID);
    const svc = makeSellSvc({ proposalRepo });

    await svc.createSellProposal(BASE_SELL_INPUT);

    const createArg = (
      proposalRepo.create as jest.Mock<
        Promise<{ id: string }>,
        [CreateProposalData]
      >
    ).mock.calls[0][0];
    expect(createArg.type).toBe('sell');
    expect(createArg.parametersChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(createArg.parameters).toMatchObject({
      asset: 'USDT',
      cryptoAmount: '5.0',
      fiatCurrency: 'NGN',
      beneficiaryId: FIXED_BENEFICIARY_ID,
      walletId: FIXED_WALLET_ID,
    });
  });

  it('persists a sell Quote row (type=sell)', async () => {
    const quoteRepo = makeQuoteRepo(FIXED_SELL_QUOTE_ID);
    const svc = makeSellSvc({ quoteRepo });

    await svc.createSellProposal(BASE_SELL_INPUT);

    const createArg = (
      quoteRepo.create as jest.Mock<
        Promise<{ id: string }>,
        [Parameters<IQuoteRepository['create']>[0]]
      >
    ).mock.calls[0][0];
    expect(createArg.type).toBe('sell');
    expect(createArg.asset).toBe('USDT');
    expect(createArg.cryptoAmount).toBe('5.0');
  });

  // ── Insufficient balance ──────────────────────────────────────────────────

  it('throws InsufficientBalanceError when ledger balance < cryptoAmount', async () => {
    const ledgerRepo = makeLedgerRepo('2.5'); // balance 2.5 < requested 5.0
    const svc = makeSellSvc({ ledgerRepo });

    await expect(svc.createSellProposal(BASE_SELL_INPUT)).rejects.toThrow(
      InsufficientBalanceError,
    );
  });

  it('does NOT persist any row when balance is insufficient', async () => {
    const ledgerRepo = makeLedgerRepo('0');
    const quoteRepo = makeQuoteRepo(FIXED_SELL_QUOTE_ID);
    const proposalRepo = makeProposalRepo(FIXED_SELL_PROPOSAL_ID);
    const svc = makeSellSvc({ ledgerRepo, quoteRepo, proposalRepo });

    await expect(svc.createSellProposal(BASE_SELL_INPUT)).rejects.toThrow(
      InsufficientBalanceError,
    );
    expect(quoteRepo.create).not.toHaveBeenCalled();
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  // ── KYC gate failure ──────────────────────────────────────────────────────

  it('propagates KYC gate error and does NOT persist a Proposal', async () => {
    const kycGate = makeKycGate(new Error('KYC_NOT_VERIFIED'));
    const proposalRepo = makeProposalRepo(FIXED_SELL_PROPOSAL_ID);
    const svc = makeSellSvc({
      kycGate,
      proposalRepo,
    });

    await expect(svc.createSellProposal(BASE_SELL_INPUT)).rejects.toThrow(
      'KYC_NOT_VERIFIED',
    );
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  // ── Unknown beneficiary ───────────────────────────────────────────────────

  it('throws BeneficiaryNotFoundError when beneficiary is not found', async () => {
    const beneficiaryService = makeBeneficiaryService(null);
    const svc = makeSellSvc({ beneficiaryService });

    await expect(svc.createSellProposal(BASE_SELL_INPUT)).rejects.toThrow(
      BeneficiaryNotFoundError,
    );
  });

  it('does NOT persist any row when beneficiary is not found', async () => {
    const beneficiaryService = makeBeneficiaryService(null);
    const proposalRepo = makeProposalRepo(FIXED_SELL_PROPOSAL_ID);
    const quoteRepo = makeQuoteRepo(FIXED_SELL_QUOTE_ID);
    const svc = makeSellSvc({
      beneficiaryService,
      proposalRepo,
      quoteRepo,
    });

    await expect(svc.createSellProposal(BASE_SELL_INPUT)).rejects.toThrow(
      BeneficiaryNotFoundError,
    );
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  // ── Order: balance + gate + beneficiary BEFORE persisting ─────────────────

  it('calls balance check, gate, and beneficiary BEFORE persisting (order invariant)', async () => {
    const callOrder: string[] = [];

    const ledgerRepo: ILedgerRepository = {
      getAccountBalance: jest.fn().mockImplementation(() => {
        callOrder.push('balance');
        return Promise.resolve('100.0');
      }),
    };
    const kycGateOrdered = {
      assertCanTransact: jest.fn().mockImplementation(() => {
        callOrder.push('gate');
        return Promise.resolve();
      }),
    };
    const beneficiaryService = {
      getById: jest.fn().mockImplementation(() => {
        callOrder.push('beneficiary');
        return Promise.resolve(STUB_BENEFICIARY_RECORD);
      }),
    };
    const quoteRepo: IQuoteRepository = {
      create: jest.fn().mockImplementation(() => {
        callOrder.push('quoteRepo');
        return Promise.resolve({ id: FIXED_SELL_QUOTE_ID });
      }),
      findById: jest.fn().mockResolvedValue(null),
    };
    const proposalRepo: IProposalRepository = {
      create: jest.fn().mockImplementation(() => {
        callOrder.push('proposalRepo');
        return Promise.resolve({ id: FIXED_SELL_PROPOSAL_ID });
      }),
      findById: jest.fn().mockResolvedValue(null),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };

    const svc = makeSellSvc({
      ledgerRepo,
      kycGate: kycGateOrdered,
      beneficiaryService,
      quoteRepo,
      proposalRepo,
    });

    await svc.createSellProposal(BASE_SELL_INPUT);

    // balance + gate + beneficiary must ALL come before quoteRepo and proposalRepo
    const balIdx = callOrder.indexOf('balance');
    const gateIdx = callOrder.indexOf('gate');
    const benIdx = callOrder.indexOf('beneficiary');
    const quoteIdx = callOrder.indexOf('quoteRepo');
    const propIdx = callOrder.indexOf('proposalRepo');

    expect(balIdx).toBeLessThan(quoteIdx);
    expect(gateIdx).toBeLessThan(quoteIdx);
    expect(benIdx).toBeLessThan(propIdx);
    expect(quoteIdx).toBeLessThan(propIdx);
  });
});
