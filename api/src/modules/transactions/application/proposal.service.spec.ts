/**
 * Unit tests for ProposalService (task 4.1).
 *
 * All external dependencies are mocked:
 *   - QuotesService   → mock returning a fixed QuoteBuyOutput
 *   - KycGateService  → mock that resolves by default
 *   - QUOTE_REPOSITORY  → mock IQuoteRepository
 *   - PROPOSAL_REPOSITORY → mock IProposalRepository
 *   - CLOCK            → stub returning a fixed Date
 *
 * TDD: tests written first (red), then ProposalService is implemented.
 */

import type { QuoteBuyOutput } from '@handshake-agent/contracts';
import { BuyProposalConfirmationSchema } from '@handshake-agent/contracts';

import type { Clock } from '../../../core/common/clock';
import type { QuotesService } from '../../quotes/application/quotes.service';
import type { KycGateService } from '../../identity/application/kyc-gate.service';
import type { IQuoteRepository } from './ports/quote.repository.port';
import type {
  IProposalRepository,
  CreateProposalData,
} from './ports/proposal.repository.port';
import { ProposalService } from './proposal.service';

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
  return { create: jest.fn().mockResolvedValue({ id }) };
}

function makeProposalRepo(
  id = FIXED_PROPOSAL_ID,
): jest.Mocked<IProposalRepository> {
  return {
    create: jest.fn().mockResolvedValue({ id }),
    findById: jest.fn().mockResolvedValue(null),
  };
}

const stubClock: Clock = { now: () => FIXED_NOW };

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProposalService.createBuyProposal', () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns proposalId, quoteId, and a valid BuyProposalConfirmation', async () => {
    const svc = new ProposalService(
      makeQuotesService() as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      makeQuoteRepo(),
      makeProposalRepo(),
      stubClock,
    );

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
    const svc = new ProposalService(
      makeQuotesService() as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      makeQuoteRepo(),
      makeProposalRepo(),
      stubClock,
    );

    const result = await svc.createBuyProposal(BASE_INPUT);
    // 10000 * 50 / 10000 = 50.00
    expect(result.confirmation.processingFeeAmount).toBe('50.00');
  });

  it('totalFiat = fiatAmount + processingFeeAmount (string)', async () => {
    // 10000 + 50.00 = 10050.00
    const svc = new ProposalService(
      makeQuotesService() as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      makeQuoteRepo(),
      makeProposalRepo(),
      stubClock,
    );

    const result = await svc.createBuyProposal(BASE_INPUT);
    expect(result.confirmation.totalFiat).toBe('10050.00');
  });

  it('expiresAt is now + expiresInSec as an ISO datetime string', async () => {
    const svc = new ProposalService(
      makeQuotesService() as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      makeQuoteRepo(),
      makeProposalRepo(),
      stubClock,
    );

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
    };
    const proposalRepo: IProposalRepository = {
      create: jest.fn().mockImplementation(() => {
        callOrder.push('proposal');
        return Promise.resolve({ id: FIXED_PROPOSAL_ID });
      }),
      findById: jest.fn().mockResolvedValue(null),
    };

    const svc = new ProposalService(
      makeQuotesService() as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      quoteRepo,
      proposalRepo,
      stubClock,
    );

    await svc.createBuyProposal(BASE_INPUT);
    expect(callOrder).toEqual(['quote', 'proposal']);
  });

  it('parametersChecksum is a 64-character hex string', async () => {
    // Capture what is passed to proposalRepo.create to inspect the checksum.
    const proposalRepo = makeProposalRepo();
    const svc = new ProposalService(
      makeQuotesService() as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      makeQuoteRepo(),
      proposalRepo,
      stubClock,
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
    const svc = new ProposalService(
      makeQuotesService() as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      makeQuoteRepo(),
      makeProposalRepo(),
      stubClock,
    );

    const result = await svc.createBuyProposal(BASE_INPUT);
    expect(() =>
      BuyProposalConfirmationSchema.parse(result.confirmation),
    ).not.toThrow();
  });

  // ── KYC gate failure ─────────────────────────────────────────────────────

  it('propagates KYC gate error and does NOT persist a Proposal', async () => {
    const gateError = new Error('KYC_NOT_VERIFIED');
    const kycGate = makeKycGate(gateError);
    const proposalRepo = makeProposalRepo();

    const svc = new ProposalService(
      makeQuotesService() as unknown as QuotesService,
      kycGate as unknown as KycGateService,
      makeQuoteRepo(),
      proposalRepo,
      stubClock,
    );

    await expect(svc.createBuyProposal(BASE_INPUT)).rejects.toThrow(
      'KYC_NOT_VERIFIED',
    );
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  it('KYC gate is called AFTER the Quote is persisted but BEFORE the Proposal is persisted', async () => {
    const callOrder: string[] = [];
    const quoteRepo: IQuoteRepository = {
      create: jest.fn().mockImplementation(() => {
        callOrder.push('quote');
        return Promise.resolve({ id: FIXED_QUOTE_ID });
      }),
    };
    const proposalRepo: IProposalRepository = {
      create: jest.fn().mockImplementation(() => {
        callOrder.push('proposal');
        return Promise.resolve({ id: FIXED_PROPOSAL_ID });
      }),
      findById: jest.fn().mockResolvedValue(null),
    };
    const kycGate = {
      assertCanTransact: jest.fn().mockImplementation(() => {
        callOrder.push('kyc');
        return Promise.resolve();
      }),
    };

    const svc = new ProposalService(
      makeQuotesService() as unknown as QuotesService,
      kycGate as unknown as KycGateService,
      quoteRepo,
      proposalRepo,
      stubClock,
    );

    await svc.createBuyProposal(BASE_INPUT);
    expect(callOrder).toEqual(['quote', 'kyc', 'proposal']);
  });

  // ── conversationId is optional ────────────────────────────────────────────

  it('works without conversationId', async () => {
    const svc = new ProposalService(
      makeQuotesService() as unknown as QuotesService,
      makeKycGate() as unknown as KycGateService,
      makeQuoteRepo(),
      makeProposalRepo(),
      stubClock,
    );

    const input = { userId: 'user-id-1', intent: BASE_INPUT.intent };
    await expect(svc.createBuyProposal(input)).resolves.toBeDefined();
  });
});
