/**
 * Unit tests for WebChatService — all external dependencies are fakes.
 *
 * TDD: this file was written BEFORE the service implementation.
 * Run with: pnpm --filter @handshake-agent/api test -- --testPathPattern=web-chat
 */

import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import {
  WebChatService,
  WEB_CHAT_PROPOSAL_SERVICE,
  WEB_CHAT_WALLET_SERVICE,
  WEB_CHAT_BENEFICIARY_SERVICE,
  WEB_CHAT_HISTORY_SERVICE,
  WEB_CHAT_BALANCE_SERVICE,
  WEB_CHAT_RATES_SERVICE,
} from './web-chat.service';
import { AGENT_PORT } from '../../agent/application/ports/agent.port';
import { IDENTITY_REPOSITORY } from '../../identity/application/ports/identity.repository.port';
import { CONVERSATION_REPOSITORY } from '../../conversations/application/ports/conversation.repository.port';
import { MESSAGE_REPOSITORY } from '../../conversations/application/ports/message.repository.port';
import { INTENT_REPOSITORY } from '../../conversations/application/ports/intent.repository.port';
import { REPLY_REPOSITORY } from '../../conversations/application/ports/reply.repository.port';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { StatementTokenService } from '../../transactions/application/statement-token.service';
import {
  SwapSameAssetError,
  SwapUnavailableError,
  InsufficientBalanceError,
} from '../../transactions/domain/execution-errors';
import {
  AmountTooSmallError,
  SelfSendError,
} from '../../transactions/domain/amount-guard-errors';
import {
  BeneficiaryCoolingOffError,
  BeneficiaryWrongTypeError,
} from '../../beneficiaries/domain/beneficiary-errors';
import { SanctionsBlockedError } from '../../compliance/domain/compliance-errors';

// ---------------------------------------------------------------------------
// Fake providers
// ---------------------------------------------------------------------------

const fakeAgentPort = { run: jest.fn() };
const fakeProposalService = {
  createBuyProposal: jest.fn(),
  createSellProposal: jest.fn(),
  createSendProposal: jest.fn(),
  createSwapProposal: jest.fn(),
};
const fakeWalletService = { getOrProvisionNetworkWallet: jest.fn() };
const fakeBeneficiaryService = {
  getDefault: jest.fn(),
  resolveByNickname: jest.fn(),
  listForUser: jest.fn(),
};
const fakeHistoryService = { query: jest.fn() };
const fakeBalanceService = { getBalances: jest.fn() };
const fakeRatesService = {
  getEffectiveRate: jest.fn(),
  listEffectiveRates: jest.fn(),
};
const fakeIdentityRepo = { loadUser: jest.fn() };
const fakeConversationRepo = {
  findByUserId: jest.fn(),
  create: jest.fn(),
  touch: jest.fn(),
};
const fakeMessageRepo = {
  create: jest.fn(),
  findByExternalId: jest.fn(),
  updateStatus: jest.fn(),
  findWebHistory: jest.fn(),
};
const fakeIntentRepo = { create: jest.fn() };
const fakeReplyRepo = { create: jest.fn(), updateStatus: jest.fn() };
// Statement token service: deterministic fakes so a re-issued URL is observable.
const fakeStatementTokens = {
  sign: jest.fn().mockReturnValue('fresh-token'),
  buildDownloadUrl: jest.fn(
    (token: string) =>
      `https://api.example.com/transactions/statement/download?token=${token}`,
  ),
};
const fakeAssetRegistry = {
  defaultCryptoAsset: jest.fn().mockReturnValue('USDT'),
  defaultNetworkFor: jest.fn().mockReturnValue('tron'),
  asset: jest.fn().mockReturnValue({ displayName: 'USDT' }),
  network: jest.fn().mockReturnValue({ displayName: 'TRON' }),
  formatCrypto: jest.fn((sym: string, amt: string) => `${amt} ${sym}`),
  formatFiat: jest.fn((_code: string, amt: string) => `₦${amt}`),
  isCurrencyLive: jest.fn().mockReturnValue(true),
  enabledFiats: jest.fn().mockReturnValue(['NGN']),
  // Base fiat for the sell currency-match filter (legacy-null payoutCurrency → NGN).
  defaultFiat: jest.fn().mockReturnValue('NGN'),
  isCapabilityEnabled: jest.fn().mockReturnValue(true),
  // Deterministic edge classifier used by parseAddressFromText (§3.1 — NOT the
  // model). Defaults to TRON; individual tests override as needed.
  inferNetworkForAddress: jest.fn().mockReturnValue('TRON'),
};

// Mirrors the real `gating.capabilityMinTier` code default (Task 1.2,
// api/src/core/config/configuration.ts) so the chat-entry gate is exercised
// against the SAME map the deterministic engine (KycGateService) reads.
const CAPABILITY_MIN_TIER: Record<string, string> = {
  'crypto.buy': 'tier_1',
  'crypto.receive': 'tier_1',
  'crypto.sell': 'tier_2',
  'crypto.send': 'tier_2',
  'crypto.swap': 'tier_2',
};
const fakeConfig = {
  get: jest.fn((key: string) =>
    key === 'gating' ? { capabilityMinTier: CAPABILITY_MIN_TIER } : undefined,
  ),
};

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

// tier_2: satisfies every capability's minimum tier (buy/receive at tier_1,
// sell/send/swap at tier_2), so this is the fixture for "fully able to
// transact" tests below — most of which exercise sell/send/swap.
const VERIFIED_USER = {
  id: 'user-1',
  kycStatus: 'verified',
  kycTier: 'tier_2',
  status: 'active',
  simSwapDetectedAt: null,
};

// tier_1: email-verified only (the new onboarding grant — root CLAUDE.md §3.3/
// Task 1.2/1.3). kycStatus deliberately stays NOT 'verified' (that status is
// reserved for full Sumsub KYC) — this fixture is the regression case for the
// bug this fix addresses: a tier_1 user must still get buy/receive/check_balance,
// gated on kycTier, never on the stale kycStatus check.
const TIER_1_USER = {
  id: 'user-1',
  kycStatus: 'not_started',
  kycTier: 'tier_1',
  status: 'active',
  simSwapDetectedAt: null,
};

const UNVERIFIED_USER = {
  id: 'user-1',
  kycStatus: 'pending',
  kycTier: 'none',
  status: 'active',
  simSwapDetectedAt: null,
};

const CONVERSATION = {
  id: 'conv-1',
  userId: 'user-1',
  contactId: null,
  status: 'active',
  lastMessageAt: null,
  createdAt: new Date(),
};

const MESSAGE = {
  id: 'msg-1',
  conversationId: 'conv-1',
  externalMessageId: 'ext-1',
  channel: 'web',
  senderAddress: 'user-1',
  text: 'hello',
  rawUserText: 'hello',
  processingStatus: 'received',
  correlationId: 'corr-1',
  createdAt: new Date(),
};

const REPLY = {
  id: 'reply-1',
  conversationId: 'conv-1',
  messageId: 'msg-1',
  text: '',
  status: 'sent',
  correlationId: 'corr-1',
  createdAt: new Date(),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('WebChatService', () => {
  let service: WebChatService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default happy-path mocks
    fakeIdentityRepo.loadUser.mockResolvedValue(VERIFIED_USER);
    fakeConversationRepo.findByUserId.mockResolvedValue(CONVERSATION);
    fakeConversationRepo.touch.mockResolvedValue(undefined);
    fakeMessageRepo.create.mockResolvedValue(MESSAGE);
    fakeIntentRepo.create.mockResolvedValue({ id: 'intent-1' });
    fakeReplyRepo.create.mockResolvedValue(REPLY);

    const module = await Test.createTestingModule({
      providers: [
        WebChatService,
        { provide: AGENT_PORT, useValue: fakeAgentPort },
        { provide: WEB_CHAT_PROPOSAL_SERVICE, useValue: fakeProposalService },
        { provide: WEB_CHAT_WALLET_SERVICE, useValue: fakeWalletService },
        {
          provide: WEB_CHAT_BENEFICIARY_SERVICE,
          useValue: fakeBeneficiaryService,
        },
        { provide: WEB_CHAT_HISTORY_SERVICE, useValue: fakeHistoryService },
        { provide: WEB_CHAT_BALANCE_SERVICE, useValue: fakeBalanceService },
        { provide: WEB_CHAT_RATES_SERVICE, useValue: fakeRatesService },
        { provide: IDENTITY_REPOSITORY, useValue: fakeIdentityRepo },
        { provide: CONVERSATION_REPOSITORY, useValue: fakeConversationRepo },
        { provide: MESSAGE_REPOSITORY, useValue: fakeMessageRepo },
        { provide: INTENT_REPOSITORY, useValue: fakeIntentRepo },
        { provide: REPLY_REPOSITORY, useValue: fakeReplyRepo },
        { provide: AssetRegistry, useValue: fakeAssetRegistry },
        { provide: StatementTokenService, useValue: fakeStatementTokens },
        { provide: EffectiveConfigService, useValue: fakeConfig },
      ],
    }).compile();

    service = module.get(WebChatService);
  });

  // ── User not found ─────────────────────────────────────────────────────────

  it('throws NotFoundException when user is not found', async () => {
    fakeIdentityRepo.loadUser.mockResolvedValue(null);
    await expect(
      service.handleMessage({ userId: 'ghost', text: 'hi' }),
    ).rejects.toThrow(NotFoundException);
  });

  // ── agent / LLM failure → AgentUnavailableError (I1/I2) ─────────────────────

  it('wraps a provider outage in AgentUnavailableError (never an opaque 500)', async () => {
    // A genuine provider outage (network/timeout/auth/5xx) is the one external,
    // flaky dependency in this flow. When it throws, the service must surface a
    // typed AgentUnavailableError so the global filter maps it to a 5xx with a
    // clean message — not let the raw provider error bubble to an opaque 500.
    fakeAgentPort.run.mockRejectedValue(new Error('anthropic 529 overloaded'));

    await expect(
      service.handleMessage({ userId: 'user-1', text: 'buy 5 USDT' }),
    ).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE' });
  });

  // ── unparseable intent (ZodError) → clarification, NOT a 503 ─────────────────

  it('an unparseable intent (ZodError) becomes a clarification, not an AgentUnavailableError', async () => {
    // The model returned output that failed IntentSchema.parse (missing/invalid
    // action). This is NOT a provider outage — the model is up, it just produced
    // something we cannot route. Ask the user to rephrase instead of a 503.
    fakeAgentPort.run.mockRejectedValue(
      new z.ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'undefined',
          path: ['action'],
          message: 'Required',
        },
      ]),
    );

    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'asdkjfh qwe',
    });

    expect(result.outcome.kind).toBe('clarification');
    expect(
      (result.outcome as { kind: 'clarification'; text: string }).text,
    ).toMatch(/rephrase|didn't (quite )?(catch|understand)|try again/i);
  });

  // ── multi-turn memory: prior turns threaded into the agent ───────────────────

  describe('conversation history (multi-turn memory)', () => {
    it('loads recent turns and threads them oldest→newest into the agent call', async () => {
      // Repo returns newest-first (DESC). The service must reverse to chronological
      // order and emit one user turn + one assistant turn per row.
      fakeMessageRepo.findWebHistory.mockResolvedValue([
        {
          id: 'm-2',
          userText: 'how much USDT?',
          createdAt: new Date('2026-06-30T10:01:00Z'),
          reply: {
            text: 'How much USDT would you like to buy?',
            outcome: { kind: 'clarification', text: 'How much USDT?' },
          },
        },
        {
          id: 'm-1',
          userText: 'buy usdt',
          createdAt: new Date('2026-06-30T10:00:00Z'),
          reply: {
            text: 'Sure — which asset?',
            outcome: { kind: 'clarification', text: 'Which asset?' },
          },
        },
      ]);
      fakeAgentPort.run.mockResolvedValue({
        action: 'none',
        clarification: 'ok',
      });

      await service.handleMessage({ userId: 'user-1', text: '50k' });

      // History is server-built (authoritative) — never taken from the request body.
      const historyCall = fakeMessageRepo.findWebHistory.mock.calls[0] as [
        string,
        { limit: number },
      ];
      expect(historyCall[0]).toBe('conv-1');
      expect(typeof historyCall[1].limit).toBe('number');
      // The agent receives the current text + history (oldest first).
      const [text, history] = fakeAgentPort.run.mock.calls[0] as [
        string,
        Array<{ role: string; content: string }>,
      ];
      expect(text).toBe('50k');
      expect(history[0]).toEqual({ role: 'user', content: 'buy usdt' });
      expect(history[history.length - 1]).toEqual({
        role: 'assistant',
        content: 'How much USDT would you like to buy?',
      });
    });

    it('threads an empty history when there are no prior turns', async () => {
      fakeMessageRepo.findWebHistory.mockResolvedValue([]);
      fakeAgentPort.run.mockResolvedValue({
        action: 'none',
        clarification: 'ok',
      });

      await service.handleMessage({ userId: 'user-1', text: 'hi' });

      const [, history] = fakeAgentPort.run.mock.calls[0] as [
        string,
        Array<{ role: string; content: string }>,
      ];
      expect(history).toEqual([]);
    });
  });

  // ── none intent → clarification ────────────────────────────────────────────

  it('none intent → clarification outcome', async () => {
    fakeAgentPort.run.mockResolvedValue({
      action: 'none',
      clarification: 'Did you mean buy or sell?',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'blah',
    });
    expect(result.outcome).toEqual({
      kind: 'clarification',
      text: 'Did you mean buy or sell?',
    });
    expect(result.conversationId).toBe('conv-1');
    expect(result.messageId).toBe('msg-1');
  });

  // ── receive_crypto, unverified → needs_kyc ─────────────────────────────────

  it('receive_crypto intent, unverified user → needs_kyc', async () => {
    fakeIdentityRepo.loadUser.mockResolvedValue(UNVERIFIED_USER);
    fakeAgentPort.run.mockResolvedValue({
      action: 'receive_crypto',
      asset: 'USDT',
      network: 'tron',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'receive',
    });
    expect(result.outcome).toEqual({ kind: 'needs_kyc' });
  });

  // ── receive_crypto, verified → receive outcome ─────────────────────────────

  it('receive_crypto intent, verified user → receive outcome with address', async () => {
    fakeWalletService.getOrProvisionNetworkWallet.mockResolvedValue({
      id: 'w1',
      userId: 'user-1',
      network: 'tron',
      address: 'TXxxx',
      providerReference: 'ref',
      status: 'active',
      provisionedAt: new Date(),
    });
    fakeAgentPort.run.mockResolvedValue({
      action: 'receive_crypto',
      asset: 'USDT',
      network: 'tron',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'receive',
    });
    expect(result.outcome.kind).toBe('receive');
    expect(
      (result.outcome as { kind: 'receive'; deposit: { address: string } })
        .deposit.address,
    ).toBe('TXxxx');
  });

  // ── receive_crypto, verified, USDT asset → deposit labelled USDT ──────────

  it('receive_crypto with explicit USDT asset → outcome.deposit.asset is USDT', async () => {
    fakeWalletService.getOrProvisionNetworkWallet.mockResolvedValue({
      id: 'w1',
      userId: 'user-1',
      network: 'tron',
      address: 'TXxxx',
      providerReference: 'ref',
      status: 'active',
      provisionedAt: new Date(),
    });
    fakeAgentPort.run.mockResolvedValue({
      action: 'receive_crypto',
      asset: 'USDT',
      network: 'tron',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'I want to receive USDT',
    });
    expect(result.outcome.kind).toBe('receive');
    const deposit = (
      result.outcome as { kind: 'receive'; deposit: { asset: string } }
    ).deposit;
    expect(deposit.asset).toBe('USDT');
  });

  // ── receive_crypto, verified, TRX asset → deposit labelled TRX ────────────

  it('receive_crypto with explicit TRX asset → outcome.deposit.asset is TRX (same address)', async () => {
    fakeWalletService.getOrProvisionNetworkWallet.mockResolvedValue({
      id: 'w1',
      userId: 'user-1',
      network: 'tron',
      address: 'TXxxx',
      providerReference: 'ref',
      status: 'active',
      provisionedAt: new Date(),
    });
    // Agent named TRX — the outcome must reflect TRX, not default to USDT.
    fakeAgentPort.run.mockResolvedValue({
      action: 'receive_crypto',
      asset: 'TRX',
      network: 'tron',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'I want to receive TRX',
    });
    expect(result.outcome.kind).toBe('receive');
    const deposit = (
      result.outcome as {
        kind: 'receive';
        deposit: { asset: string; address: string };
      }
    ).deposit;
    // Label must be TRX; address is the same TRON address (shared on TRON).
    expect(deposit.asset).toBe('TRX');
    expect(deposit.address).toBe('TXxxx');
  });

  // ── receive_crypto, no asset in intent → falls back to default ─────────────

  it('receive_crypto with no asset in intent → outcome.deposit.asset is the registry default', async () => {
    fakeWalletService.getOrProvisionNetworkWallet.mockResolvedValue({
      id: 'w1',
      userId: 'user-1',
      network: 'tron',
      address: 'TXxxx',
      providerReference: 'ref',
      status: 'active',
      provisionedAt: new Date(),
    });
    // No asset field — model did not name one.
    fakeAgentPort.run.mockResolvedValue({
      action: 'receive_crypto',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'I want to receive',
    });
    expect(result.outcome.kind).toBe('receive');
    const deposit = (
      result.outcome as { kind: 'receive'; deposit: { asset: string } }
    ).deposit;
    // fakeAssetRegistry.defaultCryptoAsset returns 'USDT'
    expect(deposit.asset).toBe('USDT');
  });

  // ── buy_ticket → not_supported ────────────────────────────────────────────

  it('buy_ticket intent → not_supported outcome', async () => {
    fakeAgentPort.run.mockResolvedValue({ action: 'buy_ticket' });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'buy_ticket',
    });
    expect(result.outcome).toEqual({
      kind: 'not_supported',
      action: 'buy_ticket',
    });
  });

  // ── swap, capability disabled → not_supported ──────────────────────────────

  it('swap intent, crypto.swap capability disabled → not_supported outcome', async () => {
    fakeAssetRegistry.isCapabilityEnabled.mockReturnValueOnce(false);
    fakeAgentPort.run.mockResolvedValue({
      action: 'swap',
      fromAsset: 'USDT',
      toAsset: 'TRX',
      amount: '10',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'swap 10 USDT to TRX',
    });
    expect(result.outcome).toEqual({ kind: 'not_supported', action: 'swap' });
    expect(fakeProposalService.createSwapProposal).not.toHaveBeenCalled();
  });

  // ── swap, unverified user → needs_kyc ─────────────────────────────────────

  it('swap intent, unverified user → needs_kyc', async () => {
    fakeIdentityRepo.loadUser.mockResolvedValue(UNVERIFIED_USER);
    fakeAgentPort.run.mockResolvedValue({
      action: 'swap',
      fromAsset: 'USDT',
      toAsset: 'TRX',
      amount: '10',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'swap 10 USDT to TRX',
    });
    expect(result.outcome).toEqual({ kind: 'needs_kyc' });
    expect(fakeProposalService.createSwapProposal).not.toHaveBeenCalled();
  });

  // ── swap, verified, capability live → proposal ─────────────────────────────

  it('swap intent, verified user, capability live → swap proposal outcome', async () => {
    const swapConf = {
      proposalId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      fromAsset: 'USDT',
      toAsset: 'TRX',
      fromAmount: '10',
      toAmount: '12345.67',
      rate: '1234.567',
      networkFee: '0.5',
      transactionFee: '0.1',
      estimatedArrivalSec: 30,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    };
    fakeProposalService.createSwapProposal.mockResolvedValue({
      proposalId: swapConf.proposalId,
      quoteId: 'q-swap-1',
      confirmation: swapConf,
    });
    fakeAgentPort.run.mockResolvedValue({
      action: 'swap',
      fromAsset: 'USDT',
      toAsset: 'TRX',
      amount: '10',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'swap 10 USDT to TRX',
    });
    expect(result.outcome).toMatchObject({
      kind: 'proposal',
      txType: 'swap',
      proposalId: swapConf.proposalId,
    });
    expect(fakeProposalService.createSwapProposal).toHaveBeenCalledWith({
      userId: 'user-1',
      fromAsset: 'USDT',
      toAsset: 'TRX',
      amount: '10',
    });
  });

  // ── swap, fromAsset === toAsset → graceful clarification (no opaque 500) ──────

  it('swap intent, fromAsset === toAsset → graceful clarification, not an error', async () => {
    // The engine throws SwapSameAssetError for an identical from/to asset. This is
    // an ordinary user-input mistake, not a server fault — surface it inline as a
    // clarification so the chat thread guides the user, never an opaque 500.
    fakeProposalService.createSwapProposal.mockRejectedValue(
      new SwapSameAssetError('USDT'),
    );
    fakeAgentPort.run.mockResolvedValue({
      action: 'swap',
      fromAsset: 'USDT',
      toAsset: 'USDT',
      amount: '10',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'swap 10 USDT to USDT',
    });
    expect(result.outcome).toMatchObject({ kind: 'clarification' });
    expect(
      (result.outcome as { kind: 'clarification'; text: string }).text,
    ).toMatch(/two different assets/i);
  });

  // ── swap, provider not available → not_supported (graceful) ──────────────────

  it('swap intent, SwapUnavailableError from provider → not_supported (not a 500)', async () => {
    fakeProposalService.createSwapProposal.mockRejectedValue(
      new SwapUnavailableError(),
    );
    fakeAgentPort.run.mockResolvedValue({
      action: 'swap',
      fromAsset: 'USDT',
      toAsset: 'TRX',
      amount: '10',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'swap 10 USDT to TRX',
    });
    expect(result.outcome).toMatchObject({
      kind: 'not_supported',
      action: 'swap',
    });
  });

  // ── swap, unexpected error → still propagates to the global filter ────────────

  it('swap intent, unexpected error → propagates (mapped to 500 by the filter)', async () => {
    fakeProposalService.createSwapProposal.mockRejectedValue(
      new Error('unexpected boom'),
    );
    fakeAgentPort.run.mockResolvedValue({
      action: 'swap',
      fromAsset: 'USDT',
      toAsset: 'TRX',
      amount: '10',
    });
    await expect(
      service.handleMessage({ userId: 'user-1', text: 'swap 10 USDT to TRX' }),
    ).rejects.toThrow('unexpected boom');
  });

  // ── query_transactions → transactions outcome ─────────────────────────────

  it('query_transactions intent → transactions outcome', async () => {
    fakeHistoryService.query.mockResolvedValue({
      window: { from: 'F', to: 'T', label: 'This month' },
      items: [],
      totalCount: 0,
      truncated: false,
      downloadUrl:
        'https://api.example.com/transactions/statement/download?token=tok',
    });
    fakeAgentPort.run.mockResolvedValue({
      action: 'query_transactions',
      period: 'this_month',
      download: false,
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'my transactions this month',
    });
    expect(result.outcome.kind).toBe('transactions');
    expect(fakeHistoryService.query).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ period: 'this_month' }),
    );
  });

  it('forwards a relative-duration spec to the history service', async () => {
    fakeHistoryService.query.mockResolvedValue({
      window: { from: 'F', to: 'T', label: 'Last 2 weeks' },
      items: [],
      totalCount: 0,
      truncated: false,
      hasMore: false,
      nextCursor: null,
      txType: 'all',
      downloadUrl:
        'https://api.example.com/transactions/statement/download?token=tok',
    });
    fakeAgentPort.run.mockResolvedValue({
      action: 'query_transactions',
      relativeAmount: 2,
      relativeUnit: 'week',
      download: false,
    });
    await service.handleMessage({
      userId: 'user-1',
      text: 'my transactions in the last 2 weeks',
    });
    expect(fakeHistoryService.query).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ relativeAmount: 2, relativeUnit: 'week' }),
    );
  });

  // ── check_balance, verified → balance outcome ──────────────────────────────

  it('check_balance intent (all assets), verified → balance outcome', async () => {
    fakeBalanceService.getBalances.mockResolvedValue({
      fiatCurrency: 'NGN',
      totalFiatValue: '16800.00',
      balances: [
        {
          asset: 'USDT',
          network: 'TRON',
          amount: '10.5',
          fiatValue: '16800.00',
        },
      ],
    });
    fakeAgentPort.run.mockResolvedValue({ action: 'check_balance' });

    const result = await service.handleMessage({
      userId: 'user-1',
      text: "what's my balance",
    });

    expect(fakeBalanceService.getBalances).toHaveBeenCalledWith(
      'user-1',
      undefined,
    );
    expect(result.outcome).toMatchObject({
      kind: 'balance',
      fiatCurrency: 'NGN',
      totalFiatValue: '16800.00',
    });
    expect(
      (result.outcome as { kind: 'balance'; balances: unknown[] }).balances,
    ).toHaveLength(1);
    // The reply text surfaces the holding (no FX-spread line).
    expect(result.reply.text).toContain('USDT');
  });

  it('check_balance intent scoped to USDT → passes the asset through', async () => {
    fakeBalanceService.getBalances.mockResolvedValue({
      fiatCurrency: 'NGN',
      asset: 'USDT',
      balances: [{ asset: 'USDT', network: 'TRON', amount: '10.5' }],
    });
    fakeAgentPort.run.mockResolvedValue({
      action: 'check_balance',
      asset: 'USDT',
    });

    const result = await service.handleMessage({
      userId: 'user-1',
      text: "what's my USDT balance",
    });

    expect(fakeBalanceService.getBalances).toHaveBeenCalledWith(
      'user-1',
      'USDT',
    );
    expect(result.outcome).toMatchObject({ kind: 'balance', asset: 'USDT' });
  });

  it('check_balance intent, unverified user → needs_kyc', async () => {
    fakeIdentityRepo.loadUser.mockResolvedValue(UNVERIFIED_USER);
    fakeAgentPort.run.mockResolvedValue({ action: 'check_balance' });

    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'balance',
    });

    expect(result.outcome).toEqual({ kind: 'needs_kyc' });
    expect(fakeBalanceService.getBalances).not.toHaveBeenCalled();
  });

  // ── get_rate / list_rates (Wave K — read-only rate discovery, §3.1) ─────────

  it('get_rate intent → reads RatesService and replies with the folded pair rate (no proposal)', async () => {
    fakeRatesService.getEffectiveRate.mockResolvedValue({
      asset: 'USDT',
      fiatCurrency: 'NGN',
      buyRate: '1610.5',
      sellRate: '1585.25',
      source: 'live',
      asOf: '2026-07-09T10:00:00.000Z',
    });
    fakeAgentPort.run.mockResolvedValue({
      action: 'get_rate',
      asset: 'USDT',
      fiatCurrency: 'NGN',
    });

    const result = await service.handleMessage({
      userId: 'user-1',
      text: "what's the USDT/NGN rate?",
    });

    expect(fakeRatesService.getEffectiveRate).toHaveBeenCalledWith(
      'USDT',
      'NGN',
    );
    // Read-only: the model proposes nothing — no proposal is ever created (§3.1).
    expect(fakeProposalService.createBuyProposal).not.toHaveBeenCalled();
    expect(fakeProposalService.createSellProposal).not.toHaveBeenCalled();
    // Rendered through the general text channel (`clarification`), never a new card.
    expect(result.outcome.kind).toBe('clarification');
    // Both folded directions surface; the FX spread is never itemized.
    expect(result.reply.text).toContain('1610.5');
    expect(result.reply.text).toContain('1585.25');
    expect(result.reply.text).toContain('USDT');
  });

  it('get_rate with no fiat defaults to the catalog base fiat', async () => {
    fakeRatesService.getEffectiveRate.mockResolvedValue({
      asset: 'USDT',
      fiatCurrency: 'NGN',
      buyRate: '1610',
      sellRate: '1585',
      source: 'config',
      asOf: '2026-07-09T10:00:00.000Z',
    });
    fakeAgentPort.run.mockResolvedValue({ action: 'get_rate', asset: 'USDT' });

    await service.handleMessage({ userId: 'user-1', text: 'usdt price' });

    // fiatCurrency omitted → resolved from AssetRegistry.defaultFiat() ('NGN' here).
    expect(fakeRatesService.getEffectiveRate).toHaveBeenCalledWith(
      'USDT',
      'NGN',
    );
  });

  it('get_rate for an unpriced pair → graceful "no rate" clarification, never a 5xx', async () => {
    fakeRatesService.getEffectiveRate.mockRejectedValue(
      new Error('no base rate for USDT/ZAR'),
    );
    fakeAgentPort.run.mockResolvedValue({
      action: 'get_rate',
      asset: 'USDT',
      fiatCurrency: 'ZAR',
    });

    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'usdt to rand',
    });

    expect(result.outcome.kind).toBe('clarification');
    expect(result.reply.text).toMatch(/don't have a rate|try again/i);
  });

  it('list_rates intent → reads RatesService and lists every priced pair (no proposal)', async () => {
    fakeRatesService.listEffectiveRates.mockResolvedValue({
      rates: [
        {
          asset: 'USDT',
          fiatCurrency: 'NGN',
          buyRate: '1610',
          sellRate: '1585',
          source: 'live',
          asOf: '2026-07-09T10:00:00.000Z',
        },
        {
          asset: 'TRX',
          fiatCurrency: 'NGN',
          buyRate: '250',
          sellRate: '240',
          source: 'config',
          asOf: '2026-07-09T10:00:00.000Z',
        },
      ],
    });
    fakeAgentPort.run.mockResolvedValue({ action: 'list_rates' });

    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'show me all the rates',
    });

    expect(fakeRatesService.listEffectiveRates).toHaveBeenCalledTimes(1);
    expect(fakeProposalService.createBuyProposal).not.toHaveBeenCalled();
    expect(result.outcome.kind).toBe('clarification');
    expect(result.reply.text).toContain('USDT');
    expect(result.reply.text).toContain('TRX');
    expect(result.reply.text).toContain('1610');
    expect(result.reply.text).toContain('250');
  });

  it('list_rates with no priced pairs → graceful empty message', async () => {
    fakeRatesService.listEffectiveRates.mockResolvedValue({ rates: [] });
    fakeAgentPort.run.mockResolvedValue({ action: 'list_rates' });

    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'rates',
    });

    expect(result.outcome.kind).toBe('clarification');
    expect(result.reply.text).toMatch(/no rates/i);
  });

  // ── buy_crypto, unverified → needs_kyc ────────────────────────────────────

  it('buy_crypto intent, unverified user → needs_kyc', async () => {
    fakeIdentityRepo.loadUser.mockResolvedValue(UNVERIFIED_USER);
    fakeAgentPort.run.mockResolvedValue({
      action: 'buy_crypto',
      asset: 'USDT',
      fiatAmount: '5000',
      fiatCurrency: 'NGN',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'buy',
    });
    expect(result.outcome).toEqual({ kind: 'needs_kyc' });
  });

  // ── buy_crypto, verified → proposal outcome ────────────────────────────────

  it('buy_crypto intent, verified user → proposal outcome', async () => {
    const buyConf = {
      proposalId: 'prop-1',
      asset: 'USDT',
      fiatAmount: '5000',
      fiatCurrency: 'NGN',
      cryptoAmount: '5.0',
      fxRate: '1000',
      spreadBps: 50,
      processingFeeBps: 100,
      processingFeeAmount: '50.00',
      totalFiat: '5050.00',
      expiresAt: new Date().toISOString(),
    };
    fakeProposalService.createBuyProposal.mockResolvedValue({
      proposalId: 'prop-1',
      quoteId: 'q-1',
      confirmation: buyConf,
    });
    fakeAgentPort.run.mockResolvedValue({
      action: 'buy_crypto',
      asset: 'USDT',
      fiatAmount: '5000',
      fiatCurrency: 'NGN',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'buy 5000 NGN of USDT',
    });
    expect(result.outcome).toMatchObject({
      kind: 'proposal',
      txType: 'buy',
      proposalId: 'prop-1',
    });
  });

  // ── sell_crypto, verified, no default beneficiary → needs_beneficiary ──────

  it('sell_crypto, verified, no default beneficiary → needs_beneficiary', async () => {
    fakeBeneficiaryService.getDefault.mockResolvedValue(null);
    fakeAgentPort.run.mockResolvedValue({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '5',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'sell',
    });
    expect(result.outcome).toEqual({
      kind: 'needs_beneficiary',
      beneficiaryType: 'bank_account',
    });
  });

  // ── sell currency filter (Wave G): non-matching default → needs_beneficiary ─

  it('sell_crypto with a currency: routes to a matching-currency default bank', async () => {
    // Default bank pays out in NGN; sell is NGN → used directly.
    fakeBeneficiaryService.getDefault.mockResolvedValue({
      id: 'bank-ngn',
      payoutCurrency: 'NGN',
    });
    fakeProposalService.createSellProposal.mockResolvedValue({
      proposalId: 'p-sell',
      quoteId: 'q-2',
      confirmation: {
        proposalId: 'p-sell',
        asset: 'USDT',
        cryptoAmount: '5',
        fiatCurrency: 'NGN',
        netFiatAmount: '4800',
        fxRate: '1000',
        processingFeeAmount: '50.00',
        expiresAt: new Date().toISOString(),
      },
    });
    fakeAgentPort.run.mockResolvedValue({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '5',
      fiatCurrency: 'NGN',
    });

    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'sell',
    });

    expect(result.outcome).toMatchObject({ kind: 'proposal', txType: 'sell' });
    expect(fakeBeneficiaryService.getDefault).toHaveBeenCalledWith(
      'user-1',
      'bank_account',
    );
  });

  it('sell_crypto with a currency: prompts to add a matching-currency bank when only a wrong-currency default exists', async () => {
    // Default bank pays NGN, but the sell is GHS and there is no GHS bank.
    fakeBeneficiaryService.getDefault.mockResolvedValue({
      id: 'bank-ngn',
      payoutCurrency: 'NGN',
    });
    fakeBeneficiaryService.listForUser.mockResolvedValue([
      { id: 'bank-ngn', payoutCurrency: 'NGN' },
    ]);
    fakeAgentPort.run.mockResolvedValue({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '5',
      fiatCurrency: 'GHS',
    });

    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'sell',
    });

    expect(result.outcome).toMatchObject({
      kind: 'needs_beneficiary',
      beneficiaryType: 'bank_account',
    });
    expect(fakeProposalService.createSellProposal).not.toHaveBeenCalled();
  });

  // ── sell_crypto, verified, beneficiary exists → proposal ──────────────────

  it('sell_crypto, verified, beneficiary exists → proposal outcome', async () => {
    fakeBeneficiaryService.getDefault.mockResolvedValue({ id: 'bene-1' });
    const sellConf = {
      proposalId: 'p-sell',
      asset: 'USDT',
      cryptoAmount: '5',
      fiatCurrency: 'NGN',
      netFiatAmount: '4800',
      fxRate: '1000',
      processingFeeAmount: '50.00',
      expiresAt: new Date().toISOString(),
    };
    fakeProposalService.createSellProposal.mockResolvedValue({
      proposalId: 'p-sell',
      quoteId: 'q-2',
      confirmation: sellConf,
    });
    fakeAgentPort.run.mockResolvedValue({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '5',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'sell 5 USDT',
    });
    expect(result.outcome).toMatchObject({
      kind: 'proposal',
      txType: 'sell',
      proposalId: 'p-sell',
    });
  });

  // ── sell_crypto proposal-error parity → graceful clarification (no 4xx/5xx) ──

  describe('sell_crypto proposal errors → clarification (not an unhandled throw)', () => {
    const sellIntent = {
      action: 'sell_crypto' as const,
      asset: 'USDT',
      cryptoAmount: '5',
      fiatCurrency: 'NGN',
    };

    beforeEach(() => {
      fakeBeneficiaryService.getDefault.mockResolvedValue({ id: 'bene-1' });
    });

    it.each([
      [
        'InsufficientBalanceError',
        new InsufficientBalanceError('1', '5', 'USDT'),
      ],
      [
        'AmountTooSmallError',
        new AmountTooSmallError('sell', '0.1', '1', 'USDT'),
      ],
      [
        'SanctionsBlockedError',
        new SanctionsBlockedError('addr', 'flagged', 'evt-1', 'ref-1'),
      ],
    ])('maps %s to a clarification outcome', async (_label, err: Error) => {
      fakeProposalService.createSellProposal.mockRejectedValue(err);
      fakeAgentPort.run.mockResolvedValue(sellIntent);

      const result = await service.handleMessage({
        userId: 'user-1',
        text: 'sell 5 USDT',
      });

      expect(result.outcome.kind).toBe('clarification');
      expect(
        (result.outcome as { kind: 'clarification'; text: string }).text,
      ).toBeTruthy();
    });

    it('still propagates an unexpected error (mapped to 500 by the filter)', async () => {
      fakeProposalService.createSellProposal.mockRejectedValue(
        new Error('unexpected boom'),
      );
      fakeAgentPort.run.mockResolvedValue(sellIntent);

      await expect(
        service.handleMessage({ userId: 'user-1', text: 'sell 5 USDT' }),
      ).rejects.toThrow('unexpected boom');
    });
  });

  // ── buy_crypto with non-live currency → currency_not_live (never a proposal) ──

  it('buy_crypto with non-live fiatCurrency (RWF) → currency_not_live, no proposal', async () => {
    // RWF is in FiatCurrencySchema but not enabled in config (enabled: false).
    fakeAssetRegistry.isCurrencyLive.mockReturnValueOnce(false);
    fakeAgentPort.run.mockResolvedValue({
      action: 'buy_crypto',
      asset: 'USDT',
      fiatAmount: '50000',
      fiatCurrency: 'RWF',
    });

    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'buy 50000 RWF of USDT',
    });

    expect(result.outcome).toEqual({
      kind: 'currency_not_live',
      currency: 'RWF',
      // The live settlement set comes from the AssetRegistry's enabled fiats so
      // the FE copy is catalog-driven, never a hardcoded constant.
      liveCurrencies: ['NGN'],
    });
    expect(fakeProposalService.createBuyProposal).not.toHaveBeenCalled();
  });

  it('buy_crypto currency_not_live carries ALL live fiats when more than one is enabled', async () => {
    fakeAssetRegistry.isCurrencyLive.mockReturnValueOnce(false);
    fakeAssetRegistry.enabledFiats.mockReturnValueOnce(['NGN', 'GHS']);
    fakeAgentPort.run.mockResolvedValue({
      action: 'buy_crypto',
      asset: 'USDT',
      fiatAmount: '50000',
      fiatCurrency: 'RWF',
    });

    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'buy 50000 RWF of USDT',
    });

    expect(result.outcome).toEqual({
      kind: 'currency_not_live',
      currency: 'RWF',
      liveCurrencies: ['NGN', 'GHS'],
    });
  });

  it('buy_crypto with live fiatCurrency (NGN) → normal proposal path', async () => {
    fakeAssetRegistry.isCurrencyLive.mockReturnValueOnce(true);
    const buyConf = {
      proposalId: 'prop-live',
      asset: 'USDT',
      fiatAmount: '5000',
      fiatCurrency: 'NGN',
      cryptoAmount: '5.0',
      fxRate: '1000',
      spreadBps: 50,
      processingFeeBps: 100,
      processingFeeAmount: '50.00',
      totalFiat: '5050.00',
      expiresAt: new Date().toISOString(),
    };
    fakeProposalService.createBuyProposal.mockResolvedValue({
      proposalId: 'prop-live',
      quoteId: 'q-live',
      confirmation: buyConf,
    });
    fakeAgentPort.run.mockResolvedValue({
      action: 'buy_crypto',
      asset: 'USDT',
      fiatAmount: '5000',
      fiatCurrency: 'NGN',
    });

    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'buy 5000 NGN of USDT',
    });

    expect(result.outcome).toMatchObject({
      kind: 'proposal',
      txType: 'buy',
      proposalId: 'prop-live',
    });
  });

  // ── sell_crypto with non-live currency → currency_not_live ─────────────────

  it('sell_crypto with non-live fiatCurrency (RWF) → currency_not_live, no proposal', async () => {
    fakeAssetRegistry.isCurrencyLive.mockReturnValueOnce(false);
    fakeAgentPort.run.mockResolvedValue({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '5',
      fiatCurrency: 'RWF',
    });

    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'sell 5 USDT for RWF',
    });

    expect(result.outcome).toEqual({
      kind: 'currency_not_live',
      currency: 'RWF',
      liveCurrencies: ['NGN'],
    });
    expect(fakeProposalService.createSellProposal).not.toHaveBeenCalled();
    expect(fakeBeneficiaryService.getDefault).not.toHaveBeenCalled();
  });

  // ── sell_crypto, unverified → needs_kyc ───────────────────────────────────

  it('sell_crypto intent, unverified user → needs_kyc', async () => {
    fakeIdentityRepo.loadUser.mockResolvedValue(UNVERIFIED_USER);
    fakeAgentPort.run.mockResolvedValue({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '5',
      fiatCurrency: 'NGN',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'sell',
    });
    expect(result.outcome).toEqual({ kind: 'needs_kyc' });
  });

  // ── send_crypto, unverified → needs_kyc ───────────────────────────────────

  it('send_crypto intent, unverified user → needs_kyc', async () => {
    fakeIdentityRepo.loadUser.mockResolvedValue(UNVERIFIED_USER);
    fakeAgentPort.run.mockResolvedValue({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '2',
      toAddress: 'TYyyy',
      network: 'tron',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'send',
    });
    expect(result.outcome).toEqual({ kind: 'needs_kyc' });
  });

  // ── send_crypto, verified + beneficiary → proposal ────────────────────────

  it('send_crypto, verified, beneficiary exists → proposal outcome', async () => {
    fakeBeneficiaryService.getDefault.mockResolvedValue({
      id: 'bene-crypto-1',
    });
    const sendConf = {
      proposalId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      asset: 'USDT',
      cryptoAmount: '2',
      network: 'tron',
      networkFeeCrypto: '1.0',
      totalDebit: '3.0',
      toAddressMasked: 'TYyyy...Zzzz',
      beneficiaryLabel: 'My wallet',
      expiresAt: new Date().toISOString(),
    };
    fakeProposalService.createSendProposal.mockResolvedValue({
      proposalId: sendConf.proposalId,
      confirmation: sendConf,
    });
    fakeAgentPort.run.mockResolvedValue({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '2',
      toAddress: 'TYyyyZzzz',
      network: 'tron',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'send 2 USDT',
    });
    expect(result.outcome).toMatchObject({
      kind: 'proposal',
      txType: 'send',
      proposalId: sendConf.proposalId,
    });
  });

  // ── send_crypto proposal-error parity → graceful clarification ───────────────

  describe('send_crypto proposal errors → clarification (not an unhandled throw)', () => {
    const sendIntent = {
      action: 'send_crypto' as const,
      asset: 'USDT',
      cryptoAmount: '2',
      toAddress: 'TYyyyZzzz',
      network: 'tron',
    };

    beforeEach(() => {
      fakeBeneficiaryService.getDefault.mockResolvedValue({
        id: 'bene-crypto-1',
      });
    });

    it.each([
      [
        'InsufficientBalanceError',
        new InsufficientBalanceError('1', '5', 'USDT'),
      ],
      [
        'BeneficiaryCoolingOffError',
        new BeneficiaryCoolingOffError(
          'bene-crypto-1',
          new Date(Date.now() + 1e6),
        ),
      ],
      [
        'BeneficiaryWrongTypeError',
        new BeneficiaryWrongTypeError(
          'bene-crypto-1',
          'crypto_address',
          'bank_account',
        ),
      ],
      [
        'SanctionsBlockedError',
        new SanctionsBlockedError('addr', undefined, 'evt-1', 'ref-1'),
      ],
      [
        'AmountTooSmallError',
        new AmountTooSmallError('send', '0.1', '1', 'USDT'),
      ],
      ['SelfSendError', new SelfSendError()],
    ])('maps %s to a clarification outcome', async (_label, err: Error) => {
      fakeProposalService.createSendProposal.mockRejectedValue(err);
      fakeAgentPort.run.mockResolvedValue(sendIntent);

      const result = await service.handleMessage({
        userId: 'user-1',
        text: 'send 2 USDT',
      });

      expect(result.outcome.kind).toBe('clarification');
      expect(
        (result.outcome as { kind: 'clarification'; text: string }).text,
      ).toBeTruthy();
    });

    it('still propagates an unexpected error (mapped to 500 by the filter)', async () => {
      fakeProposalService.createSendProposal.mockRejectedValue(
        new Error('unexpected boom'),
      );
      fakeAgentPort.run.mockResolvedValue(sendIntent);

      await expect(
        service.handleMessage({ userId: 'user-1', text: 'send 2 USDT' }),
      ).rejects.toThrow('unexpected boom');
    });
  });

  // ── send_crypto, verified, no default beneficiary → needs_beneficiary ──────

  it('send_crypto, verified, no default beneficiary → needs_beneficiary (crypto_address)', async () => {
    fakeBeneficiaryService.getDefault.mockResolvedValue(null);
    fakeAgentPort.run.mockResolvedValue({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '2',
      toAddress: 'TYyyy',
      network: 'tron',
    });
    const result = await service.handleMessage({
      userId: 'user-1',
      text: 'send',
    });
    expect(result.outcome).toEqual({
      kind: 'needs_beneficiary',
      beneficiaryType: 'crypto_address',
    });
  });

  // ── recipientNickname resolution (Wave B — beneficiary nicknames) ──────────
  // SECURITY: a nickname is a server-resolved LOOKUP KEY. Resolution yields
  // only a beneficiaryId that flows into the EXISTING proposal/engine
  // re-validation (ownership, type, cooling-off, sanctions, PIN).

  describe('recipientNickname resolution (sell + send)', () => {
    // Full-record shapes: the candidates mapping masks bank/crypto details.
    const MUM_BANK = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      label: 'Mum',
      type: 'bank_account' as const,
      bankCode: '058',
      accountNumber: '0123456789',
      cryptoAddress: null,
      isDefault: false,
    };
    const MUM_BANK_2 = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      label: 'Mum',
      type: 'bank_account' as const,
      bankCode: '044',
      accountNumber: '9876543210',
      cryptoAddress: null,
      isDefault: false,
    };
    const MUM_WALLET = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      label: 'Mum',
      type: 'crypto_address' as const,
      bankCode: null,
      accountNumber: null,
      cryptoAddress: 'TQn9Y2khDD3VHKZ2GRdmKXD8bNkRuaBP2p',
      isDefault: false,
    };
    const MUM_WALLET_2 = {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      label: 'Mum',
      type: 'crypto_address' as const,
      bankCode: null,
      accountNumber: null,
      cryptoAddress: 'TXk4mzhDD3VHKZ2GRdmKXD8bNkRuaZZ9q',
      isDefault: false,
    };

    const sellIntentWithNickname = {
      action: 'sell_crypto' as const,
      asset: 'USDT',
      cryptoAmount: '5',
      fiatCurrency: 'NGN',
      recipientNickname: 'mum',
    };
    const sendIntentWithNickname = {
      action: 'send_crypto' as const,
      asset: 'USDT',
      cryptoAmount: '2',
      network: 'TRON',
      recipientNickname: 'mum',
    };

    const sellConfirmation = {
      proposalId: 'p-sell',
      asset: 'USDT',
      cryptoAmount: '5',
      fiatCurrency: 'NGN',
      netFiatAmount: '4800',
      fxRate: '1000',
      processingFeeAmount: '50.00',
      expiresAt: new Date().toISOString(),
    };

    it('sell: ONE nickname match routes to the NAMED beneficiary — beats the silent default', async () => {
      fakeBeneficiaryService.resolveByNickname.mockResolvedValue([MUM_BANK]);
      fakeProposalService.createSellProposal.mockResolvedValue({
        proposalId: 'p-sell',
        quoteId: 'q-2',
        confirmation: sellConfirmation,
      });
      fakeAgentPort.run.mockResolvedValue(sellIntentWithNickname);

      const result = await service.handleMessage({
        userId: 'user-1',
        text: 'sell 5 USDT to mum',
      });

      expect(fakeBeneficiaryService.resolveByNickname).toHaveBeenCalledWith(
        'user-1',
        'bank_account',
        'mum',
      );
      // The nickname must beat the default: getDefault is never consulted.
      expect(fakeBeneficiaryService.getDefault).not.toHaveBeenCalled();
      expect(fakeProposalService.createSellProposal).toHaveBeenCalledWith(
        expect.objectContaining({ beneficiaryId: MUM_BANK.id }),
      );
      expect(result.outcome).toMatchObject({
        kind: 'proposal',
        txType: 'sell',
      });
    });

    it('send: ONE nickname match routes to the NAMED beneficiary — beats the silent default', async () => {
      fakeBeneficiaryService.resolveByNickname.mockResolvedValue([MUM_WALLET]);
      fakeProposalService.createSendProposal.mockResolvedValue({
        proposalId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        confirmation: {
          proposalId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          asset: 'USDT',
          cryptoAmount: '2',
          network: 'TRON',
          networkFeeCrypto: '1.0',
          totalDebit: '3.0',
          toAddressMasked: 'TQn9Y2...BP2p',
          beneficiaryLabel: 'Mum',
          expiresAt: new Date().toISOString(),
        },
      });
      fakeAgentPort.run.mockResolvedValue(sendIntentWithNickname);

      const result = await service.handleMessage({
        userId: 'user-1',
        text: 'send 2 USDT to mum',
      });

      expect(fakeBeneficiaryService.resolveByNickname).toHaveBeenCalledWith(
        'user-1',
        'crypto_address',
        'mum',
      );
      expect(fakeBeneficiaryService.getDefault).not.toHaveBeenCalled();
      expect(fakeProposalService.createSendProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: {
            kind: 'saved_beneficiary',
            beneficiaryId: MUM_WALLET.id,
          },
        }),
      );
      expect(result.outcome).toMatchObject({
        kind: 'proposal',
        txType: 'send',
      });
    });

    it('sell: MULTIPLE matches → choose_beneficiary with masked bank candidates, no proposal', async () => {
      fakeBeneficiaryService.resolveByNickname.mockResolvedValue([
        MUM_BANK,
        MUM_BANK_2,
      ]);
      fakeAgentPort.run.mockResolvedValue(sellIntentWithNickname);

      const result = await service.handleMessage({
        userId: 'user-1',
        text: 'sell 5 USDT to mum',
      });

      expect(result.outcome).toEqual({
        kind: 'choose_beneficiary',
        beneficiaryType: 'bank_account',
        nickname: 'mum',
        candidates: [
          {
            id: MUM_BANK.id,
            label: 'Mum',
            // Bank details are masked: bank display name + last 4 digits only.
            detail: 'Guaranty Trust Bank (GTBank) ••6789',
          },
          {
            id: MUM_BANK_2.id,
            label: 'Mum',
            detail: 'Access Bank ••3210',
          },
        ],
      });
      expect(fakeProposalService.createSellProposal).not.toHaveBeenCalled();
      expect(fakeBeneficiaryService.getDefault).not.toHaveBeenCalled();
      // The full account number must never surface anywhere in the outcome.
      expect(JSON.stringify(result.outcome)).not.toContain('0123456789');
    });

    it('send: MULTIPLE matches → choose_beneficiary with masked address candidates, no proposal', async () => {
      fakeBeneficiaryService.resolveByNickname.mockResolvedValue([
        MUM_WALLET,
        MUM_WALLET_2,
      ]);
      fakeAgentPort.run.mockResolvedValue(sendIntentWithNickname);

      const result = await service.handleMessage({
        userId: 'user-1',
        text: 'send 2 USDT to mum',
      });

      expect(result.outcome).toEqual({
        kind: 'choose_beneficiary',
        beneficiaryType: 'crypto_address',
        nickname: 'mum',
        candidates: [
          {
            id: MUM_WALLET.id,
            label: 'Mum',
            // Head/tail ellipsis — same masking as the proposal confirmation.
            detail: 'TQn9Y2...BP2p',
          },
          {
            id: MUM_WALLET_2.id,
            label: 'Mum',
            detail: 'TXk4mz...ZZ9q',
          },
        ],
      });
      expect(fakeProposalService.createSendProposal).not.toHaveBeenCalled();
      // The full address must never surface in the outcome.
      expect(JSON.stringify(result.outcome)).not.toContain(
        MUM_WALLET.cryptoAddress,
      );
    });

    it('sell: ZERO matches → needs_beneficiary with a targeted note — never the silent default', async () => {
      fakeBeneficiaryService.resolveByNickname.mockResolvedValue([]);
      // Even with a default saved, a missed nickname must NOT silently route
      // to it — the user named someone specific.
      fakeBeneficiaryService.getDefault.mockResolvedValue({ id: 'bene-1' });
      fakeAgentPort.run.mockResolvedValue(sellIntentWithNickname);

      const result = await service.handleMessage({
        userId: 'user-1',
        text: 'sell 5 USDT to mum',
      });

      expect(result.outcome).toMatchObject({
        kind: 'needs_beneficiary',
        beneficiaryType: 'bank_account',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest expect.stringContaining is typed `any`
        note: expect.stringContaining("'mum'"),
      });
      expect(fakeProposalService.createSellProposal).not.toHaveBeenCalled();
      expect(fakeBeneficiaryService.getDefault).not.toHaveBeenCalled();
    });

    it('send: ZERO matches → needs_beneficiary with a targeted note — never the silent default', async () => {
      fakeBeneficiaryService.resolveByNickname.mockResolvedValue([]);
      fakeBeneficiaryService.getDefault.mockResolvedValue({
        id: 'bene-crypto-1',
      });
      fakeAgentPort.run.mockResolvedValue(sendIntentWithNickname);

      const result = await service.handleMessage({
        userId: 'user-1',
        text: 'send 2 USDT to mum',
      });

      expect(result.outcome).toMatchObject({
        kind: 'needs_beneficiary',
        beneficiaryType: 'crypto_address',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest expect.stringContaining is typed `any`
        note: expect.stringContaining("'mum'"),
      });
      expect(fakeProposalService.createSendProposal).not.toHaveBeenCalled();
      expect(fakeBeneficiaryService.getDefault).not.toHaveBeenCalled();
    });

    it('explicit input.beneficiaryId (resolve-loop pick) still wins over the nickname', async () => {
      fakeProposalService.createSellProposal.mockResolvedValue({
        proposalId: 'p-sell',
        quoteId: 'q-2',
        confirmation: sellConfirmation,
      });
      fakeAgentPort.run.mockResolvedValue(sellIntentWithNickname);

      await service.handleMessage({
        userId: 'user-1',
        text: 'sell 5 USDT to mum',
        beneficiaryId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      });

      expect(fakeBeneficiaryService.resolveByNickname).not.toHaveBeenCalled();
      expect(fakeProposalService.createSellProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          beneficiaryId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        }),
      );
    });

    it('absent nickname preserves the default-beneficiary path (no nickname lookup)', async () => {
      fakeBeneficiaryService.getDefault.mockResolvedValue({ id: 'bene-1' });
      fakeProposalService.createSellProposal.mockResolvedValue({
        proposalId: 'p-sell',
        quoteId: 'q-2',
        confirmation: sellConfirmation,
      });
      fakeAgentPort.run.mockResolvedValue({
        action: 'sell_crypto',
        asset: 'USDT',
        cryptoAmount: '5',
        fiatCurrency: 'NGN',
      });

      await service.handleMessage({ userId: 'user-1', text: 'sell 5 USDT' });

      expect(fakeBeneficiaryService.resolveByNickname).not.toHaveBeenCalled();
      expect(fakeBeneficiaryService.getDefault).toHaveBeenCalledWith(
        'user-1',
        'bank_account',
      );
      expect(fakeProposalService.createSellProposal).toHaveBeenCalledWith(
        expect.objectContaining({ beneficiaryId: 'bene-1' }),
      );
    });

    it('persists the choose_beneficiary outcome on the reply (history round-trip)', async () => {
      fakeBeneficiaryService.resolveByNickname.mockResolvedValue([
        MUM_BANK,
        MUM_BANK_2,
      ]);
      fakeAgentPort.run.mockResolvedValue(sellIntentWithNickname);

      await service.handleMessage({
        userId: 'user-1',
        text: 'sell 5 USDT to mum',
      });

      expect(fakeReplyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest expect.objectContaining is typed `any`
          outcome: expect.objectContaining({ kind: 'choose_beneficiary' }),
        }),
      );
    });
  });

  // ── Conversation upsert — no existing conversation → creates new ────────────

  it('no existing conversation → creates a new one', async () => {
    fakeConversationRepo.findByUserId.mockResolvedValue(null);
    fakeConversationRepo.create.mockResolvedValue({
      id: 'new-conv',
      userId: 'user-1',
      contactId: null,
      status: 'active',
      lastMessageAt: null,
      createdAt: new Date(),
    });
    // Message.create needs to reference the new conv id
    fakeMessageRepo.create.mockResolvedValue({
      ...MESSAGE,
      conversationId: 'new-conv',
    });
    fakeReplyRepo.create.mockResolvedValue({
      ...REPLY,
      conversationId: 'new-conv',
    });
    fakeAgentPort.run.mockResolvedValue({
      action: 'none',
      clarification: 'ok',
    });
    await service.handleMessage({ userId: 'user-1', text: 'hi' });
    expect(fakeConversationRepo.create).toHaveBeenCalledWith({
      userId: 'user-1',
    });
  });

  // ── touch is always called ─────────────────────────────────────────────────

  it('always touches the conversation on each message', async () => {
    fakeAgentPort.run.mockResolvedValue({
      action: 'none',
      clarification: 'ok',
    });
    await service.handleMessage({ userId: 'user-1', text: 'hi' });
    expect(fakeConversationRepo.touch).toHaveBeenCalledWith(
      'conv-1',
      expect.any(Date),
    );
  });

  // ── reply persists the rendered outcome (for thread reconstruction) ─────────

  it('persists the rendered outcome on the reply so history can rebuild the thread', async () => {
    fakeAgentPort.run.mockResolvedValue({
      action: 'none',
      clarification: 'Did you mean buy or sell?',
    });
    await service.handleMessage({ userId: 'user-1', text: 'blah' });
    expect(fakeReplyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        messageId: 'msg-1',
        outcome: { kind: 'clarification', text: 'Did you mean buy or sell?' },
      }),
    );
  });

  // ── getHistory ─────────────────────────────────────────────────────────────

  describe('getHistory', () => {
    it('returns an empty history when the user has no conversation yet', async () => {
      fakeConversationRepo.findByUserId.mockResolvedValue(null);
      const result = await service.getHistory({ userId: 'user-1', limit: 30 });
      expect(result).toEqual({
        conversationId: null,
        messages: [],
        nextCursor: null,
        hasMore: false,
      });
      expect(fakeMessageRepo.findWebHistory).not.toHaveBeenCalled();
    });

    it('maps turns to oldest→newest items and reconstructs the outcome', async () => {
      // Repo returns newest-first (DESC).
      fakeMessageRepo.findWebHistory.mockResolvedValue([
        {
          id: 'm2',
          userText: 'second',
          createdAt: new Date('2026-06-29T10:01:00.000Z'),
          reply: { text: 'r2', outcome: { kind: 'needs_kyc' } },
        },
        {
          id: 'm1',
          userText: 'first',
          createdAt: new Date('2026-06-29T10:00:00.000Z'),
          reply: { text: 'r1', outcome: { kind: 'clarification', text: 'hi' } },
        },
      ]);
      const result = await service.getHistory({ userId: 'user-1', limit: 30 });
      expect(fakeMessageRepo.findWebHistory).toHaveBeenCalledWith('conv-1', {
        before: undefined,
        limit: 30,
      });
      expect(result.conversationId).toBe('conv-1');
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(result.messages.map((m) => m.messageId)).toEqual(['m1', 'm2']);
      expect(result.messages[0]).toEqual({
        messageId: 'm1',
        userText: 'first',
        outcome: { kind: 'clarification', text: 'hi' },
        createdAt: '2026-06-29T10:00:00.000Z',
      });
      expect(result.messages[1].outcome).toEqual({ kind: 'needs_kyc' });
    });

    it('sets hasMore and nextCursor when more than `limit` turns exist', async () => {
      // limit=1, repo returns limit+1 rows (DESC). Page keeps the newest; cursor
      // points at the oldest kept row so the next page loads older turns.
      fakeMessageRepo.findWebHistory.mockResolvedValue([
        {
          id: 'm2',
          userText: 'second',
          createdAt: new Date('2026-06-29T10:01:00.000Z'),
          reply: { text: 'r2', outcome: { kind: 'needs_kyc' } },
        },
        {
          id: 'm1',
          userText: 'first',
          createdAt: new Date('2026-06-29T10:00:00.000Z'),
          reply: { text: 'r1', outcome: { kind: 'needs_kyc' } },
        },
      ]);
      const result = await service.getHistory({ userId: 'user-1', limit: 1 });
      expect(result.messages.map((m) => m.messageId)).toEqual(['m2']);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('m2');
    });

    it('threads the before-cursor through to the repository', async () => {
      fakeMessageRepo.findWebHistory.mockResolvedValue([]);
      await service.getHistory({
        userId: 'user-1',
        before: 'cursor-x',
        limit: 5,
      });
      expect(fakeMessageRepo.findWebHistory).toHaveBeenCalledWith('conv-1', {
        before: 'cursor-x',
        limit: 5,
      });
    });

    it('yields a null outcome when the reply or its outcome is missing or invalid', async () => {
      fakeMessageRepo.findWebHistory.mockResolvedValue([
        {
          id: 'm3',
          userText: 'no reply yet',
          createdAt: new Date('2026-06-29T10:02:00.000Z'),
          reply: null,
        },
        {
          id: 'm2',
          userText: 'reply without outcome',
          createdAt: new Date('2026-06-29T10:01:00.000Z'),
          reply: { text: 'r', outcome: null },
        },
        {
          id: 'm1',
          userText: 'corrupt outcome',
          createdAt: new Date('2026-06-29T10:00:00.000Z'),
          reply: { text: 'r', outcome: { kind: 'totally-bogus' } },
        },
      ]);
      const result = await service.getHistory({ userId: 'user-1', limit: 30 });
      expect(result.messages.every((m) => m.outcome === null)).toBe(true);
      expect(result.messages.map((m) => m.userText)).toEqual([
        'corrupt outcome',
        'reply without outcome',
        'no reply yet',
      ]);
    });

    it('round-trips a stored choose_beneficiary outcome (Wave B) intact', async () => {
      // The reply repo persists the outcome JSON verbatim; the history read
      // re-validates it through AgentTurnOutcomeSchema — the new kind must
      // survive the round-trip, not degrade to a null outcome.
      const storedOutcome = {
        kind: 'choose_beneficiary',
        beneficiaryType: 'bank_account',
        nickname: 'mum',
        candidates: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            label: 'Mum',
            detail: 'Guaranty Trust Bank (GTBank) ••6789',
          },
        ],
      };
      fakeMessageRepo.findWebHistory.mockResolvedValue([
        {
          id: 'm1',
          userText: 'sell 5 USDT to mum',
          createdAt: new Date('2026-07-08T10:00:00.000Z'),
          reply: { text: 'Which one did you mean?', outcome: storedOutcome },
        },
      ]);

      const result = await service.getHistory({ userId: 'user-1', limit: 30 });

      expect(result.messages[0].outcome).toEqual(storedOutcome);
    });

    // ── transactions outcome: stale signed download URL is re-issued ───────────

    it('re-issues a fresh signed downloadUrl for a stored transactions outcome', async () => {
      // The signed statement link is time-limited (linkTtlSeconds, default 900s).
      // Persisting it verbatim and re-serving it on history reload yields a 401
      // expired link once the card is older than the TTL. On the history-read path
      // the URL must be regenerated from the stored window + txType so it is always
      // valid when rendered — never the stale stored value.
      const storedTxOutcome = {
        kind: 'transactions',
        window: {
          from: '2026-06-01T00:00:00.000Z',
          to: '2026-06-30T23:59:59.999Z',
          label: 'This month',
        },
        items: [],
        totalCount: 0,
        truncated: false,
        hasMore: false,
        nextCursor: null,
        txType: 'buy',
        downloadUrl:
          'https://api.example.com/transactions/statement/download?token=STALE.sig',
      };
      fakeMessageRepo.findWebHistory.mockResolvedValue([
        {
          id: 'm1',
          userText: 'my buys this month',
          createdAt: new Date('2026-06-29T10:00:00.000Z'),
          reply: { text: 'r', outcome: storedTxOutcome },
        },
      ]);

      const result = await service.getHistory({ userId: 'user-1', limit: 30 });

      // The token is re-signed with the SAME window + txType, scoped to this user.
      expect(fakeStatementTokens.sign).toHaveBeenCalledWith({
        userId: 'user-1',
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-06-30T23:59:59.999Z',
        txType: 'buy',
      });
      const outcome = result.messages[0].outcome as {
        kind: 'transactions';
        downloadUrl: string;
      };
      // The served URL carries the freshly-signed token, not the stale stored one.
      expect(outcome.downloadUrl).toBe(
        'https://api.example.com/transactions/statement/download?token=fresh-token',
      );
      expect(outcome.downloadUrl).not.toContain('STALE.sig');
    });

    it('does not re-sign a download URL for non-transactions outcomes', async () => {
      fakeMessageRepo.findWebHistory.mockResolvedValue([
        {
          id: 'm1',
          userText: 'hi',
          createdAt: new Date('2026-06-29T10:00:00.000Z'),
          reply: { text: 'r', outcome: { kind: 'needs_kyc' } },
        },
      ]);
      await service.getHistory({ userId: 'user-1', limit: 30 });
      expect(fakeStatementTokens.sign).not.toHaveBeenCalled();
    });

    it('preserves all other transactions outcome fields when re-issuing the link', async () => {
      const storedTxOutcome = {
        kind: 'transactions',
        window: {
          from: '2026-06-01T00:00:00.000Z',
          to: '2026-06-30T23:59:59.999Z',
          label: 'This month',
        },
        items: [
          {
            id: 'tx-1',
            type: 'buy',
            status: 'completed',
            direction: 'in',
            createdAt: '2026-06-15T09:00:00.000Z',
          },
        ],
        totalCount: 1,
        truncated: false,
        hasMore: true,
        nextCursor: 'cur-1',
        txType: 'all',
        downloadUrl:
          'https://api.example.com/transactions/statement/download?token=STALE.sig',
      };
      fakeMessageRepo.findWebHistory.mockResolvedValue([
        {
          id: 'm1',
          userText: 'my transactions',
          createdAt: new Date('2026-06-29T10:00:00.000Z'),
          reply: { text: 'r', outcome: storedTxOutcome },
        },
      ]);

      const result = await service.getHistory({ userId: 'user-1', limit: 30 });
      const outcome = result.messages[0].outcome as {
        kind: 'transactions';
        items: unknown[];
        totalCount: number;
        hasMore: boolean;
        nextCursor: string;
        txType: string;
      };
      expect(outcome.items).toHaveLength(1);
      expect(outcome.totalCount).toBe(1);
      expect(outcome.hasMore).toBe(true);
      expect(outcome.nextCursor).toBe('cur-1');
      expect(outcome.txType).toBe('all');
    });
  });

  // ── capability → minimum-tier gate (Task 4.2b) ─────────────────────────────
  // Regression coverage for the bug this fix addresses: the onboarding model
  // grants kycTier='tier_1' on EMAIL verification WITHOUT setting
  // kycStatus='verified' (reserved for full Sumsub KYC). The chat-entry gate
  // must key off capability→kycTier (mirroring KycGateService), never the
  // stale kycStatus==='verified' check.

  describe('capability → minimum-tier gate (Task 4.2b)', () => {
    it('tier_1 user, buy_crypto intent → a buy proposal outcome (NOT needs_kyc)', async () => {
      fakeIdentityRepo.loadUser.mockResolvedValue(TIER_1_USER);
      const buyConf = {
        proposalId: 'prop-t1',
        asset: 'USDT',
        fiatAmount: '5000',
        fiatCurrency: 'NGN',
        cryptoAmount: '5.0',
        fxRate: '1000',
        spreadBps: 50,
        processingFeeBps: 100,
        processingFeeAmount: '50.00',
        totalFiat: '5050.00',
        expiresAt: new Date().toISOString(),
      };
      fakeProposalService.createBuyProposal.mockResolvedValue({
        proposalId: 'prop-t1',
        quoteId: 'q-t1',
        confirmation: buyConf,
      });
      fakeAgentPort.run.mockResolvedValue({
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount: '5000',
        fiatCurrency: 'NGN',
      });

      const result = await service.handleMessage({
        userId: 'user-1',
        text: 'buy 5000 NGN of USDT',
      });

      expect(result.outcome).toMatchObject({
        kind: 'proposal',
        txType: 'buy',
        proposalId: 'prop-t1',
      });
    });

    it('tier_1 user, receive_crypto intent → a receive outcome (NOT needs_kyc)', async () => {
      fakeIdentityRepo.loadUser.mockResolvedValue(TIER_1_USER);
      fakeWalletService.getOrProvisionNetworkWallet.mockResolvedValue({
        id: 'w1',
        userId: 'user-1',
        network: 'tron',
        address: 'TXxxx',
        providerReference: 'ref',
        status: 'active',
        provisionedAt: new Date(),
      });
      fakeAgentPort.run.mockResolvedValue({
        action: 'receive_crypto',
        asset: 'USDT',
        network: 'tron',
      });

      const result = await service.handleMessage({
        userId: 'user-1',
        text: 'receive',
      });

      expect(result.outcome.kind).toBe('receive');
    });

    it('tier_1 user, check_balance intent → a balance outcome (NOT needs_kyc)', async () => {
      fakeIdentityRepo.loadUser.mockResolvedValue(TIER_1_USER);
      fakeBalanceService.getBalances.mockResolvedValue({
        fiatCurrency: 'NGN',
        totalFiatValue: '0.00',
        balances: [],
      });
      fakeAgentPort.run.mockResolvedValue({ action: 'check_balance' });

      const result = await service.handleMessage({
        userId: 'user-1',
        text: "what's my balance",
      });

      expect(result.outcome.kind).toBe('balance');
      expect(fakeBalanceService.getBalances).toHaveBeenCalledWith(
        'user-1',
        undefined,
      );
    });

    it('tier_1 user, sell_crypto intent → needs_kyc (sell requires tier_2)', async () => {
      fakeIdentityRepo.loadUser.mockResolvedValue(TIER_1_USER);
      fakeAgentPort.run.mockResolvedValue({
        action: 'sell_crypto',
        asset: 'USDT',
        cryptoAmount: '5',
        fiatCurrency: 'NGN',
      });

      const result = await service.handleMessage({
        userId: 'user-1',
        text: 'sell 5 USDT',
      });

      expect(result.outcome).toEqual({ kind: 'needs_kyc' });
      expect(fakeProposalService.createSellProposal).not.toHaveBeenCalled();
    });

    it('tier_1 user, send_crypto intent → needs_kyc (send requires tier_2)', async () => {
      fakeIdentityRepo.loadUser.mockResolvedValue(TIER_1_USER);
      fakeAgentPort.run.mockResolvedValue({
        action: 'send_crypto',
        asset: 'USDT',
        cryptoAmount: '2',
        toAddress: 'TYyyy',
        network: 'tron',
      });

      const result = await service.handleMessage({
        userId: 'user-1',
        text: 'send 2 USDT',
      });

      expect(result.outcome).toEqual({ kind: 'needs_kyc' });
      expect(fakeProposalService.createSendProposal).not.toHaveBeenCalled();
    });

    it('tier_2 user, send_crypto intent → a send proposal outcome (NOT needs_kyc)', async () => {
      // The default `loadUser` mock (VERIFIED_USER) is tier_2 — explicit here
      // for clarity since this test's whole point is the tier boundary.
      fakeIdentityRepo.loadUser.mockResolvedValue(VERIFIED_USER);
      fakeBeneficiaryService.getDefault.mockResolvedValue({
        id: 'bene-crypto-1',
      });
      const sendConf = {
        proposalId: 'prop-t2-send',
        asset: 'USDT',
        cryptoAmount: '2',
        network: 'tron',
        networkFeeCrypto: '1.0',
        totalDebit: '3.0',
        toAddressMasked: 'TYyyy...Zzzz',
        beneficiaryLabel: 'My wallet',
        expiresAt: new Date().toISOString(),
      };
      fakeProposalService.createSendProposal.mockResolvedValue({
        proposalId: sendConf.proposalId,
        confirmation: sendConf,
      });
      fakeAgentPort.run.mockResolvedValue({
        action: 'send_crypto',
        asset: 'USDT',
        cryptoAmount: '2',
        toAddress: 'TYyyyZzzz',
        network: 'tron',
      });

      const result = await service.handleMessage({
        userId: 'user-1',
        text: 'send 2 USDT',
      });

      expect(result.outcome).toMatchObject({
        kind: 'proposal',
        txType: 'send',
        proposalId: sendConf.proposalId,
      });
    });

    it('tier_1 user, swap intent → needs_kyc (swap requires tier_2)', async () => {
      fakeIdentityRepo.loadUser.mockResolvedValue(TIER_1_USER);
      fakeAgentPort.run.mockResolvedValue({
        action: 'swap',
        fromAsset: 'USDT',
        toAsset: 'TRX',
        amount: '10',
      });

      const result = await service.handleMessage({
        userId: 'user-1',
        text: 'swap 10 USDT to TRX',
      });

      expect(result.outcome).toEqual({ kind: 'needs_kyc' });
      expect(fakeProposalService.createSwapProposal).not.toHaveBeenCalled();
    });

    it('a capability with no configured gating entry fails closed to tier_2 (defense in depth)', async () => {
      // Simulates a gating map missing e.g. crypto.buy's entry — the chat-entry
      // gate must fail closed (needs_kyc) for a tier_1 user rather than
      // silently allow, mirroring KycGateService's FAIL_CLOSED_MIN_TIER.
      fakeConfig.get.mockReturnValueOnce({ capabilityMinTier: {} });
      fakeIdentityRepo.loadUser.mockResolvedValue(TIER_1_USER);
      fakeAgentPort.run.mockResolvedValue({
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount: '5000',
        fiatCurrency: 'NGN',
      });

      const result = await service.handleMessage({
        userId: 'user-1',
        text: 'buy 5000 NGN of USDT',
      });

      expect(result.outcome).toEqual({ kind: 'needs_kyc' });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Task 4 — resolveSendDestination (crypto): a discriminated SendDestination
  // descriptor with the §3.1 NO-MISROUTE guarantee — an explicit-but-unsaved
  // crypto destination (a pasted address, or a nickname that matched nothing, or
  // a bare "send N") returns needs_beneficiary(allowRawSend) and NEVER falls
  // through to the user's default beneficiary. parseAddressFromText is the
  // deterministic edge parser (NOT the model) that only pre-fills the
  // user-confirmed card.
  // ───────────────────────────────────────────────────────────────────────────
  describe('resolveSendDestination (crypto)', () => {
    it('returns a raw_address descriptor when the request carries sendDestination', async () => {
      const r = await service.resolveSendDestination(
        'user-1',
        {
          sendDestination: {
            address: 'TValidAddr0000000001',
            network: 'TRON',
            saveAsBeneficiary: true,
            label: 'Mum',
          },
        },
        undefined,
        'send 50 USDT to TValidAddr0000000001',
      );
      expect(r).toEqual({
        resolved: true,
        destination: {
          kind: 'raw_address',
          address: 'TValidAddr0000000001',
          network: 'TRON',
          save: { label: 'Mum' },
        },
      });
    });

    it('a raw-address paste with NO saved match returns needs_beneficiary(allowRawSend, prefillAddress) — NEVER the default', async () => {
      fakeBeneficiaryService.getDefault.mockResolvedValue({
        id: 'default-ben',
      }); // user HAS a default
      fakeAssetRegistry.inferNetworkForAddress.mockReturnValue('TRON');
      const r = await service.resolveSendDestination(
        'user-1',
        {},
        undefined,
        'send 50 USDT to TPastedAddr0000001',
      );
      expect(r).toMatchObject({
        resolved: false,
        outcome: {
          kind: 'needs_beneficiary',
          beneficiaryType: 'crypto_address',
          allowRawSend: true,
          prefillAddress: 'TPastedAddr0000001',
        },
      });
      // §3.1: the default beneficiary must NEVER be consulted for a crypto send.
      expect(fakeBeneficiaryService.getDefault).not.toHaveBeenCalled();
    });

    it('an explicit beneficiaryId still resolves to a saved_beneficiary descriptor', async () => {
      const r = await service.resolveSendDestination(
        'user-1',
        { beneficiaryId: 'ben-1' },
        undefined,
        'send 50',
      );
      expect(r).toEqual({
        resolved: true,
        destination: { kind: 'saved_beneficiary', beneficiaryId: 'ben-1' },
      });
    });

    it('a bare "send 50 USDT" (no address, no nickname, no id) offers the card, not the silent default', async () => {
      const r = await service.resolveSendDestination(
        'user-1',
        {},
        undefined,
        'send 50 USDT',
      );
      expect(r).toMatchObject({
        resolved: false,
        outcome: { kind: 'needs_beneficiary', allowRawSend: true },
      });
      if (r.resolved) throw new Error('expected an unresolved outcome');
      expect(r.outcome).not.toHaveProperty('prefillAddress');
      expect(fakeBeneficiaryService.getDefault).not.toHaveBeenCalled();
    });

    it('a matching nickname resolves to a saved_beneficiary (unchanged)', async () => {
      fakeBeneficiaryService.resolveByNickname.mockResolvedValue([
        { id: 'ben-mum' },
      ]);
      const r = await service.resolveSendDestination(
        'user-1',
        {},
        'mum',
        'send 50 USDT to mum',
      );
      expect(r).toEqual({
        resolved: true,
        destination: { kind: 'saved_beneficiary', beneficiaryId: 'ben-mum' },
      });
      expect(fakeBeneficiaryService.getDefault).not.toHaveBeenCalled();
    });

    it('ZERO nickname matches returns needs_beneficiary(allowRawSend) — never the default (§3.1 NO-MISROUTE)', async () => {
      fakeBeneficiaryService.resolveByNickname.mockResolvedValue([]);
      // Even with a default saved, a missed nickname must NOT silently route
      // to it — the user named someone specific.
      fakeBeneficiaryService.getDefault.mockResolvedValue({
        id: 'default-ben',
      });
      const r = await service.resolveSendDestination(
        'user-1',
        {},
        'mum',
        'send 50 USDT to mum',
      );
      expect(r).toMatchObject({
        resolved: false,
        outcome: {
          kind: 'needs_beneficiary',
          beneficiaryType: 'crypto_address',
          allowRawSend: true,
        },
      });
      expect(fakeBeneficiaryService.getDefault).not.toHaveBeenCalled();
    });

    it('TWO nickname matches returns choose_beneficiary with both masked candidates — never the default', async () => {
      const MUM_WALLET = {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        label: 'Mum',
        type: 'crypto_address' as const,
        bankCode: null,
        accountNumber: null,
        cryptoAddress: 'TQn9Y2khDD3VHKZ2GRdmKXD8bNkRuaBP2p',
        isDefault: false,
      };
      const MUM_WALLET_2 = {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        label: 'Mum',
        type: 'crypto_address' as const,
        bankCode: null,
        accountNumber: null,
        cryptoAddress: 'TXk4mzhDD3VHKZ2GRdmKXD8bNkRuaZZ9q',
        isDefault: false,
      };
      fakeBeneficiaryService.resolveByNickname.mockResolvedValue([
        MUM_WALLET,
        MUM_WALLET_2,
      ]);
      const r = await service.resolveSendDestination(
        'user-1',
        {},
        'mum',
        'send 50 USDT to mum',
      );
      expect(r).toEqual({
        resolved: false,
        outcome: {
          kind: 'choose_beneficiary',
          beneficiaryType: 'crypto_address',
          nickname: 'mum',
          candidates: [
            { id: MUM_WALLET.id, label: 'Mum', detail: 'TQn9Y2...BP2p' },
            { id: MUM_WALLET_2.id, label: 'Mum', detail: 'TXk4mz...ZZ9q' },
          ],
        },
        summaryText:
          "You have 2 saved recipients called 'mum'. Which one did you mean?",
      });
      expect(fakeBeneficiaryService.getDefault).not.toHaveBeenCalled();
    });
  });

  describe('parseAddressFromText', () => {
    it('extracts a TRON address token and its network', () => {
      fakeAssetRegistry.inferNetworkForAddress.mockReturnValue('TRON');
      expect(
        service.parseAddressFromText(
          'send 50 USDT to TValidAddr0000000001 now',
        ),
      ).toEqual({ address: 'TValidAddr0000000001', network: 'TRON' });
    });

    it('returns null when no address-shaped token is present', () => {
      expect(service.parseAddressFromText('send 50 USDT to mum')).toBeNull();
    });
  });
});
