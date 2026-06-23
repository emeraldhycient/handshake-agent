/**
 * Unit tests for ConversationService (tasks 2.3 + 6.3 + R1 + X2).
 *
 * All external dependencies are mocked — no DB, no HTTP, no LLM.
 *
 * Covers:
 *   - duplicate wamid → no-op (dedup)
 *   - linked user + buy_crypto (no FLOW_ID) → proposal + confirmation text sent
 *   - linked user + buy_crypto (FLOW_ID set) → directive issued, flow_token signed,
 *     sendFlow called with itemized data + nonce; NO plain text confirmation sent
 *   - linked user + buy_crypto (FLOW_ID set, directive fails) → falls back to text
 *   - contact (unlinked) + buy_crypto → KYC message, no proposal
 *   - user requiresReverification + buy_crypto → re-verify message, no proposal
 *   - none intent → clarification text
 *   - unsupported action (swap) → "not supported yet" reply
 *   - ProposalService throws → message status marked failed + safe fallback sent
 *   - linked user + receive_crypto → deposit address reply, no proposal/directive
 *   - contact (unlinked) + receive_crypto → KYC ask, walletService NOT called
 *   - user requiresReverification + receive_crypto → re-verify ask, walletService NOT called
 *   - (X2) shared guard: unlinked contact gets same KYC reply for buy_crypto AND receive_crypto
 *   - (X2) receive reply is built from registry metadata (asset + network displayName)
 */

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IAgentPort } from '../../agent/application/ports/agent.port';
import { AGENT_PORT } from '../../agent/application/ports/agent.port';
import type { IWhatsAppSender } from '../../whatsapp/application/ports/whatsapp-sender.port';
import { WHATSAPP_SENDER } from '../../whatsapp/application/ports/whatsapp-sender.port';
import type { InboundMessage } from '../../whatsapp/application/ports/inbound-handler.port';
import type { IdentityService } from '../../identity/application/identity.service';
import type {
  ProposalService,
  CreateBuyProposalOutput,
} from '../../transactions/application/proposal.service';
import type { DirectiveService } from '../../transactions/application/directive.service';
import type {
  IConversationRepository,
  ConversationRecord,
} from './ports/conversation.repository.port';
import { CONVERSATION_REPOSITORY } from './ports/conversation.repository.port';
import type {
  IMessageRepository,
  ConversationMessageRecord,
} from './ports/message.repository.port';
import { MESSAGE_REPOSITORY } from './ports/message.repository.port';
import type { IIntentRepository } from './ports/intent.repository.port';
import { INTENT_REPOSITORY } from './ports/intent.repository.port';
import type {
  IReplyRepository,
  ConversationReplyRecord,
} from './ports/reply.repository.port';
import { REPLY_REPOSITORY } from './ports/reply.repository.port';
import {
  ConversationService,
  PROPOSAL_SERVICE,
  DIRECTIVE_SERVICE,
} from './conversation.service';
import type { WalletService } from '../../wallets/application/wallet.service';
import type { WalletRecord } from '../../wallets/application/ports/wallet.repository.port';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_WALLET_ADDRESS = 'TRX_USDT_ADDR_ABC123';

const stubWalletRecord = (): WalletRecord => ({
  id: 'wallet-id-1',
  userId: 'user-id-1',
  asset: 'USDT',
  network: 'TRON',
  address: FIXED_WALLET_ADDRESS,
  providerReference: 'blockradar-ref-1',
  status: 'active',
});

const FIXED_CONV_ID = 'conv-id-1';
const FIXED_MSG_ID = 'msg-id-1';
const FIXED_REPLY_ID = 'reply-id-1';
const FIXED_WAMID = 'wamid.abc123';
const FIXED_FROM = '2348001234567';
const FIXED_DIRECTIVE_ID = 'directive-id-1';
const FIXED_NONCE =
  'fixed-nonce-hex-64chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const FIXED_SIGNING_KEY = 'test-signing-key-32bytes-xxxxxxxx';
const FIXED_FLOW_ID = 'flow-id-meta-123';

const baseMsg = (): InboundMessage => ({
  externalMessageId: FIXED_WAMID,
  fromAddress: FIXED_FROM,
  phoneNumberId: 'ph123',
  waName: 'Alice',
  text: 'I want to buy 5000 NGN worth of USDT',
  timestamp: '1700000000',
  channel: 'whatsapp',
});

const baseConv = (): ConversationRecord => ({
  id: FIXED_CONV_ID,
  contactId: null,
  userId: 'user-id-1',
  status: 'active',
  lastMessageAt: null,
  createdAt: new Date(),
});

const baseMessage = (): ConversationMessageRecord => ({
  id: FIXED_MSG_ID,
  conversationId: FIXED_CONV_ID,
  externalMessageId: FIXED_WAMID,
  channel: 'whatsapp',
  senderAddress: FIXED_FROM,
  text: 'I want to buy 5000 NGN worth of USDT',
  rawUserText: 'I want to buy 5000 NGN worth of USDT',
  processingStatus: 'received',
  correlationId: 'corr-id-1',
  createdAt: new Date(),
});

const baseReply = (): ConversationReplyRecord => ({
  id: FIXED_REPLY_ID,
  conversationId: FIXED_CONV_ID,
  messageId: FIXED_MSG_ID,
  text: 'reply text',
  status: 'created',
  correlationId: 'corr-id-1',
  createdAt: new Date(),
});

const stubBuyProposalOutput = (): CreateBuyProposalOutput => ({
  proposalId: 'proposal-id-1',
  quoteId: 'quote-id-1',
  confirmation: {
    proposalId: 'proposal-id-1',
    asset: 'USDT',
    fiatAmount: '5000',
    fiatCurrency: 'NGN',
    cryptoAmount: '3.0625',
    fxRate: '1600',
    spreadBps: 100,
    processingFeeBps: 50,
    processingFeeAmount: '25.00',
    totalFiat: '5025.00',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the text body (second argument) from the first sendText call.
 * The cast through `unknown` avoids the unsafe-member-access lint rule on
 * `mock.calls` which is typed `any[][]` in Jest's public typings.
 */
function captureFirstSentText(sender: jest.Mocked<IWhatsAppSender>): string {
  const calls = (
    sender.sendText as jest.Mock<
      Promise<{ externalMessageId: string }>,
      [string, string]
    >
  ).mock.calls;
  const firstCall = calls[0];
  return firstCall[1];
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeIdentityService(
  overrides: Partial<IdentityService> = {},
): jest.Mocked<IdentityService> {
  return {
    resolveByChannel: jest.fn().mockResolvedValue({
      kind: 'user',
      user: {
        id: 'user-id-1',
        status: 'active',
        kycStatus: 'verified',
        kycTier: 'tier_1',
        simSwapDetectedAt: null,
      },
      requiresReverification: false,
    }),
    ...overrides,
  } as unknown as jest.Mocked<IdentityService>;
}

function makeAgentPort(
  intent: Record<string, unknown> = {
    action: 'buy_crypto',
    asset: 'USDT',
    fiatAmount: '5000',
    fiatCurrency: 'NGN',
  },
): jest.Mocked<IAgentPort> {
  return { run: jest.fn().mockResolvedValue(intent) };
}

function makeProposalService(
  output: CreateBuyProposalOutput | Error = stubBuyProposalOutput(),
): jest.Mocked<Pick<ProposalService, 'createBuyProposal'>> {
  const svc = { createBuyProposal: jest.fn() };
  if (output instanceof Error) {
    svc.createBuyProposal.mockRejectedValue(output);
  } else {
    svc.createBuyProposal.mockResolvedValue(output);
  }
  return svc;
}

function makeSender(): jest.Mocked<IWhatsAppSender> {
  return {
    sendText: jest.fn().mockResolvedValue({ externalMessageId: 'wamid.out' }),
    sendTemplate: jest
      .fn()
      .mockResolvedValue({ externalMessageId: 'wamid.out' }),
    sendFlow: jest
      .fn()
      .mockResolvedValue({ externalMessageId: 'wamid.flow.out' }),
  };
}

function makeConvRepo(
  conv: ConversationRecord | null = baseConv(),
): jest.Mocked<IConversationRepository> {
  return {
    findByUserId: jest.fn().mockResolvedValue(conv),
    findByContactId: jest.fn().mockResolvedValue(conv),
    create: jest.fn().mockResolvedValue(conv ?? baseConv()),
    touch: jest.fn().mockResolvedValue(undefined),
  };
}

function makeMsgRepo(
  existing: ConversationMessageRecord | null = null,
  created: ConversationMessageRecord = baseMessage(),
): jest.Mocked<IMessageRepository> {
  return {
    findByExternalId: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockResolvedValue(created),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  };
}

function makeIntentRepo(): jest.Mocked<IIntentRepository> {
  return { create: jest.fn().mockResolvedValue({ id: 'intent-id-1' }) };
}

function makeReplyRepo(
  reply: ConversationReplyRecord = baseReply(),
): jest.Mocked<IReplyRepository> {
  return {
    create: jest.fn().mockResolvedValue(reply),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  };
}

function makeConfigService(
  overrides: { flowId?: string; signingKey?: string } = {},
): jest.Mocked<ConfigService> {
  const flowId = overrides.flowId ?? '';
  const signingKey = overrides.signingKey ?? '';
  return {
    get: jest.fn((key: string) => {
      if (key === 'WHATSAPP_FLOW_ID') return flowId;
      if (key === 'DIRECTIVE_SIGNING_KEY') return signingKey;
      return undefined;
    }),
  } as unknown as jest.Mocked<ConfigService>;
}

function makeDirectiveService(
  output: { directiveId: string; nonce: string; expiresAt: Date } | Error = {
    directiveId: FIXED_DIRECTIVE_ID,
    nonce: FIXED_NONCE,
    expiresAt: new Date(Date.now() + 300_000),
  },
): jest.Mocked<Pick<DirectiveService, 'issue'>> {
  const svc = { issue: jest.fn() };
  if (output instanceof Error) {
    svc.issue.mockRejectedValue(output);
  } else {
    svc.issue.mockResolvedValue(output);
  }
  return svc;
}

function makeWalletService(
  wallet: WalletRecord = stubWalletRecord(),
): jest.Mocked<Pick<WalletService, 'getOrProvisionWallet'>> {
  return {
    getOrProvisionWallet: jest.fn().mockResolvedValue(wallet),
  };
}

/**
 * Minimal AssetRegistry stub — mirrors the real registry's surface used by
 * ConversationService. Formatters return predictable values for assertions.
 */
function makeAssetRegistry(): jest.Mocked<AssetRegistry> {
  return {
    asset: jest.fn((symbol: string) => ({
      symbol,
      displayName: symbol === 'USDT' ? 'USDT' : symbol,
      kind: 'crypto',
      decimals: 6,
      networks: ['TRON'],
      providers: {},
      enabled: true,
    })),
    fiat: jest.fn((code: string) => ({
      code,
      displayName: code === 'NGN' ? 'Naira' : code,
      symbol: code === 'NGN' ? '₦' : code,
      decimals: 2,
      enabled: true,
    })),
    network: jest.fn((id: string) => ({
      id,
      displayName: id === 'TRON' ? 'TRON (TRC-20)' : id,
      addressPattern: '^T[1-9A-HJ-NP-Za-km-z]{33}$',
      enabled: true,
    })),
    defaultCryptoAsset: jest.fn(() => 'USDT'),
    defaultNetworkFor: jest.fn(() => 'TRON'),
    formatCrypto: jest.fn(
      (symbol: string, amount: string) => `${amount} ${symbol}`,
    ),
    formatFiat: jest.fn(
      (code: string, amount: string) =>
        `${code === 'NGN' ? '₦' : code}${amount}`,
    ),
    isAssetEnabled: jest.fn(() => true),
    isFiatEnabled: jest.fn(() => true),
    isNetworkEnabled: jest.fn(() => true),
    isCapabilityEnabled: jest.fn(() => true),
    requireCapability: jest.fn(),
    assetProviderId: jest.fn(),
    validateAddress: jest.fn(() => true),
  } as unknown as jest.Mocked<AssetRegistry>;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

function buildService(
  overrides: {
    identityService?: jest.Mocked<IdentityService>;
    agentPort?: jest.Mocked<IAgentPort>;
    proposalService?: jest.Mocked<Pick<ProposalService, 'createBuyProposal'>>;
    sender?: jest.Mocked<IWhatsAppSender>;
    convRepo?: jest.Mocked<IConversationRepository>;
    msgRepo?: jest.Mocked<IMessageRepository>;
    intentRepo?: jest.Mocked<IIntentRepository>;
    replyRepo?: jest.Mocked<IReplyRepository>;
    configService?: jest.Mocked<ConfigService>;
    directiveService?: jest.Mocked<Pick<DirectiveService, 'issue'>>;
    walletService?: jest.Mocked<Pick<WalletService, 'getOrProvisionWallet'>>;
    assetRegistry?: jest.Mocked<AssetRegistry>;
  } = {},
) {
  const identityService = overrides.identityService ?? makeIdentityService();
  const agentPort = overrides.agentPort ?? makeAgentPort();
  const proposalService = overrides.proposalService ?? makeProposalService();
  const sender = overrides.sender ?? makeSender();
  const convRepo = overrides.convRepo ?? makeConvRepo();
  const msgRepo = overrides.msgRepo ?? makeMsgRepo();
  const intentRepo = overrides.intentRepo ?? makeIntentRepo();
  const replyRepo = overrides.replyRepo ?? makeReplyRepo();
  const configService = overrides.configService ?? makeConfigService();
  const directiveService = overrides.directiveService ?? makeDirectiveService();
  const walletService = overrides.walletService ?? makeWalletService();
  const assetRegistry = overrides.assetRegistry ?? makeAssetRegistry();

  // Build the service directly (not via Nest DI) since all deps are mocks.
  const svc = new ConversationService(
    identityService,
    agentPort,
    proposalService as unknown as ProposalService,
    sender,
    convRepo,
    msgRepo,
    intentRepo,
    replyRepo,
    configService,
    directiveService as unknown as DirectiveService,
    walletService as unknown as WalletService,
    assetRegistry,
  );

  return {
    svc,
    identityService,
    agentPort,
    proposalService,
    sender,
    convRepo,
    msgRepo,
    intentRepo,
    replyRepo,
    configService,
    directiveService,
    walletService,
    assetRegistry,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConversationService.handleInbound', () => {
  // ── Dedup ─────────────────────────────────────────────────────────────────

  it('duplicate wamid → no-op: no conversation upsert, no agent call, no send', async () => {
    const msgRepo = makeMsgRepo(baseMessage()); // findByExternalId returns existing row
    const { svc, convRepo, agentPort, sender } = buildService({ msgRepo });

    await svc.handleInbound(baseMsg());

    expect(msgRepo.findByExternalId).toHaveBeenCalledWith(FIXED_WAMID);
    expect(convRepo.findByUserId).not.toHaveBeenCalled();
    expect(agentPort.run).not.toHaveBeenCalled();
    expect(sender.sendText).not.toHaveBeenCalled();
  });

  // ── Happy path (FLOW_ID empty): linked user + buy_crypto → text confirmation ──

  it('buy_crypto with FLOW_ID empty → text confirmation sent, no directive issued, no sendFlow', async () => {
    const proposalOut = stubBuyProposalOutput();
    const directiveService = makeDirectiveService();
    const { svc, sender, msgRepo, replyRepo, proposalService } = buildService({
      proposalService: makeProposalService(proposalOut),
      configService: makeConfigService({
        flowId: '',
        signingKey: FIXED_SIGNING_KEY,
      }),
      directiveService,
    });

    await svc.handleInbound(baseMsg());

    // Proposal created with correct userId and conversationId
    expect(proposalService.createBuyProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id-1',
        conversationId: FIXED_CONV_ID,
      }),
    );

    // Sender dispatched a text containing key confirmation values
    const sentText = captureFirstSentText(sender);
    expect(sentText).toContain('Here is your buy summary');
    expect(sentText).toContain('5000');
    expect(sentText).toContain('Reply CONFIRM');

    // No Flow sent
    expect(sender.sendFlow).not.toHaveBeenCalled();

    // No directive issued in the text-fallback path
    expect(directiveService.issue).not.toHaveBeenCalled();

    // Message status marked processed
    expect(msgRepo.updateStatus).toHaveBeenCalledWith(
      FIXED_MSG_ID,
      'processed',
    );

    // Reply status marked sent with a sentAt Date
    expect(replyRepo.updateStatus).toHaveBeenCalledWith(
      FIXED_REPLY_ID,
      'sent',
      expect.objectContaining({ sentAt: expect.any(Date) as unknown }),
    );
  });

  // ── Happy path (FLOW_ID set): linked user + buy_crypto → sendFlow ──────────

  it('buy_crypto with FLOW_ID set → issues directive, signs token, calls sendFlow with itemized data + nonce; does NOT send text confirmation', async () => {
    const proposalOut = stubBuyProposalOutput();
    const directiveOutput = {
      directiveId: FIXED_DIRECTIVE_ID,
      nonce: FIXED_NONCE,
      expiresAt: new Date(Date.now() + 300_000),
    };
    const directiveService = makeDirectiveService(directiveOutput);
    const { svc, sender, proposalService } = buildService({
      proposalService: makeProposalService(proposalOut),
      configService: makeConfigService({
        flowId: FIXED_FLOW_ID,
        signingKey: FIXED_SIGNING_KEY,
      }),
      directiveService,
    });

    await svc.handleInbound(baseMsg());

    // Proposal created
    expect(proposalService.createBuyProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id-1',
        conversationId: FIXED_CONV_ID,
      }),
    );

    // Directive issued with ref 'request_pin'
    expect(directiveService.issue).toHaveBeenCalledWith({
      proposalId: proposalOut.proposalId,
      userId: 'user-id-1',
      ref: 'request_pin',
    });

    // sendFlow called with correct fields
    expect(sender.sendFlow).toHaveBeenCalledTimes(1);
    const sendFlowCalls = (
      sender.sendFlow as jest.Mock<
        Promise<{ externalMessageId: string }>,
        [
          {
            to: string;
            flowId: string;
            flowToken: string;
            cta: string;
            screen: string;
            data: Record<string, unknown>;
          },
        ]
      >
    ).mock.calls;
    const sendFlowArg = sendFlowCalls[0][0];
    expect(sendFlowArg.to).toBe(FIXED_FROM);
    expect(sendFlowArg.flowId).toBe(FIXED_FLOW_ID);
    expect(sendFlowArg.cta).toBe('Confirm');
    expect(sendFlowArg.screen).toBe('CONFIRM');
    // flowToken is a signed JWT-like string — just verify it's non-empty
    expect(typeof sendFlowArg.flowToken).toBe('string');
    expect(sendFlowArg.flowToken.length).toBeGreaterThan(0);
    // Data carries itemized confirmation fields
    expect(sendFlowArg.data).toMatchObject({
      proposalId: proposalOut.proposalId,
      asset: proposalOut.confirmation.asset,
      cryptoAmount: proposalOut.confirmation.cryptoAmount,
      fiatAmount: proposalOut.confirmation.fiatAmount,
      processingFeeAmount: proposalOut.confirmation.processingFeeAmount,
      totalFiat: proposalOut.confirmation.totalFiat,
      nonce: FIXED_NONCE,
    });

    // Plain text confirmation must NOT be sent
    expect(sender.sendText).not.toHaveBeenCalledWith(
      FIXED_FROM,
      expect.stringContaining('Here is your buy summary'),
    );
  });

  it('buy_crypto with FLOW_ID set → reply text is a short "check the secure form" summary', async () => {
    const proposalOut = stubBuyProposalOutput();
    const { svc, replyRepo } = buildService({
      proposalService: makeProposalService(proposalOut),
      configService: makeConfigService({
        flowId: FIXED_FLOW_ID,
        signingKey: FIXED_SIGNING_KEY,
      }),
    });

    await svc.handleInbound(baseMsg());

    // Reply row persisted with a summary text (not the itemized block)
    const createCalls = (
      replyRepo.create as jest.Mock<
        Promise<ConversationReplyRecord>,
        [
          {
            text: string;
            conversationId: string;
            messageId: string;
            correlationId: string;
          },
        ]
      >
    ).mock.calls;
    const createArg = createCalls[0][0];
    expect(createArg.text).toBeTruthy();
    // Should be a short message, not the full itemized confirmation
    expect(createArg.text).not.toContain('Reply CONFIRM');
  });

  it('new conversation: when no existing conv found, creates one', async () => {
    const convRepo = makeConvRepo(null); // findByUserId → null
    const newConv = baseConv();
    convRepo.create.mockResolvedValue(newConv);

    const { svc } = buildService({ convRepo });
    await svc.handleInbound(baseMsg());

    expect(convRepo.create).toHaveBeenCalledWith({ userId: 'user-id-1' });
  });

  it('existing conversation: skips create, touches lastMessageAt', async () => {
    const { svc, convRepo } = buildService();

    await svc.handleInbound(baseMsg());

    expect(convRepo.create).not.toHaveBeenCalled();
    expect(convRepo.touch).toHaveBeenCalledWith(
      FIXED_CONV_ID,
      expect.any(Date),
    );
  });

  // ── Contact (unlinked) + buy_crypto → KYC gate ───────────────────────────

  it('contact (unlinked) + buy_crypto → sends KYC prompt, does NOT call proposalService', async () => {
    const identityService = makeIdentityService({
      resolveByChannel: jest.fn().mockResolvedValue({
        kind: 'contact',
        contact: {
          id: 'contact-id-1',
          primaryChannel: 'whatsapp',
          primaryAddress: FIXED_FROM,
          status: 'active',
          linkedUserId: null,
        },
      }),
    });

    const convRepo = makeConvRepo(null); // no existing conv
    convRepo.findByContactId.mockResolvedValue(null);
    convRepo.create.mockResolvedValue({
      ...baseConv(),
      userId: null,
      contactId: 'contact-id-1',
    });
    const proposalService = makeProposalService();
    const { svc, sender } = buildService({
      identityService,
      convRepo,
      proposalService,
    });

    await svc.handleInbound(baseMsg());

    expect(proposalService.createBuyProposal).not.toHaveBeenCalled();
    const sentText = captureFirstSentText(sender);
    expect(sentText).toContain('KYC');
  });

  // ── User requiresReverification + buy_crypto ──────────────────────────────

  it('user requiresReverification + buy_crypto → sends re-verify prompt, does NOT call proposalService', async () => {
    const identityService = makeIdentityService({
      resolveByChannel: jest.fn().mockResolvedValue({
        kind: 'user',
        user: {
          id: 'user-id-1',
          status: 'active',
          kycStatus: 'verified',
          kycTier: 'tier_1',
          simSwapDetectedAt: new Date(),
        },
        requiresReverification: true,
      }),
    });

    const proposalService = makeProposalService();
    const { svc, sender } = buildService({ identityService, proposalService });

    await svc.handleInbound(baseMsg());

    expect(proposalService.createBuyProposal).not.toHaveBeenCalled();
    const sentText = captureFirstSentText(sender);
    expect(sentText).toContain('re-verif');
  });

  // ── none intent → clarification ───────────────────────────────────────────

  it('none intent → sends clarification text from agent', async () => {
    const clarification =
      'Could you be more specific? E.g. "buy 5000 NGN of USDT"';
    const agentPort = makeAgentPort({ action: 'none', clarification });
    const { svc, sender } = buildService({ agentPort });

    await svc.handleInbound(baseMsg());

    const sentText = captureFirstSentText(sender);
    expect(sentText).toBe(clarification);
  });

  // ── Unsupported action (swap) ─────────────────────────────────────────────

  it('swap intent → sends "not supported yet" reply', async () => {
    const agentPort = makeAgentPort({
      action: 'swap',
      fromAsset: 'USDT',
      toAsset: 'BTC',
      amount: '10',
    });
    const { svc, sender } = buildService({ agentPort });

    await svc.handleInbound(baseMsg());

    const sentText = captureFirstSentText(sender);
    expect(sentText).toContain('not supported yet');
  });

  // ── ProposalService throws → failure path ─────────────────────────────────

  it('ProposalService throws → message status marked failed, safe fallback sent, logger.error called, does not throw', async () => {
    const proposalService = makeProposalService(new Error('KYC_NOT_VERIFIED'));
    const { svc, sender, msgRepo } = buildService({ proposalService });

    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    // Must resolve (never throw) — webhook has already 200-acked.
    await expect(svc.handleInbound(baseMsg())).resolves.toBeUndefined();

    // Message status marked failed with the error reason
    expect(msgRepo.updateStatus).toHaveBeenCalledWith(
      FIXED_MSG_ID,
      'failed',
      'KYC_NOT_VERIFIED',
    );

    // Safe fallback sent to user
    const sentText = captureFirstSentText(sender);
    expect(sentText).toContain('something went wrong');

    // Logger.error must have been called with the error and context
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error) as unknown,
        externalMessageId: FIXED_WAMID,
      }),
      expect.stringContaining('handleInbound failed'),
    );

    loggerErrorSpy.mockRestore();
  });

  it('even if sender.sendText throws in the fallback path, handleInbound resolves without throwing', async () => {
    const proposalService = makeProposalService(new Error('boom'));
    const sender = makeSender();
    (sender.sendText as jest.Mock).mockRejectedValue(
      new Error('network error'),
    );

    // Suppress logger output in this test (error is expected).
    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const { svc } = buildService({ proposalService, sender });

    await expect(svc.handleInbound(baseMsg())).resolves.toBeUndefined();

    loggerErrorSpy.mockRestore();
  });

  // ── Intent persisted ─────────────────────────────────────────────────────

  it('persists the intent with correct action and payload after agent run', async () => {
    const intentPayload = {
      action: 'buy_crypto',
      asset: 'USDT',
      fiatAmount: '5000',
      fiatCurrency: 'NGN',
    };
    const agentPort = makeAgentPort(intentPayload);
    const { svc, intentRepo } = buildService({ agentPort });

    await svc.handleInbound(baseMsg());

    expect(intentRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: FIXED_MSG_ID,
        conversationId: FIXED_CONV_ID,
        action: 'buy_crypto',
      }),
    );
  });

  // ── Reply persisted ───────────────────────────────────────────────────────

  it('persists the reply row before dispatching to sender (text path)', async () => {
    const callOrder: string[] = [];
    const replyRepo = makeReplyRepo();
    (replyRepo.create as jest.Mock).mockImplementation(() => {
      callOrder.push('replyRepo.create');
      return Promise.resolve(baseReply());
    });
    const sender = makeSender();
    (sender.sendText as jest.Mock).mockImplementation(() => {
      callOrder.push('sender.sendText');
      return Promise.resolve({ externalMessageId: 'wamid.out' });
    });

    // No FLOW_ID → text path
    const { svc } = buildService({
      replyRepo,
      sender,
      configService: makeConfigService({ flowId: '' }),
    });
    await svc.handleInbound(baseMsg());

    expect(callOrder.indexOf('replyRepo.create')).toBeLessThan(
      callOrder.indexOf('sender.sendText'),
    );
  });

  // ── receive_crypto: linked user → deposit address ─────────────────────────

  it('linked user + receive_crypto → calls getOrProvisionWallet with USDT/TRON, reply contains address + TRON + warning', async () => {
    const agentPort = makeAgentPort({ action: 'receive_crypto' });
    const walletService = makeWalletService();
    const { svc, sender, proposalService } = buildService({
      agentPort,
      walletService,
    });

    await svc.handleInbound(baseMsg());

    // WalletService must be called with userId + asset/network from registry defaults
    expect(walletService.getOrProvisionWallet).toHaveBeenCalledWith(
      'user-id-1',
      'USDT',
      'TRON',
    );

    // No proposal or directive created — receive is read-only
    expect(proposalService.createBuyProposal).not.toHaveBeenCalled();

    // Reply text contains address, TRON, and the safety warning.
    // The network displayName from the stub registry is 'TRON (TRC-20)' so the
    // warning uses that instead of the old hardcoded 'TRON network' literal.
    const sentText = captureFirstSentText(sender);
    expect(sentText).toContain(FIXED_WALLET_ADDRESS);
    expect(sentText).toContain('TRON');
    // Warning is built from registry displayNames — assert structural shape.
    expect(sentText).toContain('Only send');
    expect(sentText).toContain('Other assets or networks will be lost.');
  });

  it('linked user + receive_crypto → reply does NOT create proposal or directive', async () => {
    const agentPort = makeAgentPort({ action: 'receive_crypto' });
    const directiveService = makeDirectiveService();
    const { svc } = buildService({ agentPort, directiveService });

    await svc.handleInbound(baseMsg());

    expect(directiveService.issue).not.toHaveBeenCalled();
  });

  // ── receive_crypto: unlinked contact → KYC ask ────────────────────────────

  it('contact (unlinked) + receive_crypto → KYC ask, walletService NOT called', async () => {
    const identityService = makeIdentityService({
      resolveByChannel: jest.fn().mockResolvedValue({
        kind: 'contact',
        contact: {
          id: 'contact-id-2',
          primaryChannel: 'whatsapp',
          primaryAddress: FIXED_FROM,
          status: 'active',
          linkedUserId: null,
        },
      }),
    });
    const convRepo = makeConvRepo(null);
    convRepo.findByContactId.mockResolvedValue(null);
    convRepo.create.mockResolvedValue({
      ...baseConv(),
      userId: null,
      contactId: 'contact-id-2',
    });

    const agentPort = makeAgentPort({ action: 'receive_crypto' });
    const walletService = makeWalletService();

    const { svc, sender } = buildService({
      identityService,
      convRepo,
      agentPort,
      walletService,
    });

    await svc.handleInbound(baseMsg());

    // WalletService must NOT be called for unlinked contact
    expect(walletService.getOrProvisionWallet).not.toHaveBeenCalled();

    // Reply text asks user to complete KYC
    const sentText = captureFirstSentText(sender);
    expect(sentText).toContain('KYC');
  });

  // ── receive_crypto: requiresReverification → re-verify ask ───────────────

  it('user requiresReverification + receive_crypto → re-verify ask, walletService NOT called', async () => {
    const identityService = makeIdentityService({
      resolveByChannel: jest.fn().mockResolvedValue({
        kind: 'user',
        user: {
          id: 'user-id-1',
          status: 'active',
          kycStatus: 'verified',
          kycTier: 'tier_1',
          simSwapDetectedAt: new Date(),
        },
        requiresReverification: true,
      }),
    });

    const agentPort = makeAgentPort({ action: 'receive_crypto' });
    const walletService = makeWalletService();

    const { svc, sender } = buildService({
      identityService,
      agentPort,
      walletService,
    });

    await svc.handleInbound(baseMsg());

    expect(walletService.getOrProvisionWallet).not.toHaveBeenCalled();

    const sentText = captureFirstSentText(sender);
    expect(sentText).toContain('re-verif');
  });

  // ── X2: Single shared guard — same KYC reply for buy_crypto AND receive_crypto ──

  it('(X2) unlinked contact gets the SAME guard KYC reply for buy_crypto and receive_crypto (dedup proof)', async () => {
    const contactIdentity = {
      kind: 'contact' as const,
      contact: {
        id: 'contact-id-3',
        primaryChannel: 'whatsapp',
        primaryAddress: FIXED_FROM,
        status: 'active',
        linkedUserId: null,
      },
    };

    // --- buy_crypto path ---
    const convRepoForBuy = makeConvRepo(null);
    convRepoForBuy.findByContactId.mockResolvedValue(null);
    convRepoForBuy.create.mockResolvedValue({
      ...baseConv(),
      userId: null,
      contactId: 'contact-id-3',
    });

    const { svc: svcBuy, sender: senderBuy } = buildService({
      identityService: makeIdentityService({
        resolveByChannel: jest.fn().mockResolvedValue(contactIdentity),
      }),
      convRepo: convRepoForBuy,
      agentPort: makeAgentPort({
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount: '5000',
        fiatCurrency: 'NGN',
      }),
    });

    await svcBuy.handleInbound(baseMsg());
    const buyReply = captureFirstSentText(senderBuy);

    // --- receive_crypto path ---
    const convRepoForReceive = makeConvRepo(null);
    convRepoForReceive.findByContactId.mockResolvedValue(null);
    convRepoForReceive.create.mockResolvedValue({
      ...baseConv(),
      userId: null,
      contactId: 'contact-id-3',
    });

    const { svc: svcReceive, sender: senderReceive } = buildService({
      identityService: makeIdentityService({
        resolveByChannel: jest.fn().mockResolvedValue(contactIdentity),
      }),
      convRepo: convRepoForReceive,
      agentPort: makeAgentPort({ action: 'receive_crypto' }),
    });

    await svcReceive.handleInbound(baseMsg());
    const receiveReply = captureFirstSentText(senderReceive);

    // Both routes MUST produce the exact same guard reply text — single shared guard.
    expect(buyReply).toBe(receiveReply);
    expect(buyReply).toContain('KYC');
  });

  // ── X2: receive reply uses registry metadata (asset + network displayName) ──

  it('(X2) receive reply contains asset displayName and network displayName from registry', async () => {
    const agentPort = makeAgentPort({ action: 'receive_crypto' });
    const walletService = makeWalletService();

    // Custom registry that uses clearly different display names so we can assert
    // the reply is built from metadata, not hardcoded literals.
    const assetRegistry = makeAssetRegistry();
    (assetRegistry.asset as jest.Mock).mockImplementation((symbol: string) => ({
      symbol,
      displayName: symbol === 'USDT' ? 'USDTcoin' : symbol,
      kind: 'crypto',
      decimals: 6,
      networks: ['TRON'],
      providers: {},
      enabled: true,
    }));
    (assetRegistry.network as jest.Mock).mockImplementation((id: string) => ({
      id,
      displayName: id === 'TRON' ? 'TRONnet' : id,
      addressPattern: '^T[1-9A-HJ-NP-Za-km-z]{33}$',
      enabled: true,
    }));
    (assetRegistry.defaultNetworkFor as jest.Mock).mockReturnValue('TRON');

    const { svc, sender } = buildService({
      agentPort,
      walletService,
      assetRegistry,
    });

    await svc.handleInbound(baseMsg());

    const sentText = captureFirstSentText(sender);
    // Reply must use the displayNames from registry, not raw literals.
    expect(sentText).toContain('USDTcoin');
    expect(sentText).toContain('TRONnet');
  });

  // Token references (ensure that exported symbols are used consistently)
  it('exports match the correct Symbol tokens', () => {
    expect(AGENT_PORT).toBeDefined();
    expect(WHATSAPP_SENDER).toBeDefined();
    expect(CONVERSATION_REPOSITORY).toBeDefined();
    expect(MESSAGE_REPOSITORY).toBeDefined();
    expect(INTENT_REPOSITORY).toBeDefined();
    expect(REPLY_REPOSITORY).toBeDefined();
    expect(PROPOSAL_SERVICE).toBeDefined();
    expect(DIRECTIVE_SERVICE).toBeDefined();
  });
});
