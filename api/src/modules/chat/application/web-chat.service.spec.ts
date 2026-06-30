/**
 * Unit tests for WebChatService — all external dependencies are fakes.
 *
 * TDD: this file was written BEFORE the service implementation.
 * Run with: pnpm --filter @handshake-agent/api test -- --testPathPattern=web-chat
 */

import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import {
  WebChatService,
  WEB_CHAT_PROPOSAL_SERVICE,
  WEB_CHAT_WALLET_SERVICE,
  WEB_CHAT_BENEFICIARY_SERVICE,
  WEB_CHAT_HISTORY_SERVICE,
  WEB_CHAT_BALANCE_SERVICE,
} from './web-chat.service';
import { AGENT_PORT } from '../../agent/application/ports/agent.port';
import { IDENTITY_REPOSITORY } from '../../identity/application/ports/identity.repository.port';
import { CONVERSATION_REPOSITORY } from '../../conversations/application/ports/conversation.repository.port';
import { MESSAGE_REPOSITORY } from '../../conversations/application/ports/message.repository.port';
import { INTENT_REPOSITORY } from '../../conversations/application/ports/intent.repository.port';
import { REPLY_REPOSITORY } from '../../conversations/application/ports/reply.repository.port';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { StatementTokenService } from '../../transactions/application/statement-token.service';
import {
  SwapSameAssetError,
  SwapUnavailableError,
} from '../../transactions/domain/execution-errors';

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
const fakeBeneficiaryService = { getDefault: jest.fn() };
const fakeHistoryService = { query: jest.fn() };
const fakeBalanceService = { getBalances: jest.fn() };
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
  isCapabilityEnabled: jest.fn().mockReturnValue(true),
};

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const VERIFIED_USER = {
  id: 'user-1',
  kycStatus: 'verified',
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
        { provide: IDENTITY_REPOSITORY, useValue: fakeIdentityRepo },
        { provide: CONVERSATION_REPOSITORY, useValue: fakeConversationRepo },
        { provide: MESSAGE_REPOSITORY, useValue: fakeMessageRepo },
        { provide: INTENT_REPOSITORY, useValue: fakeIntentRepo },
        { provide: REPLY_REPOSITORY, useValue: fakeReplyRepo },
        { provide: AssetRegistry, useValue: fakeAssetRegistry },
        { provide: StatementTokenService, useValue: fakeStatementTokens },
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

  it('wraps an agent/LLM failure in AgentUnavailableError (never an opaque 500)', async () => {
    // The agent call is the one external, flaky dependency in this flow. When it
    // throws (provider down, timeout, invalid Intent), the service must surface a
    // typed AgentUnavailableError so the global filter maps it to a 5xx with a
    // clean message — not let the raw provider error bubble to an opaque 500.
    fakeAgentPort.run.mockRejectedValue(new Error('anthropic 529 overloaded'));

    await expect(
      service.handleMessage({ userId: 'user-1', text: 'buy 5 USDT' }),
    ).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE' });
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
    });
    expect(fakeProposalService.createBuyProposal).not.toHaveBeenCalled();
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
});
