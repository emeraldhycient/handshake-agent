/**
 * Unit tests for ConversationService (task 2.3).
 *
 * All external dependencies are mocked — no DB, no HTTP, no LLM.
 *
 * Covers:
 *   - duplicate wamid → no-op (dedup)
 *   - linked user + buy_crypto → proposal + confirmation text sent
 *   - contact (unlinked) + buy_crypto → KYC message, no proposal
 *   - user requiresReverification + buy_crypto → re-verify message, no proposal
 *   - none intent → clarification text
 *   - unsupported action (swap) → "not supported yet" reply
 *   - ProposalService throws → message status marked failed + safe fallback sent
 */

import { Logger } from '@nestjs/common';
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
import { ConversationService, PROPOSAL_SERVICE } from './conversation.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_CONV_ID = 'conv-id-1';
const FIXED_MSG_ID = 'msg-id-1';
const FIXED_REPLY_ID = 'reply-id-1';
const FIXED_WAMID = 'wamid.abc123';
const FIXED_FROM = '2348001234567';

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

  // ── Happy path: linked user + buy_crypto ──────────────────────────────────

  it('linked user + buy_crypto → calls proposalService, sends confirmation text, marks message processed', async () => {
    const proposalOut = stubBuyProposalOutput();
    const { svc, sender, msgRepo, replyRepo, proposalService } = buildService({
      proposalService: makeProposalService(proposalOut),
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

  it('persists the reply row before dispatching to sender', async () => {
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

    const { svc } = buildService({ replyRepo, sender });
    await svc.handleInbound(baseMsg());

    expect(callOrder.indexOf('replyRepo.create')).toBeLessThan(
      callOrder.indexOf('sender.sendText'),
    );
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
  });
});
