/**
 * Integration test for the inbound→agent→proposal→reply conversation flow (tasks 2.3 + R1).
 *
 * Uses a real Postgres via Testcontainers. The agent (LLM) and WhatsApp sender
 * are replaced with lightweight fakes so no external calls are made.
 *
 * Seeds a Tier-1 verified User + ChannelIdentity, then calls handleInbound
 * directly and asserts that rows are persisted across all four conversation tables
 * (conversations, conversation_messages, message_intents, conversation_replies).
 */

import { ConfigService } from '@nestjs/config';
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
import type { DirectiveService } from '../src/modules/transactions/application/directive.service';
import type { WalletService } from '../src/modules/wallets/application/wallet.service';
import type { WalletRecord } from '../src/modules/wallets/application/ports/wallet.repository.port';
import type { BuyProposalConfirmation } from '@handshake-agent/contracts';
import type { AssetRegistry } from '../src/core/catalog/asset-registry';
import type { HandoffTokenService } from '../src/modules/identity/application/handoff-token.service';

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
  sendCtaUrl: jest
    .fn()
    .mockResolvedValue({ externalMessageId: 'wamid.out.cta' }),
  sendFlow: jest
    .fn()
    .mockResolvedValue({ externalMessageId: 'wamid.out.flow' }),
  sendBeneficiaryFlow: jest
    .fn()
    .mockResolvedValue({ externalMessageId: 'wamid.out.ben.flow' }),
};

/**
 * Fake ConfigService — WHATSAPP_FLOW_ID is empty so the service uses the
 * plain-text confirmation fallback path (Flow not yet published in Meta).
 */
const fakeConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'WHATSAPP_FLOW_ID') return '';
    if (key === 'DIRECTIVE_SIGNING_KEY') return '';
    return undefined;
  }),
} as unknown as ConfigService;

/** Fake DirectiveService — not exercised in the text-fallback path but required by the ctor. */
const fakeDirectiveService = {
  issue: jest.fn().mockResolvedValue({
    directiveId: 'directive-id-stub',
    nonce: 'nonce-stub',
    expiresAt: new Date(Date.now() + 300_000),
  }),
} as unknown as DirectiveService;

/** Fake WalletService — returns a fixed USDT-on-TRON wallet record. */
const FAKE_WALLET_ADDRESS = 'TRXFakeAddress_e2e_test_ABC';
const fakeWalletRecord: WalletRecord = {
  id: 'wallet-e2e-id-1',
  userId: '', // will be overridden in the test if needed
  asset: 'USDT',
  network: 'TRON',
  address: FAKE_WALLET_ADDRESS,
  providerReference: 'blockradar-ref-e2e',
  status: 'active',
};
const fakeWalletService = {
  getOrProvisionWallet: jest.fn().mockResolvedValue(fakeWalletRecord),
  getOrProvisionUsdtTronWallet: jest.fn().mockResolvedValue(fakeWalletRecord),
} as unknown as WalletService;

/**
 * Fake AssetRegistry — mirrors the real registry's surface used by ConversationService.
 * Uses the same display names as the real configuration so assertions remain stable.
 */
const fakeAssetRegistry: AssetRegistry = {
  asset: jest.fn((symbol: string) => ({
    symbol,
    displayName: symbol,
    kind: 'crypto' as const,
    decimals: 6,
    networks: ['TRON'],
    providers: {
      blockradar: { assetId: 'f56d297c-a3db-4cda-95bd-180b54679070' },
    },
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
    (code: string, amount: string) => `${code === 'NGN' ? '₦' : code}${amount}`,
  ),
  isAssetEnabled: jest.fn(() => true),
  isFiatEnabled: jest.fn(() => true),
  isNetworkEnabled: jest.fn(() => true),
  isCapabilityEnabled: jest.fn(() => true),
  requireCapability: jest.fn(),
  assetProviderId: jest.fn(() => 'f56d297c-a3db-4cda-95bd-180b54679070'),
  validateAddress: jest.fn(() => true),
} as unknown as AssetRegistry;

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

    const fakeHandoffTokenService = {
      mintKycToken: jest.fn().mockResolvedValue({
        token: 'fake-token',
        url: 'https://app.example.com/kyc?t=fake-token',
      }),
      consumeKycToken: jest.fn(),
    } as unknown as HandoffTokenService;

    const fakeBeneficiaryService = {
      getDefault: jest.fn().mockResolvedValue(null),
      listForUser: jest.fn().mockResolvedValue([]),
    } as unknown as import('../src/modules/beneficiaries/application/beneficiary.service').BeneficiaryService;

    svc = new ConversationService(
      identityService,
      fakeAgentPort,
      fakeProposalService,
      fakeSender,
      convRepo,
      msgRepo,
      intentRepo,
      replyRepo,
      fakeConfigService,
      fakeDirectiveService,
      fakeWalletService,
      fakeAssetRegistry,
      fakeHandoffTokenService,
      fakeBeneficiaryService,
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
    (fakeSender.sendFlow as jest.Mock).mockResolvedValue({
      externalMessageId: 'wamid.out.flow',
    });
    // fakeConfigService.get returns '' for WHATSAPP_FLOW_ID — re-apply after clearAllMocks
    (fakeConfigService.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'WHATSAPP_FLOW_ID') return '';
      if (key === 'DIRECTIVE_SIGNING_KEY') return '';
      return undefined;
    });
    (fakeProposalService.createBuyProposal as jest.Mock).mockResolvedValue({
      proposalId: 'proposal-test-id',
      quoteId: 'quote-test-id',
      confirmation: fakeConfirmation,
    });
    (fakeWalletService.getOrProvisionWallet as jest.Mock).mockResolvedValue(
      fakeWalletRecord,
    );
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

  // ── receive_crypto: deposit address ───────────────────────────────────────

  it('receive_crypto intent → reply persisted with provisioned USDT-TRON address and warning', async () => {
    const wamid = `wamid.receive.${Date.now()}`;
    (fakeAgentPort.run as jest.Mock).mockResolvedValue({
      action: 'receive_crypto',
    });

    const msg: InboundMessage = {
      externalMessageId: wamid,
      fromAddress: channelAddress,
      phoneNumberId: 'ph-test-id',
      waName: 'Alice',
      text: 'I want to receive USDT',
      timestamp: String(Math.floor(Date.now() / 1000)),
      channel: 'whatsapp',
    };

    await svc.handleInbound(msg);

    // WalletService was called with userId + asset/network from registry defaults
    expect(fakeWalletService.getOrProvisionWallet).toHaveBeenCalledWith(
      userId,
      'USDT',
      'TRON',
    );

    // Reply persisted with the deposit address and TRON warning
    const reply = await prisma.conversationReply.findFirst({
      where: { message: { externalMessageId: wamid } },
    });
    expect(reply).not.toBeNull();
    expect(reply!.text).toContain(FAKE_WALLET_ADDRESS);
    expect(reply!.text).toContain('TRON');
    // Warning is built from registry displayNames ('TRON (TRC-20)' from fakeAssetRegistry).
    expect(reply!.text).toContain('Only send USDT');
    expect(reply!.text).toContain('Other assets or networks will be lost.');
    expect(reply!.status).toBe('sent');
    expect(reply!.sentAt).not.toBeNull();

    // Sender dispatched the reply text
    expect(fakeSender.sendText).toHaveBeenCalledWith(
      channelAddress,
      expect.stringContaining(FAKE_WALLET_ADDRESS),
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
