/**
 * Integration test for the inbound→agent→proposal→reply conversation flow (task 2.3).
 *
 * Uses a real Postgres via Testcontainers. The agent (LLM) and WhatsApp sender
 * are replaced with lightweight fakes so no external calls are made.
 *
 * Seeds a Tier-1 verified User + ChannelIdentity, then calls handleInbound
 * directly and asserts that rows are persisted across all four conversation tables
 * (conversations, conversation_messages, message_intents, conversation_replies).
 */

import { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { startTestPostgres } from './helpers/pg-testcontainer';

// Infra repositories
import { ConversationPrismaRepository } from '../src/modules/conversations/infrastructure/conversation.prisma.repository';
import { MessagePrismaRepository } from '../src/modules/conversations/infrastructure/message.prisma.repository';
import { IntentPrismaRepository } from '../src/modules/conversations/infrastructure/intent.prisma.repository';
import { ReplyPrismaRepository } from '../src/modules/conversations/infrastructure/reply.prisma.repository';

// Application services / ports
import { ConversationService } from '../src/modules/conversations/application/conversation.service';
import { IdentityService } from '../src/modules/identity/application/identity.service';
import { IdentityPrismaRepository } from '../src/modules/identity/infrastructure/identity.prisma.repository';
import type { InboundMessage } from '../src/modules/whatsapp/application/ports/inbound-handler.port';
import type { IAgentPort } from '../src/modules/agent/application/ports/agent.port';
import type { IWhatsAppSender } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';
import type { ProposalService } from '../src/modules/transactions/application/proposal.service';
import type { BuyProposalConfirmation } from '@handshake-agent/contracts';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/** Fake agent that always returns a buy_crypto intent. */
const fakeAgentPort: IAgentPort = {
  run: jest.fn().mockResolvedValue({
    action: 'buy_crypto',
    asset: 'USDT',
    fiatAmount: '5000',
    fiatCurrency: 'NGN',
  }),
};

/** Fake WhatsApp sender — captures outbound messages. */
const fakeSender: jest.Mocked<IWhatsAppSender> = {
  sendText: jest
    .fn()
    .mockResolvedValue({ externalMessageId: 'wamid.out.test' }),
  sendTemplate: jest
    .fn()
    .mockResolvedValue({ externalMessageId: 'wamid.out.tmpl' }),
};

/** Fake ProposalService — returns a fixed confirmation without hitting the DB. */
const fakeConfirmation: BuyProposalConfirmation = {
  proposalId: 'proposal-test-id',
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
};

const fakeProposalService = {
  createBuyProposal: jest.fn().mockResolvedValue({
    proposalId: 'proposal-test-id',
    quoteId: 'quote-test-id',
    confirmation: fakeConfirmation,
  }),
} as unknown as ProposalService;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ConversationService integration (Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let svc: ConversationService;

  let userId: string;
  let channelAddress: string;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    const p = prisma as unknown as PrismaService;

    const convRepo = new ConversationPrismaRepository(p);
    const msgRepo = new MessagePrismaRepository(p);
    const intentRepo = new IntentPrismaRepository(p);
    const replyRepo = new ReplyPrismaRepository(p);
    const identityRepo = new IdentityPrismaRepository(p);
    const identityService = new IdentityService(identityRepo);

    svc = new ConversationService(
      identityService,
      fakeAgentPort,
      fakeProposalService,
      fakeSender,
      convRepo,
      msgRepo,
      intentRepo,
      replyRepo,
    );

    // Seed a Tier-1 verified User + ChannelIdentity
    channelAddress = '+2348001234001';

    const user = await prisma.user.create({
      data: {
        status: 'active',
        kycStatus: 'verified',
        kycTier: 'tier_1',
      },
    });
    userId = user.id;

    await prisma.channelIdentity.create({
      data: {
        channel: 'whatsapp',
        channelAddress,
        normalizedPhone: channelAddress,
        userId,
      },
    });
  });

  afterAll(async () => {
    await stop?.();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-apply defaults after clearAllMocks
    (fakeAgentPort.run as jest.Mock).mockResolvedValue({
      action: 'buy_crypto',
      asset: 'USDT',
      fiatAmount: '5000',
      fiatCurrency: 'NGN',
    });
    (fakeSender.sendText as jest.Mock).mockResolvedValue({
      externalMessageId: 'wamid.out.test',
    });
    (fakeProposalService.createBuyProposal as jest.Mock).mockResolvedValue({
      proposalId: 'proposal-test-id',
      quoteId: 'quote-test-id',
      confirmation: fakeConfirmation,
    });
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('persists conversation, message, intent, and reply for a buy_crypto flow', async () => {
    const wamid = `wamid.e2e.${Date.now()}`;
    const msg: InboundMessage = {
      externalMessageId: wamid,
      fromAddress: channelAddress,
      phoneNumberId: 'ph-test-id',
      waName: 'Alice',
      text: 'I want to buy 5000 NGN of USDT',
      timestamp: String(Math.floor(Date.now() / 1000)),
      channel: 'whatsapp',
    };

    await svc.handleInbound(msg);

    // ── Conversation row ──────────────────────────────────────────────────────
    const conv = await prisma.conversation.findUnique({ where: { userId } });
    expect(conv).not.toBeNull();
    expect(conv!.userId).toBe(userId);
    expect(conv!.lastMessageAt).not.toBeNull();

    // ── ConversationMessage row ───────────────────────────────────────────────
    const message = await prisma.conversationMessage.findUnique({
      where: { externalMessageId: wamid },
    });
    expect(message).not.toBeNull();
    expect(message!.conversationId).toBe(conv!.id);
    expect(message!.senderAddress).toBe(channelAddress);
    expect(message!.processingStatus).toBe('processed');
    expect(message!.processedAt).not.toBeNull();

    // ── MessageIntent row ─────────────────────────────────────────────────────
    const intent = await prisma.messageIntent.findUnique({
      where: { messageId: message!.id },
    });
    expect(intent).not.toBeNull();
    expect(intent!.action).toBe('buy_crypto');
    expect(intent!.conversationId).toBe(conv!.id);

    // ── ConversationReply row ─────────────────────────────────────────────────
    const reply = await prisma.conversationReply.findUnique({
      where: { messageId: message!.id },
    });
    expect(reply).not.toBeNull();
    expect(reply!.conversationId).toBe(conv!.id);
    expect(reply!.text).toContain('Here is your buy summary');
    expect(reply!.status).toBe('sent');
    expect(reply!.sentAt).not.toBeNull();

    // ── Sender called once with confirmation text ─────────────────────────────
    expect(fakeSender.sendText).toHaveBeenCalledTimes(1);
    expect(fakeSender.sendText).toHaveBeenCalledWith(
      channelAddress,
      expect.stringContaining('Here is your buy summary'),
    );
  });

  // ── Dedup ─────────────────────────────────────────────────────────────────

  it('duplicate wamid → no-op: second call does not create extra rows', async () => {
    const wamid = `wamid.dedup.${Date.now()}`;
    const msg: InboundMessage = {
      externalMessageId: wamid,
      fromAddress: channelAddress,
      phoneNumberId: 'ph-test-id',
      waName: 'Alice',
      text: 'buy 5000 NGN of USDT',
      timestamp: String(Math.floor(Date.now() / 1000)),
      channel: 'whatsapp',
    };

    await svc.handleInbound(msg);
    await svc.handleInbound(msg); // second call with same wamid

    // Still exactly one message row with this externalMessageId
    const count = await prisma.conversationMessage.count({
      where: { externalMessageId: wamid },
    });
    expect(count).toBe(1);

    // Agent was only called once (dedup prevents second run)
    expect(fakeAgentPort.run).toHaveBeenCalledTimes(1);
  });

  // ── none intent (clarification) ───────────────────────────────────────────

  it('none intent → clarification text persisted and sent', async () => {
    const wamid = `wamid.none.${Date.now()}`;
    const clarification = 'Could you clarify — did you want to buy or sell?';
    (fakeAgentPort.run as jest.Mock).mockResolvedValue({
      action: 'none',
      clarification,
    });

    const msg: InboundMessage = {
      externalMessageId: wamid,
      fromAddress: channelAddress,
      phoneNumberId: 'ph-test-id',
      waName: 'Alice',
      text: 'do something with crypto',
      timestamp: String(Math.floor(Date.now() / 1000)),
      channel: 'whatsapp',
    };

    await svc.handleInbound(msg);

    const reply = await prisma.conversationReply.findFirst({
      where: {
        message: { externalMessageId: wamid },
      },
    });
    expect(reply).not.toBeNull();
    expect(reply!.text).toBe(clarification);
    expect(reply!.status).toBe('sent');

    expect(fakeSender.sendText).toHaveBeenCalledWith(
      channelAddress,
      clarification,
    );
  });

  // ── Failure path ──────────────────────────────────────────────────────────

  it('proposalService throws → message marked failed, safe fallback sent, no throw', async () => {
    const wamid = `wamid.fail.${Date.now()}`;
    (fakeProposalService.createBuyProposal as jest.Mock).mockRejectedValue(
      new Error('RATE_PROVIDER_UNAVAILABLE'),
    );

    const msg: InboundMessage = {
      externalMessageId: wamid,
      fromAddress: channelAddress,
      phoneNumberId: 'ph-test-id',
      waName: 'Alice',
      text: 'buy 5000 NGN of USDT',
      timestamp: String(Math.floor(Date.now() / 1000)),
      channel: 'whatsapp',
    };

    await expect(svc.handleInbound(msg)).resolves.toBeUndefined();

    // Message row exists and is marked failed
    const message = await prisma.conversationMessage.findUnique({
      where: { externalMessageId: wamid },
    });
    expect(message).not.toBeNull();
    expect(message!.processingStatus).toBe('failed');
    expect(message!.errorReason).toContain('RATE_PROVIDER_UNAVAILABLE');

    // Safe fallback sent
    expect(fakeSender.sendText).toHaveBeenCalledWith(
      channelAddress,
      expect.stringContaining('something went wrong'),
    );
  });
});
