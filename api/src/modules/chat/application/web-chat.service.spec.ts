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
} from './web-chat.service';
import { AGENT_PORT } from '../../agent/application/ports/agent.port';
import { IDENTITY_REPOSITORY } from '../../identity/application/ports/identity.repository.port';
import { CONVERSATION_REPOSITORY } from '../../conversations/application/ports/conversation.repository.port';
import { MESSAGE_REPOSITORY } from '../../conversations/application/ports/message.repository.port';
import { INTENT_REPOSITORY } from '../../conversations/application/ports/intent.repository.port';
import { REPLY_REPOSITORY } from '../../conversations/application/ports/reply.repository.port';
import { AssetRegistry } from '../../../core/catalog/asset-registry';

// ---------------------------------------------------------------------------
// Fake providers
// ---------------------------------------------------------------------------

const fakeAgentPort = { run: jest.fn() };
const fakeProposalService = {
  createBuyProposal: jest.fn(),
  createSellProposal: jest.fn(),
  createSendProposal: jest.fn(),
};
const fakeWalletService = { getOrProvisionNetworkWallet: jest.fn() };
const fakeBeneficiaryService = { getDefault: jest.fn() };
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
};
const fakeIntentRepo = { create: jest.fn() };
const fakeReplyRepo = { create: jest.fn(), updateStatus: jest.fn() };
const fakeAssetRegistry = {
  defaultCryptoAsset: jest.fn().mockReturnValue('USDT'),
  defaultNetworkFor: jest.fn().mockReturnValue('tron'),
  asset: jest.fn().mockReturnValue({ displayName: 'USDT' }),
  network: jest.fn().mockReturnValue({ displayName: 'TRON' }),
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
        { provide: IDENTITY_REPOSITORY, useValue: fakeIdentityRepo },
        { provide: CONVERSATION_REPOSITORY, useValue: fakeConversationRepo },
        { provide: MESSAGE_REPOSITORY, useValue: fakeMessageRepo },
        { provide: INTENT_REPOSITORY, useValue: fakeIntentRepo },
        { provide: REPLY_REPOSITORY, useValue: fakeReplyRepo },
        { provide: AssetRegistry, useValue: fakeAssetRegistry },
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

  // ── check_balance / swap / buy_ticket → not_supported ─────────────────────

  it.each(['check_balance', 'swap', 'buy_ticket'])(
    '%s intent → not_supported outcome',
    async (action) => {
      fakeAgentPort.run.mockResolvedValue({ action });
      const result = await service.handleMessage({
        userId: 'user-1',
        text: action,
      });
      expect(result.outcome).toEqual({ kind: 'not_supported', action });
    },
  );

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
});
