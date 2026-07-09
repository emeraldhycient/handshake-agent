/**
 * Unit tests for ProposalService (task 4.1 + task S4a + task N3a).
 *
 * All external dependencies are mocked:
 *   - QuotesService        → mock returning a fixed QuoteBuyOutput / QuoteSellOutput / QuoteSendOutput
 *   - KycGateService       → mock that resolves by default
 *   - QUOTE_REPOSITORY     → mock IQuoteRepository
 *   - PROPOSAL_REPOSITORY  → mock IProposalRepository
 *   - CLOCK                → stub returning a fixed Date
 *   - WalletService        → mock returning a fixed WalletRecord
 *   - BeneficiaryService   → mock returning a fixed BeneficiaryRecord
 *   - AssetRegistry        → mock returning 'TRON' for defaultNetworkFor + validateAddress
 *   - ILedgerRepository    → mock returning a fixed balance string
 *   - ComplianceService    → mock returning passed: true by default
 *   - ConfigService        → stub returning compliance/pricing config
 *
 * TDD: tests written first (red), then ProposalService is implemented.
 */

import type {
  QuoteBuyOutput,
  QuoteSellOutput,
  QuoteSendOutput,
} from '@handshake-agent/contracts';
import {
  BuyProposalConfirmationSchema,
  SellProposalConfirmationSchema,
  SendProposalConfirmationSchema,
  SwapProposalConfirmationSchema,
} from '@handshake-agent/contracts';

import type { Clock } from '../../../core/common/clock';
import type { QuotesService } from '../../quotes/application/quotes.service';
import type { KycGateService } from '../../identity/application/kyc-gate.service';
import type { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import type { WalletService } from '../../wallets/application/wallet.service';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { ComplianceService } from '../../compliance/application/compliance.service';
import type { IQuoteRepository } from './ports/quote.repository.port';
import type {
  IProposalRepository,
  CreateProposalData,
} from './ports/proposal.repository.port';
import type { ILedgerRepository } from './ports/ledger.repository.port';
import { ProposalService } from './proposal.service';
import {
  InsufficientBalanceError,
  BaseRateMisconfiguredError,
  SwapSameAssetError,
} from '../domain/execution-errors';
import {
  AmountTooSmallError,
  SelfSendError,
} from '../domain/amount-guard-errors';
import {
  BeneficiaryNotFoundError,
  BeneficiaryWrongTypeError,
  BeneficiaryCurrencyMismatchError,
  BeneficiaryCoolingOffError,
} from '../../beneficiaries/domain/beneficiary-errors';
import { SanctionsBlockedError } from '../../compliance/domain/compliance-errors';

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
    // Fix-C: fiatAmount is now a string (exact NGN decimal).
    assertCanTransact: jest.fn<
      Promise<void>,
      [
        {
          userId: string;
          fiatAmount: string;
          fiatCurrency: string;
          asset: string;
        },
      ]
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
    getType: jest.fn().mockResolvedValue(null),
    listPendingForUser: jest.fn().mockResolvedValue([]),
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
  payoutCurrency: 'NGN',
  bankCountry: 'NG',
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
): jest.Mocked<Pick<WalletService, 'getOrProvisionNetworkWallet'>> {
  return {
    getOrProvisionNetworkWallet: jest.fn().mockResolvedValue(wallet),
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

// ---------------------------------------------------------------------------
// Factory helpers — buy
// ---------------------------------------------------------------------------

/**
 * Minimal stubs for complianceService and configService for buy/sell tests
 * where these deps are wired but never invoked by the code path under test.
 */
const NOOP_COMPLIANCE_SERVICE = {
  screenSendDestination: jest.fn(),
} as unknown as ComplianceService;

const NOOP_CONFIG_SERVICE = {
  get: jest.fn().mockReturnValue(undefined),
} as never;

/**
 * Creates a ProposalService wired for buy-proposal tests.
 * Sell-related deps (walletService, beneficiaryService, assetRegistry, ledgerRepo)
 * are minimal null-stubs because `createBuyProposal` never calls them.
 * complianceService and configService are wired but not invoked on the buy path.
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
    NOOP_COMPLIANCE_SERVICE,
    NOOP_CONFIG_SERVICE,
    // swapProvider: not needed on buy path; undefined is fine (@Optional)
    undefined as never,
  );
}

/**
 * Creates a ProposalService wired for sell-proposal tests.
 * complianceService and configService are wired but not invoked on the sell path.
 */
function makeSellSvc(opts?: {
  quotesService?: Pick<QuotesService, 'quoteBuy' | 'quoteSell'>;
  kycGate?: Pick<KycGateService, 'assertCanTransact'>;
  quoteRepo?: IQuoteRepository;
  proposalRepo?: IProposalRepository;
  walletService?: Pick<WalletService, 'getOrProvisionNetworkWallet'>;
  beneficiaryService?: Pick<BeneficiaryService, 'getById'>;
  assetRegistry?: Pick<AssetRegistry, 'defaultNetworkFor'>;
  ledgerRepo?: ILedgerRepository;
  configService?: { get: (key: string) => unknown };
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
    NOOP_COMPLIANCE_SERVICE,
    (opts?.configService ?? NOOP_CONFIG_SERVICE) as never,
    // swapProvider: not needed on sell path; undefined is fine (@Optional)
    undefined as never,
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
      getType: jest.fn().mockResolvedValue(null),
      listPendingForUser: jest.fn().mockResolvedValue([]),
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
      getType: jest.fn().mockResolvedValue(null),
      listPendingForUser: jest.fn().mockResolvedValue([]),
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

  // ── Fix-C: KYC gate called with exact string fiatAmount ──────────────────

  it('calls KYC gate with fiatAmount as exact string (no Number() conversion)', async () => {
    const kycGate = makeKycGate();
    const svc = makeBuySvc(
      makeQuotesService() as unknown as QuotesService,
      kycGate as unknown as KycGateService,
    );

    await svc.createBuyProposal(BASE_INPUT);

    // The gate must be called with the original intent.fiatAmount string.
    const calls = (
      kycGate.assertCanTransact as jest.MockedFunction<
        (input: {
          userId: string;
          fiatAmount: string;
          asset: string;
        }) => Promise<void>
      >
    ).mock.calls;
    const callArg = calls[0][0];
    expect(typeof callArg.fiatAmount).toBe('string');
    expect(callArg.fiatAmount).toBe('10000');
  });

  // ── Amount-floor guard (findings #2, #3, #6) ─────────────────────────────
  // The guard runs BEFORE quoteBuy and BEFORE the KYC gate, so a non-positive /
  // dust / below-minimum amount surfaces as a clean AMOUNT_TOO_SMALL (422) — not
  // an opaque QuotePricingError 500 (#2) nor a confusing tier-limit 403 (#6).

  it('rejects a zero amount with AmountTooSmallError before quoting or gating', async () => {
    const quotesService = makeQuotesService();
    const kycGate = makeKycGate();
    const quoteRepo = makeQuoteRepo();
    const proposalRepo = makeProposalRepo();
    const svc = makeBuySvc(
      quotesService as unknown as QuotesService,
      kycGate as unknown as KycGateService,
      quoteRepo,
      proposalRepo,
    );

    await expect(
      svc.createBuyProposal({
        ...BASE_INPUT,
        intent: { ...BASE_INPUT.intent, fiatAmount: '0' },
      }),
    ).rejects.toMatchObject({ code: 'AMOUNT_TOO_SMALL' });

    // Nothing downstream ran — no quote, no gate, no proposal.
    expect(quotesService.quoteBuy).not.toHaveBeenCalled();
    expect(kycGate.assertCanTransact).not.toHaveBeenCalled();
    expect(quoteRepo.create).not.toHaveBeenCalled();
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  it('rejects a dust amount (0.01) below the default floor with AmountTooSmallError', async () => {
    const svc = makeBuySvc();
    await expect(
      svc.createBuyProposal({
        ...BASE_INPUT,
        intent: { ...BASE_INPUT.intent, fiatAmount: '0.01' },
      }),
    ).rejects.toMatchObject({ code: 'AMOUNT_TOO_SMALL' });
  });

  it('rejects an amount below the configured per-fiat minimum', async () => {
    const quotesService = makeQuotesService();
    const configService = {
      get: jest.fn((key: string) =>
        key === 'pricing' ? { minBuyFiat: { NGN: 500 } } : undefined,
      ),
    };
    const svc = new ProposalService(
      quotesService as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      makeQuoteRepo(),
      makeProposalRepo(),
      stubClock,
      makeWalletService() as unknown as WalletService,
      makeBeneficiaryService() as unknown as BeneficiaryService,
      makeAssetRegistry() as unknown as AssetRegistry,
      makeLedgerRepo(),
      NOOP_COMPLIANCE_SERVICE,
      configService as never,
      undefined as never,
    );

    await expect(
      svc.createBuyProposal({
        ...BASE_INPUT,
        intent: { ...BASE_INPUT.intent, fiatAmount: '300' },
      }),
    ).rejects.toMatchObject({ code: 'AMOUNT_TOO_SMALL' });
    expect(quotesService.quoteBuy).not.toHaveBeenCalled();
  });

  it('accepts an amount exactly at the configured minimum (boundary)', async () => {
    const configService = {
      get: jest.fn((key: string) =>
        key === 'pricing' ? { minBuyFiat: { NGN: 500 } } : undefined,
      ),
    };
    const svc = new ProposalService(
      makeQuotesService() as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      makeQuoteRepo(),
      makeProposalRepo(),
      stubClock,
      makeWalletService() as unknown as WalletService,
      makeBeneficiaryService() as unknown as BeneficiaryService,
      makeAssetRegistry() as unknown as AssetRegistry,
      makeLedgerRepo(),
      NOOP_COMPLIANCE_SERVICE,
      configService as never,
      undefined as never,
    );

    await expect(
      svc.createBuyProposal({
        ...BASE_INPUT,
        intent: { ...BASE_INPUT.intent, fiatAmount: '500' },
      }),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Per-(capability × asset × currency) FIAT bounds — the pricing MIN/MAX column.
// A product/market cap distinct from the per-user KYC-tier limit, enforce-when-
// present: an unset bound is a no-op. `buy` bounds the fiat spend; `sell` bounds
// the fiat proceeds (quote.netFiatAmount).
// ---------------------------------------------------------------------------

describe('ProposalService per-(capability × asset × currency) fiat bounds', () => {
  const pricingWith = (assets: Record<string, unknown>) => ({
    get: jest.fn((key: string) => (key === 'pricing' ? { assets } : undefined)),
  });

  const makeBuySvc = (configService: {
    get: (key: string) => unknown;
  }): ProposalService =>
    new ProposalService(
      makeQuotesService() as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      makeQuoteRepo(),
      makeProposalRepo(),
      stubClock,
      makeWalletService() as unknown as WalletService,
      makeBeneficiaryService() as unknown as BeneficiaryService,
      makeAssetRegistry() as unknown as AssetRegistry,
      makeLedgerRepo(),
      NOOP_COMPLIANCE_SERVICE,
      configService as never,
      undefined as never,
    );

  it('rejects a buy above maxFiat[buy][NGN] with AMOUNT_TOO_LARGE (before quoting)', async () => {
    const quotesService = makeQuotesService();
    const svc = new ProposalService(
      quotesService as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      makeQuoteRepo(),
      makeProposalRepo(),
      stubClock,
      makeWalletService() as unknown as WalletService,
      makeBeneficiaryService() as unknown as BeneficiaryService,
      makeAssetRegistry() as unknown as AssetRegistry,
      makeLedgerRepo(),
      NOOP_COMPLIANCE_SERVICE,
      pricingWith({ USDT: { maxFiat: { buy: { NGN: 5000 } } } }) as never,
      undefined as never,
    );

    await expect(
      svc.createBuyProposal({
        ...BASE_INPUT,
        intent: { ...BASE_INPUT.intent, fiatAmount: '6000' },
      }),
    ).rejects.toMatchObject({ code: 'AMOUNT_TOO_LARGE' });
    expect(quotesService.quoteBuy).not.toHaveBeenCalled();
  });

  it('accepts a buy exactly at the maxFiat boundary', async () => {
    const svc = makeBuySvc(
      pricingWith({ USDT: { maxFiat: { buy: { NGN: 5000 } } } }),
    );
    await expect(
      svc.createBuyProposal({
        ...BASE_INPUT,
        intent: { ...BASE_INPUT.intent, fiatAmount: '5000' },
      }),
    ).resolves.toBeDefined();
  });

  it('rejects a buy below the per-row minFiat with AMOUNT_TOO_SMALL (even above the global floor)', async () => {
    const svc = makeBuySvc(
      pricingWith({ USDT: { minFiat: { buy: { NGN: 1000 } } } }),
    );
    // 500 clears the global 100 floor but not the per-row 1000 minimum.
    await expect(
      svc.createBuyProposal({
        ...BASE_INPUT,
        intent: { ...BASE_INPUT.intent, fiatAmount: '500' },
      }),
    ).rejects.toMatchObject({ code: 'AMOUNT_TOO_SMALL' });
  });

  it('does not bound a buy when the cap is set for a DIFFERENT currency (enforce-when-present)', async () => {
    const svc = makeBuySvc(
      pricingWith({ USDT: { maxFiat: { buy: { GHS: 100 } } } }),
    );
    await expect(svc.createBuyProposal(BASE_INPUT)).resolves.toBeDefined();
  });

  it('rejects a sell whose fiat PROCEEDS exceed maxFiat[sell][NGN] with AMOUNT_TOO_LARGE', async () => {
    // STUB_SELL_QUOTE.netFiatAmount = '7500' > 5000.
    const svc = makeSellSvc({
      configService: pricingWith({
        USDT: { maxFiat: { sell: { NGN: 5000 } } },
      }),
    });
    await expect(svc.createSellProposal(BASE_SELL_INPUT)).rejects.toMatchObject(
      { code: 'AMOUNT_TOO_LARGE' },
    );
  });

  it('scopes bounds by CAPABILITY — a buy cap does not bound a sell', async () => {
    // Only a BUY cap is set; the sell proceeds (7500) must still pass.
    const svc = makeSellSvc({
      configService: pricingWith({ USDT: { maxFiat: { buy: { NGN: 100 } } } }),
    });
    await expect(
      svc.createSellProposal(BASE_SELL_INPUT),
    ).resolves.toBeDefined();
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

  // ── Currency mismatch (Wave G) ────────────────────────────────────────────

  it('throws BeneficiaryCurrencyMismatchError when the bank pays out in a different currency', async () => {
    // A GHS bank chosen for an NGN sell — the fiat leg would settle to the wrong rail.
    const beneficiaryService = makeBeneficiaryService({
      ...STUB_BENEFICIARY_RECORD,
      payoutCurrency: 'GHS',
      bankCountry: 'GH',
    });
    const proposalRepo = makeProposalRepo(FIXED_SELL_PROPOSAL_ID);
    const svc = makeSellSvc({ beneficiaryService, proposalRepo });

    await expect(svc.createSellProposal(BASE_SELL_INPUT)).rejects.toThrow(
      BeneficiaryCurrencyMismatchError,
    );
    // No proposal persisted — the guard fires before the write.
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  it('accepts a bank whose payoutCurrency matches the sell currency', async () => {
    const beneficiaryService = makeBeneficiaryService({
      ...STUB_BENEFICIARY_RECORD,
      payoutCurrency: 'NGN',
    });
    const svc = makeSellSvc({ beneficiaryService });

    const result = await svc.createSellProposal(BASE_SELL_INPUT);
    expect(result.proposalId).toBe(FIXED_SELL_PROPOSAL_ID);
  });

  // ── Order: balance + gate + beneficiary BEFORE persisting ─────────────────

  it('calls balance check, gate, and beneficiary BEFORE persisting (order invariant)', async () => {
    const callOrder: string[] = [];

    const ledgerRepo: ILedgerRepository = {
      getAccountBalance: jest.fn().mockImplementation(() => {
        callOrder.push('balance');
        return Promise.resolve('100.0');
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
      getType: jest.fn().mockResolvedValue(null),
      listPendingForUser: jest.fn().mockResolvedValue([]),
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

  // ── Fix-C: KYC gate called with exact string fiatAmount ──────────────────

  it('calls KYC gate with fiatAmount as the exact netFiatAmount string for sell', async () => {
    const kycGate = makeKycGate();
    const svc = makeSellSvc({ kycGate });

    await svc.createSellProposal(BASE_SELL_INPUT);

    const sellCalls = (
      kycGate.assertCanTransact as jest.MockedFunction<
        (input: {
          userId: string;
          fiatAmount: string;
          asset: string;
        }) => Promise<void>
      >
    ).mock.calls;
    const sellCallArg = sellCalls[0][0];
    expect(typeof sellCallArg.fiatAmount).toBe('string');
    // STUB_SELL_QUOTE.netFiatAmount = '7500'
    expect(sellCallArg.fiatAmount).toBe('7500');
  });

  // ── Amount-floor guard (finding #4) ──────────────────────────────────────
  // A zero/dust sell must be rejected at the boundary with AMOUNT_TOO_SMALL
  // BEFORE quoting / balance check / gate — never let dust reach confirmation.

  it('rejects a zero crypto amount with AmountTooSmallError before quoting', async () => {
    const quotesService = {
      quoteBuy: jest.fn(),
      quoteSell: jest.fn().mockResolvedValue(STUB_SELL_QUOTE),
    };
    const ledgerRepo = makeLedgerRepo('10.0');
    const svc = makeSellSvc({ quotesService, ledgerRepo });

    await expect(
      svc.createSellProposal({
        ...BASE_SELL_INPUT,
        intent: { ...BASE_SELL_INPUT.intent, cryptoAmount: '0' },
      }),
    ).rejects.toMatchObject({ code: 'AMOUNT_TOO_SMALL' });
    expect(quotesService.quoteSell).not.toHaveBeenCalled();
    expect(ledgerRepo.getAccountBalance).not.toHaveBeenCalled();
  });

  it('rejects a dust crypto amount below the configured per-asset minimum', async () => {
    const quotesService = {
      quoteBuy: jest.fn(),
      quoteSell: jest.fn().mockResolvedValue(STUB_SELL_QUOTE),
    };
    const configService = {
      get: jest.fn((key: string) =>
        key === 'pricing'
          ? { minCryptoAmount: { sell: { USDT: 0.5 } } }
          : undefined,
      ),
    };
    const svc = new ProposalService(
      quotesService as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      makeQuoteRepo(FIXED_SELL_QUOTE_ID),
      makeProposalRepo(FIXED_SELL_PROPOSAL_ID),
      stubClock,
      makeWalletService() as unknown as WalletService,
      makeBeneficiaryService() as unknown as BeneficiaryService,
      makeAssetRegistry() as unknown as AssetRegistry,
      makeLedgerRepo('10.0'),
      NOOP_COMPLIANCE_SERVICE,
      configService as never,
      undefined as never,
    );

    await expect(
      svc.createSellProposal({
        ...BASE_SELL_INPUT,
        intent: { ...BASE_SELL_INPUT.intent, cryptoAmount: '0.1' },
      }),
    ).rejects.toMatchObject({ code: 'AMOUNT_TOO_SMALL' });
    expect(quotesService.quoteSell).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ProposalService.createSendProposal (task N3a)
// ---------------------------------------------------------------------------

const FIXED_SEND_PROPOSAL_ID = 'eeeeeeee-0000-7000-8000-000000000007';
const FIXED_SEND_WALLET_ID = 'wallet-send-ffffffff-0000-7000-8000-00000000008';
const FIXED_SEND_BENEFICIARY_ID =
  'ben-send-11111111-0000-7000-8000-000000000009';

// A TRON address that passes the pattern '^T[1-9A-HJ-NP-Za-km-z]{33}$'
const VALID_TRON_ADDRESS = 'TSendBeneficiaryValidTronAddress12';

const STUB_SEND_QUOTE: QuoteSendOutput = {
  asset: 'USDT',
  cryptoAmount: '10.0',
  network: 'TRON',
  networkFeeCrypto: '1',
  totalDebit: '11',
  quotedAt: FIXED_NOW.toISOString(),
  expiresInSec: 30,
};

const STUB_SEND_WALLET_RECORD = {
  id: FIXED_SEND_WALLET_ID,
  userId: 'user-id-1',
  asset: 'USDT',
  network: 'TRON',
  address: 'TFakeSendWalletAddress123456789',
  providerReference: 'br_fake_send_ref',
  status: 'active',
};

// Crypto beneficiary — cooling-off has passed (locked in the past).
const STUB_CRYPTO_BENEFICIARY = {
  id: FIXED_SEND_BENEFICIARY_ID,
  userId: 'user-id-1',
  type: 'crypto_address' as const,
  label: 'My TRON Wallet',
  accountNumber: null,
  accountHolderName: null,
  bankCode: null,
  cryptoAddress: VALID_TRON_ADDRESS,
  cryptoAsset: 'USDT',
  cryptoNetwork: 'TRON',
  verificationStatus: 'verified',
  firstUseLockedUntil: new Date(FIXED_NOW.getTime() - 86400_000), // 24h ago = cooling-off done
  verifiedAt: new Date(FIXED_NOW.getTime() - 86400_000),
  isDefault: false,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
  deletedAt: null,
};

function makeQuotesServiceWithSend(
  sendQuote = STUB_SEND_QUOTE,
): jest.Mocked<Pick<QuotesService, 'quoteBuy' | 'quoteSell' | 'quoteSend'>> {
  return {
    quoteBuy: jest.fn(),
    quoteSell: jest.fn(),
    quoteSend: jest.fn().mockReturnValue(sendQuote),
  };
}

function makeWalletServiceSend(
  wallet = STUB_SEND_WALLET_RECORD,
): jest.Mocked<Pick<WalletService, 'getOrProvisionNetworkWallet'>> {
  return { getOrProvisionNetworkWallet: jest.fn().mockResolvedValue(wallet) };
}

function makeBeneficiaryServiceSend(
  record: typeof STUB_CRYPTO_BENEFICIARY | null = STUB_CRYPTO_BENEFICIARY,
): jest.Mocked<Pick<BeneficiaryService, 'getById'>> {
  return { getById: jest.fn().mockResolvedValue(record) };
}

function makeAssetRegistrySend(opts?: {
  network?: string;
  addressValid?: boolean;
  defaultFiat?: string;
}): jest.Mocked<
  Pick<
    AssetRegistry,
    'defaultNetworkFor' | 'validateAddress' | 'asset' | 'defaultFiat'
  >
> {
  return {
    defaultNetworkFor: jest.fn().mockReturnValue(opts?.network ?? 'TRON'),
    validateAddress: jest.fn().mockReturnValue(opts?.addressValid !== false),
    defaultFiat: jest.fn().mockReturnValue(opts?.defaultFiat ?? 'NGN'),
    asset: jest.fn().mockReturnValue({
      baseRate: 1600,
      symbol: 'USDT',
      kind: 'crypto',
      decimals: 6,
      networks: ['TRON'],
      providers: {},
      enabled: true,
    }),
  };
}

function makeComplianceService(
  passed = true,
): jest.Mocked<Pick<ComplianceService, 'screenSendDestination'>> {
  return {
    screenSendDestination: jest.fn().mockResolvedValue({
      passed,
      reason: passed ? undefined : 'OFAC list match',
      complianceEventId: 'ce-000000-0000-7000-8000-000000000001',
    }),
  };
}

/** Stub ConfigService that returns compliance + pricing config. */
const STUB_CONFIG_SERVICE = {
  get: jest.fn((key: string) => {
    if (key === 'compliance')
      return { travelRuleThresholds: { NGN: 1_000_000 } };
    if (key === 'pricing')
      return { assets: { USDT: { baseRates: { NGN: 1600 } } } };
    return undefined;
  }),
};

function makeSendSvc(opts?: {
  quotesService?: Pick<QuotesService, 'quoteBuy' | 'quoteSell' | 'quoteSend'>;
  kycGate?: Pick<KycGateService, 'assertCanTransact'>;
  proposalRepo?: IProposalRepository;
  walletService?: Pick<WalletService, 'getOrProvisionNetworkWallet'>;
  beneficiaryService?: Pick<BeneficiaryService, 'getById'>;
  assetRegistry?: Pick<
    AssetRegistry,
    'defaultNetworkFor' | 'validateAddress' | 'asset' | 'defaultFiat'
  >;
  ledgerRepo?: ILedgerRepository;
  complianceService?: Pick<ComplianceService, 'screenSendDestination'>;
  configService?: { get: jest.Mock };
}): ProposalService {
  return new ProposalService(
    (opts?.quotesService ??
      makeQuotesServiceWithSend()) as unknown as QuotesService,
    (opts?.kycGate ?? makeKycGate()) as unknown as KycGateService,
    makeQuoteRepo(), // not used for send
    opts?.proposalRepo ?? makeProposalRepo(FIXED_SEND_PROPOSAL_ID),
    stubClock,
    (opts?.walletService ??
      makeWalletServiceSend()) as unknown as WalletService,
    (opts?.beneficiaryService ??
      makeBeneficiaryServiceSend()) as unknown as BeneficiaryService,
    (opts?.assetRegistry ??
      makeAssetRegistrySend()) as unknown as AssetRegistry,
    opts?.ledgerRepo ?? makeLedgerRepo('100.0'), // ample balance
    (opts?.complianceService ??
      makeComplianceService()) as unknown as ComplianceService,
    (opts?.configService ?? STUB_CONFIG_SERVICE) as never,
    // swapProvider: not needed on send path; undefined is fine (@Optional)
    undefined as never,
  );
}

const BASE_SEND_INPUT = {
  userId: 'user-id-1',
  conversationId: 'conv-id-1',
  intent: {
    action: 'send_crypto' as const,
    asset: 'USDT' as const,
    cryptoAmount: '10.0',
    network: 'TRON' as const,
  },
  beneficiaryId: FIXED_SEND_BENEFICIARY_ID,
};

describe('ProposalService.createSendProposal', () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns proposalId, quoteId=null, and a valid SendProposalConfirmation', async () => {
    const svc = makeSendSvc();
    const result = await svc.createSendProposal(BASE_SEND_INPUT);

    expect(result.proposalId).toBe(FIXED_SEND_PROPOSAL_ID);
    expect(result.quoteId).toBeNull();
    expect(result.confirmation.proposalId).toBe(FIXED_SEND_PROPOSAL_ID);
    expect(result.confirmation.asset).toBe('USDT');
    expect(result.confirmation.cryptoAmount).toBe('10.0');
    expect(result.confirmation.network).toBe('TRON');
    expect(result.confirmation.networkFeeCrypto).toBe('1');
    expect(result.confirmation.totalDebit).toBe('11');
  });

  it('confirmation parses cleanly against SendProposalConfirmationSchema', async () => {
    const svc = makeSendSvc();
    const result = await svc.createSendProposal(BASE_SEND_INPUT);
    expect(() =>
      SendProposalConfirmationSchema.parse(result.confirmation),
    ).not.toThrow();
  });

  it('masks the destination address (first 6 + ... + last 4)', async () => {
    const svc = makeSendSvc();
    const result = await svc.createSendProposal(BASE_SEND_INPUT);
    // VALID_TRON_ADDRESS = 'TSendBeneficiaryValidTronAddress12' (34 chars)
    // masked: 'TSendB...ss12'
    expect(result.confirmation.toAddressMasked).toMatch(/^.{6}\.\.\.(.){4}$/);
  });

  it('includes beneficiaryLabel from the beneficiary record', async () => {
    const svc = makeSendSvc();
    const result = await svc.createSendProposal(BASE_SEND_INPUT);
    expect(result.confirmation.beneficiaryLabel).toBe('My TRON Wallet');
  });

  it('persists a send Proposal row (type=send, no quoteId)', async () => {
    const proposalRepo = makeProposalRepo(FIXED_SEND_PROPOSAL_ID);
    const svc = makeSendSvc({ proposalRepo });

    await svc.createSendProposal(BASE_SEND_INPUT);

    const createArg = (
      proposalRepo.create as jest.Mock<
        Promise<{ id: string }>,
        [CreateProposalData]
      >
    ).mock.calls[0][0];
    expect(createArg.type).toBe('send');
    expect(createArg.quoteId).toBeUndefined();
    expect(createArg.parametersChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(createArg.parameters).toMatchObject({
      asset: 'USDT',
      cryptoAmount: '10.0',
      network: 'TRON',
      networkFeeCrypto: '1',
      totalDebit: '11',
      beneficiaryId: FIXED_SEND_BENEFICIARY_ID,
    });
  });

  it('sets requiresTravelRule=false when NGN value is below threshold', async () => {
    // 10 USDT × ₦1600/USDT = ₦16,000 — well below ₦1,000,000 threshold
    const proposalRepo = makeProposalRepo(FIXED_SEND_PROPOSAL_ID);
    const svc = makeSendSvc({ proposalRepo });

    await svc.createSendProposal(BASE_SEND_INPUT);

    const createArg = (
      proposalRepo.create as jest.Mock<
        Promise<{ id: string }>,
        [CreateProposalData]
      >
    ).mock.calls[0][0];
    expect(createArg.parameters['requiresTravelRule']).toBe(false);
  });

  it('sets requiresTravelRule=true when NGN value meets or exceeds threshold', async () => {
    // 700 USDT × ₦1600 = ₦1,120,000 ≥ ₦1,000,000 threshold
    const proposalRepo = makeProposalRepo(FIXED_SEND_PROPOSAL_ID);
    const svc = makeSendSvc({
      proposalRepo,
      ledgerRepo: makeLedgerRepo('1000.0'),
      quotesService: makeQuotesServiceWithSend({
        ...STUB_SEND_QUOTE,
        cryptoAmount: '700',
        totalDebit: '701',
      }),
    });

    await svc.createSendProposal({
      ...BASE_SEND_INPUT,
      intent: { ...BASE_SEND_INPUT.intent, cryptoAmount: '700' },
    });

    const createArg = (
      proposalRepo.create as jest.Mock<
        Promise<{ id: string }>,
        [CreateProposalData]
      >
    ).mock.calls[0][0];
    expect(createArg.parameters['requiresTravelRule']).toBe(true);
  });

  it('flags travel rule using the base-fiat threshold from travelRuleThresholds[defaultFiat()]', async () => {
    // 700 USDT × ₦1600 = ₦1,120,000 ≥ travelRuleThresholds.NGN (1_000_000)
    // Verifies that the threshold is looked up via travelRuleThresholds[baseFiat]
    // (per-fiat map, Task 9) rather than a scalar threshold field.
    const proposalRepo = makeProposalRepo(FIXED_SEND_PROPOSAL_ID);
    const svc = makeSendSvc({
      proposalRepo,
      ledgerRepo: makeLedgerRepo('1000.0'),
      quotesService: makeQuotesServiceWithSend({
        ...STUB_SEND_QUOTE,
        cryptoAmount: '700',
        totalDebit: '701',
      }),
      assetRegistry: makeAssetRegistrySend({ defaultFiat: 'NGN' }),
      configService: {
        get: jest.fn((key: string) => {
          if (key === 'compliance')
            return { travelRuleThresholds: { NGN: 1_000_000 } };
          if (key === 'pricing')
            return { assets: { USDT: { baseRates: { NGN: 1600 } } } };
          return undefined;
        }),
      },
    });

    await svc.createSendProposal({
      ...BASE_SEND_INPUT,
      intent: { ...BASE_SEND_INPUT.intent, cryptoAmount: '700' },
    });

    const createArg = (
      proposalRepo.create as jest.Mock<
        Promise<{ id: string }>,
        [CreateProposalData]
      >
    ).mock.calls[0][0];
    expect(createArg.parameters['requiresTravelRule']).toBe(true);
  });

  it('expiresAt is now + expiresInSec as an ISO datetime string', async () => {
    const svc = makeSendSvc();
    const result = await svc.createSendProposal(BASE_SEND_INPUT);
    const expectedExpiry = new Date(FIXED_NOW.getTime() + 30_000).toISOString();
    expect(result.confirmation.expiresAt).toBe(expectedExpiry);
  });

  // ── Insufficient balance ──────────────────────────────────────────────────

  it('throws InsufficientBalanceError when ledger balance < totalDebit', async () => {
    // balance 5.0 < totalDebit 11 (10 + 1 fee)
    const ledgerRepo = makeLedgerRepo('5.0');
    const svc = makeSendSvc({ ledgerRepo });

    await expect(svc.createSendProposal(BASE_SEND_INPUT)).rejects.toThrow(
      InsufficientBalanceError,
    );
  });

  it('does NOT persist any row when balance is insufficient (incl. fee)', async () => {
    const proposalRepo = makeProposalRepo(FIXED_SEND_PROPOSAL_ID);
    const quoteRepo = makeQuoteRepo();
    const svc = makeSendSvc({
      ledgerRepo: makeLedgerRepo('0'),
      proposalRepo,
    });

    await expect(svc.createSendProposal(BASE_SEND_INPUT)).rejects.toThrow(
      InsufficientBalanceError,
    );
    expect(proposalRepo.create).not.toHaveBeenCalled();
    expect(quoteRepo.create).not.toHaveBeenCalled();
  });

  // ── KYC gate failure ──────────────────────────────────────────────────────

  it('propagates KYC gate error and does NOT persist a Proposal', async () => {
    const kycGate = makeKycGate(new Error('KYC_NOT_VERIFIED'));
    const proposalRepo = makeProposalRepo(FIXED_SEND_PROPOSAL_ID);
    const svc = makeSendSvc({ kycGate, proposalRepo });

    await expect(svc.createSendProposal(BASE_SEND_INPUT)).rejects.toThrow(
      'KYC_NOT_VERIFIED',
    );
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  // ── Unknown beneficiary ───────────────────────────────────────────────────

  it('throws BeneficiaryNotFoundError when beneficiary is not found', async () => {
    const beneficiaryService = makeBeneficiaryServiceSend(null);
    const svc = makeSendSvc({ beneficiaryService });

    await expect(svc.createSendProposal(BASE_SEND_INPUT)).rejects.toThrow(
      BeneficiaryNotFoundError,
    );
  });

  it('does NOT persist any row when beneficiary is not found', async () => {
    const proposalRepo = makeProposalRepo(FIXED_SEND_PROPOSAL_ID);
    const svc = makeSendSvc({
      beneficiaryService: makeBeneficiaryServiceSend(null),
      proposalRepo,
    });

    await expect(svc.createSendProposal(BASE_SEND_INPUT)).rejects.toThrow(
      BeneficiaryNotFoundError,
    );
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  // ── Wrong beneficiary type ────────────────────────────────────────────────

  it('throws BeneficiaryWrongTypeError when beneficiary is a bank_account', async () => {
    const bankBeneficiary = {
      ...STUB_CRYPTO_BENEFICIARY,
      type: 'bank_account' as const,
      cryptoAddress: null,
    };
    const svc = makeSendSvc({
      beneficiaryService: {
        getById: jest.fn().mockResolvedValue(bankBeneficiary),
      },
    });

    await expect(svc.createSendProposal(BASE_SEND_INPUT)).rejects.toThrow(
      BeneficiaryWrongTypeError,
    );
  });

  // ── First-use cooling-off ─────────────────────────────────────────────────

  it('throws BeneficiaryCoolingOffError when firstUseLockedUntil is in the future', async () => {
    const coolingBeneficiary = {
      ...STUB_CRYPTO_BENEFICIARY,
      firstUseLockedUntil: new Date(FIXED_NOW.getTime() + 86400_000), // 24h in future
    };
    const svc = makeSendSvc({
      beneficiaryService: {
        getById: jest.fn().mockResolvedValue(coolingBeneficiary),
      },
    });

    await expect(svc.createSendProposal(BASE_SEND_INPUT)).rejects.toThrow(
      BeneficiaryCoolingOffError,
    );
  });

  it('does NOT persist any row when cooling-off is active', async () => {
    const proposalRepo = makeProposalRepo(FIXED_SEND_PROPOSAL_ID);
    const coolingBeneficiary = {
      ...STUB_CRYPTO_BENEFICIARY,
      firstUseLockedUntil: new Date(FIXED_NOW.getTime() + 86400_000),
    };
    const svc = makeSendSvc({
      beneficiaryService: {
        getById: jest.fn().mockResolvedValue(coolingBeneficiary),
      },
      proposalRepo,
    });

    await expect(svc.createSendProposal(BASE_SEND_INPUT)).rejects.toThrow(
      BeneficiaryCoolingOffError,
    );
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  // ── Sanctions screen block ────────────────────────────────────────────────

  it('throws SanctionsBlockedError when compliance screening fails', async () => {
    const complianceService = makeComplianceService(false);
    const svc = makeSendSvc({ complianceService });

    await expect(svc.createSendProposal(BASE_SEND_INPUT)).rejects.toThrow(
      SanctionsBlockedError,
    );
  });

  it('does NOT persist any row when sanctions screening fails', async () => {
    const proposalRepo = makeProposalRepo(FIXED_SEND_PROPOSAL_ID);
    const svc = makeSendSvc({
      complianceService: makeComplianceService(false),
      proposalRepo,
    });

    await expect(svc.createSendProposal(BASE_SEND_INPUT)).rejects.toThrow(
      SanctionsBlockedError,
    );
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  // ── Guard ordering: all guards BEFORE persisting ───────────────────────────

  it('runs balance + gate + beneficiary + cooling-off + sanctions BEFORE persisting', async () => {
    const callOrder: string[] = [];

    const ledgerRepo: ILedgerRepository = {
      getAccountBalance: jest.fn().mockImplementation(() => {
        callOrder.push('balance');
        return Promise.resolve('100.0');
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
    const kycGateOrdered = {
      assertCanTransact: jest.fn().mockImplementation(() => {
        callOrder.push('gate');
        return Promise.resolve();
      }),
    };
    const beneficiaryService = {
      getById: jest.fn().mockImplementation(() => {
        callOrder.push('beneficiary');
        return Promise.resolve(STUB_CRYPTO_BENEFICIARY);
      }),
    };
    const complianceService = {
      screenSendDestination: jest.fn().mockImplementation(() => {
        callOrder.push('sanctions');
        return Promise.resolve({ passed: true, complianceEventId: 'ce-xxx' });
      }),
    };
    const proposalRepo: IProposalRepository = {
      create: jest.fn().mockImplementation(() => {
        callOrder.push('proposalRepo');
        return Promise.resolve({ id: FIXED_SEND_PROPOSAL_ID });
      }),
      findById: jest.fn().mockResolvedValue(null),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      getType: jest.fn().mockResolvedValue(null),
      listPendingForUser: jest.fn().mockResolvedValue([]),
    };

    const svc = makeSendSvc({
      ledgerRepo,
      kycGate: kycGateOrdered,
      beneficiaryService,
      complianceService,
      proposalRepo,
    });

    await svc.createSendProposal(BASE_SEND_INPUT);

    // All guards must come before proposalRepo.create
    const propIdx = callOrder.indexOf('proposalRepo');
    expect(callOrder.indexOf('balance')).toBeLessThan(propIdx);
    expect(callOrder.indexOf('gate')).toBeLessThan(propIdx);
    expect(callOrder.indexOf('beneficiary')).toBeLessThan(propIdx);
    expect(callOrder.indexOf('sanctions')).toBeLessThan(propIdx);
  });

  // ── Fix-C: KYC gate called with exact string fiatAmount ──────────────────

  it('calls KYC gate with fiatAmount as a string (no Number() float conversion) for send', async () => {
    const kycGate = makeKycGate();
    const svc = makeSendSvc({ kycGate });

    await svc.createSendProposal(BASE_SEND_INPUT);

    const sendCalls = (
      kycGate.assertCanTransact as jest.MockedFunction<
        (input: {
          userId: string;
          fiatAmount: string;
          asset: string;
        }) => Promise<void>
      >
    ).mock.calls;
    const sendCallArg = sendCalls[0][0];
    expect(typeof sendCallArg.fiatAmount).toBe('string');
    // 10 USDT × 1600 NGN/USDT = 16000 NGN — should be a non-empty decimal string
    expect(sendCallArg.fiatAmount).toBe('16000');
  });

  // ── Fix-2: exact rate scaling — fractional baseRate handled exactly ────────

  it('computes NGN-equivalent exactly with a fractional baseRate (no Math.round drift)', async () => {
    // baseRate 1600.45: 10 USDT × 1600.45 = 16004.5 NGN exactly.
    // Math.round(1600.45) = 1600 → would produce 16000 (wrong by 4.5 NGN).
    const configWithFractionalRate = {
      get: jest.fn((key: string) => {
        if (key === 'compliance')
          return { travelRuleThresholds: { NGN: 1_000_000 } };
        if (key === 'pricing')
          return { assets: { USDT: { baseRates: { NGN: 1600.45 } } } };
        return undefined;
      }),
    };
    const kycGate = makeKycGate();
    // No override of assetRegistry needed — baseRate comes from pricing config,
    // not from the catalog asset (CatalogAsset has no baseRate field).

    const svc = makeSendSvc({
      kycGate,
      configService: configWithFractionalRate,
    });

    await svc.createSendProposal(BASE_SEND_INPUT);

    const sendCalls = (
      kycGate.assertCanTransact as jest.MockedFunction<
        (input: {
          userId: string;
          fiatAmount: string;
          asset: string;
        }) => Promise<void>
      >
    ).mock.calls;
    const fiatAmount = sendCalls[0][0].fiatAmount;

    // 10 × 1600.45 = 16004.5 — exact decimal scaling must produce this, not 16000.
    expect(fiatAmount).toBe('16004.5');
  });

  // ── Fail-closed: 0 / negative baseRate must throw (money-gate bypass guard) ──

  it('throws (fails closed) on a 0 baseRate without calling the KYC gate', async () => {
    // A misconfigured baseRate of 0 makes the NGN-equivalent 0, which would
    // silently bypass the KYC / velocity / Travel-Rule gate for any amount.
    // The guard must fail closed BEFORE the gate is ever called with 0.
    const kycGate = makeKycGate();
    const proposalRepo = makeProposalRepo(FIXED_SEND_PROPOSAL_ID);
    const configZeroRate = {
      get: jest.fn((key: string) => {
        if (key === 'compliance')
          return { travelRuleThresholds: { NGN: 1_000_000 } };
        if (key === 'pricing')
          return { assets: { USDT: { baseRates: { NGN: 0 } } } };
        return undefined;
      }),
    };
    const svc = makeSendSvc({
      kycGate,
      proposalRepo,
      configService: configZeroRate,
    });

    await expect(svc.createSendProposal(BASE_SEND_INPUT)).rejects.toThrow(
      BaseRateMisconfiguredError,
    );
    // The gate must never run with a zeroed amount — the throw precedes it.
    expect(kycGate.assertCanTransact).not.toHaveBeenCalled();
    // And no Proposal is persisted (§3.1 — guards before persistence).
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  it('throws (fails closed) on a negative baseRate without calling the KYC gate', async () => {
    const kycGate = makeKycGate();
    const configNegativeRate = {
      get: jest.fn((key: string) => {
        if (key === 'compliance')
          return { travelRuleThresholds: { NGN: 1_000_000 } };
        if (key === 'pricing')
          return { assets: { USDT: { baseRates: { NGN: -1600 } } } };
        return undefined;
      }),
    };
    const svc = makeSendSvc({ kycGate, configService: configNegativeRate });

    await expect(svc.createSendProposal(BASE_SEND_INPUT)).rejects.toThrow(
      BaseRateMisconfiguredError,
    );
    expect(kycGate.assertCanTransact).not.toHaveBeenCalled();
  });

  // ── Amount-floor + fee-coverage guard (finding #4) ───────────────────────

  it('rejects a zero send amount with AmountTooSmallError before quoting', async () => {
    const quotesService = makeQuotesServiceWithSend();
    const ledgerRepo = makeLedgerRepo('100.0');
    const svc = makeSendSvc({ quotesService, ledgerRepo });

    await expect(
      svc.createSendProposal({
        ...BASE_SEND_INPUT,
        intent: { ...BASE_SEND_INPUT.intent, cryptoAmount: '0' },
      }),
    ).rejects.toBeInstanceOf(AmountTooSmallError);
    expect(quotesService.quoteSend).not.toHaveBeenCalled();
    expect(ledgerRepo.getAccountBalance).not.toHaveBeenCalled();
  });

  it('rejects a send whose amount does not exceed the network fee (fee-coverage)', async () => {
    // networkFeeCrypto from STUB_SEND_QUOTE is '1'. A 0.5 USDT send would pay a
    // 1 USDT fee for half its value — uneconomic. Reject with AMOUNT_TOO_SMALL.
    const feeQuote: QuoteSendOutput = {
      ...STUB_SEND_QUOTE,
      cryptoAmount: '0.5',
      networkFeeCrypto: '1',
      totalDebit: '1.5',
    };
    const quotesService = makeQuotesServiceWithSend(feeQuote);
    const svc = makeSendSvc({
      quotesService,
      ledgerRepo: makeLedgerRepo('100.0'),
    });

    await expect(
      svc.createSendProposal({
        ...BASE_SEND_INPUT,
        intent: { ...BASE_SEND_INPUT.intent, cryptoAmount: '0.5' },
      }),
    ).rejects.toMatchObject({ code: 'AMOUNT_TOO_SMALL' });
  });

  it('accepts a send whose amount exceeds the network fee', async () => {
    const okQuote: QuoteSendOutput = {
      ...STUB_SEND_QUOTE,
      cryptoAmount: '2',
      networkFeeCrypto: '1',
      totalDebit: '3',
    };
    const quotesService = makeQuotesServiceWithSend(okQuote);
    const svc = makeSendSvc({
      quotesService,
      ledgerRepo: makeLedgerRepo('100.0'),
    });

    await expect(
      svc.createSendProposal({
        ...BASE_SEND_INPUT,
        intent: { ...BASE_SEND_INPUT.intent, cryptoAmount: '2' },
      }),
    ).resolves.toBeDefined();
  });

  // ── Self-send guard (finding #5) ─────────────────────────────────────────

  it('rejects sending to the user own provisioned wallet address with SelfSendError', async () => {
    // Beneficiary's crypto address == the user's own wallet address.
    const ownAddress = STUB_SEND_WALLET_RECORD.address;
    const selfBeneficiary = {
      ...STUB_CRYPTO_BENEFICIARY,
      cryptoAddress: ownAddress,
    };
    const proposalRepo = makeProposalRepo(FIXED_SEND_PROPOSAL_ID);
    const svc = makeSendSvc({
      beneficiaryService: makeBeneficiaryServiceSend(selfBeneficiary),
      proposalRepo,
    });

    await expect(
      svc.createSendProposal(BASE_SEND_INPUT),
    ).rejects.toBeInstanceOf(SelfSendError);
    // No proposal persisted — guard precedes persistence (§3.1).
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  it('self-send comparison is case-insensitive (EVM-style mixed case)', async () => {
    // Use a wallet whose address differs only by case from the beneficiary's.
    const wallet = {
      ...STUB_SEND_WALLET_RECORD,
      address: STUB_SEND_WALLET_RECORD.address.toUpperCase(),
    };
    const selfBeneficiary = {
      ...STUB_CRYPTO_BENEFICIARY,
      cryptoAddress: STUB_SEND_WALLET_RECORD.address.toLowerCase(),
    };
    const svc = makeSendSvc({
      walletService: makeWalletServiceSend(wallet),
      beneficiaryService: makeBeneficiaryServiceSend(selfBeneficiary),
    });

    await expect(
      svc.createSendProposal(BASE_SEND_INPUT),
    ).rejects.toBeInstanceOf(SelfSendError);
  });

  it('confirmation includes the beneficiaryLabel so the destination is legible (finding #5)', async () => {
    const svc = makeSendSvc();
    const result = await svc.createSendProposal(BASE_SEND_INPUT);
    expect(result.confirmation.beneficiaryLabel).toBe('My TRON Wallet');
  });
});

// ============================================================================
// ProposalService.createSwapProposal
// ============================================================================

const FIXED_SWAP_PROPOSAL_ID = 'eeeeeeee-0000-7000-8000-000000000007';
const FIXED_SWAP_QUOTE_ID = 'ffffffff-0000-7000-8000-000000000008';
const SWAP_WALLET_ID = 'wallet-11111111-0000-7000-8000-000000000009';

const STUB_SWAP_PROVIDER_QUOTE = {
  toAmount: '62500',
  rate: '1562.5', // after spread fold
  minAmount: '62000',
  slippage: 50,
  networkFee: '1',
  transactionFee: '0.5',
  estimatedArrivalSec: 120,
};

const STUB_SWAP_WALLET = {
  id: SWAP_WALLET_ID,
  userId: 'user-swap-1',
  network: 'TRON',
  address: 'TSwapAddressForTests1234567890',
  providerReference: 'br_swap_ref',
  status: 'active',
};

function makeSwapAssetRegistry(): jest.Mocked<
  Pick<AssetRegistry, 'defaultNetworkFor' | 'defaultFiat' | 'assetProviderId'>
> {
  return {
    defaultNetworkFor: jest.fn().mockReturnValue('TRON'),
    defaultFiat: jest.fn().mockReturnValue('NGN'),
    assetProviderId: jest
      .fn()
      .mockImplementation((asset: string) => `br_id_${asset}`),
  };
}

function makeSwapProvider(quote = STUB_SWAP_PROVIDER_QUOTE): {
  getQuote: jest.Mock;
} {
  return {
    getQuote: jest.fn().mockResolvedValue(quote),
  };
}

/** Stub ConfigService for swap tests: returns swap.spreadBps + pricing baseRate. */
const STUB_SWAP_CONFIG = {
  get: jest.fn((key: string) => {
    if (key === 'swap') return { spreadBps: 100, maxDriftBps: 50 };
    if (key === 'pricing')
      return { assets: { USDT: { baseRates: { NGN: 1600 } } } };
    if (key === 'compliance')
      return { travelRuleThresholds: { NGN: 1_000_000 } };
    return undefined;
  }),
};

function makeSwapSvc(opts?: {
  swapProvider?: { getQuote: jest.Mock };
  kycGate?: Pick<KycGateService, 'assertCanTransact'>;
  quoteRepo?: IQuoteRepository;
  proposalRepo?: IProposalRepository;
  walletService?: Pick<WalletService, 'getOrProvisionNetworkWallet'>;
  assetRegistry?: Pick<
    AssetRegistry,
    'defaultNetworkFor' | 'defaultFiat' | 'assetProviderId'
  >;
  ledgerRepo?: ILedgerRepository;
  configService?: { get: jest.Mock };
}): ProposalService {
  return new ProposalService(
    // quotesService: not called on swap path
    {
      quoteBuy: jest.fn(),
      quoteSell: jest.fn(),
      quoteSend: jest.fn(),
    } as unknown as QuotesService,
    (opts?.kycGate ?? makeKycGate()) as unknown as KycGateService,
    opts?.quoteRepo ?? makeQuoteRepo(FIXED_SWAP_QUOTE_ID),
    opts?.proposalRepo ?? makeProposalRepo(FIXED_SWAP_PROPOSAL_ID),
    stubClock,
    (opts?.walletService ?? {
      getOrProvisionNetworkWallet: jest
        .fn()
        .mockResolvedValue(STUB_SWAP_WALLET),
    }) as unknown as WalletService,
    // beneficiaryService: not called on swap path
    { getById: jest.fn() } as unknown as BeneficiaryService,
    (opts?.assetRegistry ??
      makeSwapAssetRegistry()) as unknown as AssetRegistry,
    opts?.ledgerRepo ?? makeLedgerRepo('100.0'),
    NOOP_COMPLIANCE_SERVICE,
    (opts?.configService ?? STUB_SWAP_CONFIG) as never,
    // swapProvider is the last positional arg added to ProposalService
    (opts?.swapProvider ?? makeSwapProvider()) as never,
  );
}

const BASE_SWAP_INPUT = {
  userId: 'user-swap-1',
  conversationId: 'conv-swap-1',
  fromAsset: 'USDT' as const,
  toAsset: 'TRX' as const,
  amount: '40',
};

describe('ProposalService.createSwapProposal', () => {
  it('happy path: returns a SwapProposalConfirmation with proposalId and quoteId', async () => {
    const svc = makeSwapSvc();
    const result = await svc.createSwapProposal(BASE_SWAP_INPUT);

    expect(result.proposalId).toBe(FIXED_SWAP_PROPOSAL_ID);
    expect(result.quoteId).toBe(FIXED_SWAP_QUOTE_ID);
    expect(() =>
      SwapProposalConfirmationSchema.parse(result.confirmation),
    ).not.toThrow();
    expect(result.confirmation.fromAsset).toBe('USDT');
    expect(result.confirmation.toAsset).toBe('TRX');
    expect(result.confirmation.fromAmount).toBe('40');
  });

  it('rejects fromAsset === toAsset with SwapSameAssetError (engine rule)', async () => {
    const svc = makeSwapSvc();
    await expect(
      svc.createSwapProposal({
        ...BASE_SWAP_INPUT,
        fromAsset: 'USDT',
        toAsset: 'USDT',
      }),
    ).rejects.toThrow(SwapSameAssetError);
  });

  it('SwapSameAssetError carries the stable SWAP_SAME_ASSET code (finding #17)', async () => {
    // The stable code lets the global DomainExceptionFilter map this to a clean
    // 422 instead of an opaque 500.
    const svc = makeSwapSvc();
    await expect(
      svc.createSwapProposal({
        ...BASE_SWAP_INPUT,
        fromAsset: 'USDT',
        toAsset: 'USDT',
      }),
    ).rejects.toMatchObject({ code: 'SWAP_SAME_ASSET' });
  });

  it('fails closed when swap.spreadBps drives the effective rate to <= 0 (finding #27)', async () => {
    // A spread >= 100% (spreadBps >= 10000) would yield a 0/negative effective
    // rate and a 0/negative toAmount — a 0-value swap that bypasses the gate.
    // The engine must fail closed on this misconfiguration rather than quote 0.
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'swap') return { spreadBps: 10000, maxDriftBps: 50 };
        if (key === 'pricing')
          return { assets: { USDT: { baseRates: { NGN: 1600 } } } };
        if (key === 'compliance')
          return { travelRuleThresholds: { NGN: 1_000_000 } };
        return undefined;
      }),
    };
    const proposalRepo = makeProposalRepo(FIXED_SWAP_PROPOSAL_ID);
    const svc = makeSwapSvc({ configService, proposalRepo });

    await expect(svc.createSwapProposal(BASE_SWAP_INPUT)).rejects.toThrow(
      BaseRateMisconfiguredError,
    );
    // Never persists a 0-value swap proposal.
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  it('fails closed when swap.spreadBps exceeds 100% (negative effective rate)', async () => {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'swap') return { spreadBps: 12000, maxDriftBps: 50 };
        if (key === 'pricing')
          return { assets: { USDT: { baseRates: { NGN: 1600 } } } };
        if (key === 'compliance')
          return { travelRuleThresholds: { NGN: 1_000_000 } };
        return undefined;
      }),
    };
    const svc = makeSwapSvc({ configService });
    await expect(svc.createSwapProposal(BASE_SWAP_INPUT)).rejects.toThrow(
      BaseRateMisconfiguredError,
    );
  });

  it('rejects when ledger balance < fromAmount (InsufficientBalanceError)', async () => {
    const ledgerRepo = makeLedgerRepo('10.0'); // balance 10, need 40
    const svc = makeSwapSvc({ ledgerRepo });
    await expect(svc.createSwapProposal(BASE_SWAP_INPUT)).rejects.toThrow(
      InsufficientBalanceError,
    );
  });

  it('propagates KYC gate error without persisting a Proposal', async () => {
    class KycError extends Error {
      constructor() {
        super('KYC blocked');
      }
    }
    const kycGate = makeKycGate(new KycError());
    const proposalRepo = makeProposalRepo(FIXED_SWAP_PROPOSAL_ID);
    const svc = makeSwapSvc({ kycGate, proposalRepo });

    await expect(svc.createSwapProposal(BASE_SWAP_INPUT)).rejects.toThrow(
      KycError,
    );
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  it('persists a Quote row with type=swap', async () => {
    const quoteRepo = makeQuoteRepo(FIXED_SWAP_QUOTE_ID);
    const svc = makeSwapSvc({ quoteRepo });
    await svc.createSwapProposal(BASE_SWAP_INPUT);

    expect(quoteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'swap', asset: 'USDT' }),
    );
  });

  it('persists a Proposal row with type=swap', async () => {
    const proposalRepo = makeProposalRepo(FIXED_SWAP_PROPOSAL_ID);
    const svc = makeSwapSvc({ proposalRepo });
    await svc.createSwapProposal(BASE_SWAP_INPUT);

    expect(proposalRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'swap' }),
    );
  });

  it('folds swapSpreadBps into rate and never surfaces spread as a separate line', async () => {
    // The provider returns rate '1562.5'; after spread fold the displayed rate
    // should be <= 1562.5 (spread reduces rate). The key invariant: no spreadBps
    // field in the returned confirmation.
    const svc = makeSwapSvc();
    const result = await svc.createSwapProposal(BASE_SWAP_INPUT);
    // No spread field on confirmation (CLAUDE.md §3.1 — never surface the spread).
    expect(result.confirmation).not.toHaveProperty('spreadBps');
    // rate is a non-empty string (provider rate folded).
    expect(typeof result.confirmation.rate).toBe('string');
    expect(result.confirmation.rate.length).toBeGreaterThan(0);
  });

  it('calls KYC gate before persisting the Proposal', async () => {
    const callOrder: string[] = [];
    const kycGate = {
      assertCanTransact: jest.fn(() => {
        callOrder.push('kyc');
        return Promise.resolve();
      }),
    };
    const proposalRepo = makeProposalRepo(FIXED_SWAP_PROPOSAL_ID);
    proposalRepo.create.mockImplementation(() => {
      callOrder.push('create');
      return Promise.resolve({ id: FIXED_SWAP_PROPOSAL_ID });
    });

    const svc = makeSwapSvc({ kycGate, proposalRepo });
    await svc.createSwapProposal(BASE_SWAP_INPUT);

    expect(callOrder.indexOf('kyc')).toBeLessThan(callOrder.indexOf('create'));
  });

  it('calls swap provider getQuote to price the swap', async () => {
    const swapProvider = makeSwapProvider();
    const svc = makeSwapSvc({ swapProvider });
    await svc.createSwapProposal(BASE_SWAP_INPUT);
    expect(swapProvider.getQuote).toHaveBeenCalledTimes(1);
    expect(swapProvider.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '40',
        fromAssetId: 'br_id_USDT',
        toAssetId: 'br_id_TRX',
      }),
    );
  });

  // ── Amount-floor guard (finding #4) ──────────────────────────────────────

  it('rejects a zero swap amount with AmountTooSmallError before the provider call', async () => {
    const swapProvider = makeSwapProvider();
    const svc = makeSwapSvc({ swapProvider });

    await expect(
      svc.createSwapProposal({ ...BASE_SWAP_INPUT, amount: '0' }),
    ).rejects.toMatchObject({ code: 'AMOUNT_TOO_SMALL' });
    expect(swapProvider.getQuote).not.toHaveBeenCalled();
  });

  it('rejects a dust swap amount below the configured per-asset minimum', async () => {
    const swapProvider = makeSwapProvider();
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'swap') return { spreadBps: 100, maxDriftBps: 50 };
        if (key === 'pricing')
          return {
            assets: { USDT: { baseRates: { NGN: 1600 } } },
            minCryptoAmount: { swap: { USDT: 1 } },
          };
        if (key === 'compliance')
          return { travelRuleThresholds: { NGN: 1_000_000 } };
        return undefined;
      }),
    };
    const svc = makeSwapSvc({ swapProvider, configService });

    await expect(
      svc.createSwapProposal({ ...BASE_SWAP_INPUT, amount: '0.5' }),
    ).rejects.toMatchObject({ code: 'AMOUNT_TOO_SMALL' });
    expect(swapProvider.getQuote).not.toHaveBeenCalled();
  });
});
