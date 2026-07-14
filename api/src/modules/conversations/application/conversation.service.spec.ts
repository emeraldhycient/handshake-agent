/**
 * Unit tests for ConversationService (tasks 2.3 + 6.3 + R1 + X2 + W1).
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
 *   - (W1) sell_crypto with default bank beneficiary → createSellProposal + sendFlow (request_pin)
 *   - (W1) sell_crypto with NO beneficiary → sendBeneficiaryFlow(bank) + retry message, NO proposal
 *   - (W1) send_crypto with crypto beneficiary → createSendProposal + sendFlow (request_step_up)
 *   - (W1) send_crypto with NO beneficiary → sendBeneficiaryFlow(crypto), NO proposal
 *   - (Wave B) sell/send recipientNickname: one match beats the default; multiple
 *     matches seed the beneficiary Flow with {id,label} candidates (text fallback
 *     lists labels + masked details); no match acknowledges the nickname and never
 *     silently uses the default; absent nickname keeps the default path
 */

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { InsufficientBalanceError } from '../../transactions/domain/execution-errors';
import {
  AmountTooSmallError,
  SelfSendError,
} from '../../transactions/domain/amount-guard-errors';
import { InvalidSendAddressError } from '../../transactions/domain/invalid-send-address.error';
import {
  BeneficiaryCoolingOffError,
  BeneficiaryWrongTypeError,
} from '../../beneficiaries/domain/beneficiary-errors';
import { SanctionsBlockedError } from '../../compliance/domain/compliance-errors';
import type { IAgentPort } from '../../agent/application/ports/agent.port';
import { AGENT_PORT } from '../../agent/application/ports/agent.port';
import type { IWhatsAppSender } from '../../whatsapp/application/ports/whatsapp-sender.port';
import { WHATSAPP_SENDER } from '../../whatsapp/application/ports/whatsapp-sender.port';
import type { InboundMessage } from '../../whatsapp/application/ports/inbound-handler.port';
import type { IdentityService } from '../../identity/application/identity.service';
import type {
  ProposalService,
  CreateBuyProposalOutput,
  CreateSellProposalOutput,
  CreateSendProposalOutput,
  CreateSwapProposalOutput,
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
import type { TransactionHistoryService } from '../../transactions/application/transaction-history.service';
import type { WalletService } from '../../wallets/application/wallet.service';
import type { WalletRecord } from '../../wallets/application/ports/wallet.repository.port';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import type { BeneficiaryRecord } from '../../beneficiaries/application/ports/beneficiary.repository.port';
import type { BalanceService } from '../../balances/application/balance.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_WALLET_ADDRESS = 'TRX_USDT_ADDR_ABC123';

const stubWalletRecord = (): WalletRecord => ({
  id: 'wallet-id-1',
  userId: 'user-id-1',
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

const stubBankBeneficiary = (): BeneficiaryRecord => ({
  id: 'ben-bank-id-1',
  userId: 'user-id-1',
  type: 'bank_account',
  label: 'My GTB Account',
  accountNumber: '0123456789',
  accountHolderName: 'Alice Doe',
  bankCode: '058',
  payoutCurrency: 'NGN',
  bankCountry: 'NG',
  cryptoAddress: null,
  cryptoAsset: null,
  cryptoNetwork: null,
  verificationStatus: 'verified',
  firstUseLockedUntil: null,
  verifiedAt: new Date(),
  isDefault: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
});

const stubCryptoBeneficiary = (): BeneficiaryRecord => ({
  id: 'ben-crypto-id-1',
  userId: 'user-id-1',
  type: 'crypto_address',
  label: 'My TRON wallet',
  accountNumber: null,
  accountHolderName: null,
  bankCode: null,
  payoutCurrency: null,
  bankCountry: null,
  cryptoAddress: 'TXxyzFakeAddress1234567890abcdef12',
  cryptoAsset: 'USDT',
  cryptoNetwork: 'TRON',
  verificationStatus: 'verified',
  firstUseLockedUntil: null,
  verifiedAt: new Date(),
  isDefault: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
});

const stubSellProposalOutput = (): CreateSellProposalOutput => ({
  proposalId: 'sell-proposal-id-1',
  quoteId: 'sell-quote-id-1',
  confirmation: {
    proposalId: 'sell-proposal-id-1',
    asset: 'USDT',
    cryptoAmount: '3.0625',
    fiatCurrency: 'NGN',
    netFiatAmount: '4900.00',
    fxRate: '1600',
    processingFeeAmount: '25.00',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    beneficiaryLabel: 'My GTB Account',
  },
});

const stubSendProposalOutput = (): CreateSendProposalOutput => ({
  proposalId: 'send-proposal-id-1',
  quoteId: null,
  confirmation: {
    proposalId: 'send-proposal-id-1',
    asset: 'USDT',
    cryptoAmount: '5.0',
    network: 'TRON',
    networkFeeCrypto: '0.5',
    totalDebit: '5.5',
    toAddressMasked: 'TXxyzF...ef12',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    beneficiaryLabel: 'My TRON wallet',
  },
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
 * Builds an InboundMessage with optional field overrides (extraction, text, etc.).
 * Useful for tests that exercise paths other than the plain-text/agent path.
 */
function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return { ...baseMsg(), ...overrides };
}

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

function stubSwapProposalOutput(): CreateSwapProposalOutput {
  return {
    proposalId: 'swap-proposal-id-1',
    quoteId: 'swap-quote-id-1',
    confirmation: {
      proposalId: 'swap-proposal-id-1',
      fromAsset: 'USDT',
      toAsset: 'TRX',
      fromAmount: '10',
      toAmount: '12345.67',
      rate: '1234.567',
      networkFee: '0.5',
      transactionFee: '0.1',
      estimatedArrivalSec: 30,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    },
  };
}

function makeProposalService(
  output: CreateBuyProposalOutput | Error = stubBuyProposalOutput(),
  sellOutput: CreateSellProposalOutput | Error = stubSellProposalOutput(),
  sendOutput: CreateSendProposalOutput | Error = stubSendProposalOutput(),
  swapOutput: CreateSwapProposalOutput | Error = stubSwapProposalOutput(),
): jest.Mocked<
  Pick<
    ProposalService,
    | 'createBuyProposal'
    | 'createSellProposal'
    | 'createSendProposal'
    | 'createSwapProposal'
  >
> {
  const svc = {
    createBuyProposal: jest.fn(),
    createSellProposal: jest.fn(),
    createSendProposal: jest.fn(),
    createSwapProposal: jest.fn(),
  };
  if (output instanceof Error) {
    svc.createBuyProposal.mockRejectedValue(output);
  } else {
    svc.createBuyProposal.mockResolvedValue(output);
  }
  if (sellOutput instanceof Error) {
    svc.createSellProposal.mockRejectedValue(sellOutput);
  } else {
    svc.createSellProposal.mockResolvedValue(sellOutput);
  }
  if (sendOutput instanceof Error) {
    svc.createSendProposal.mockRejectedValue(sendOutput);
  } else {
    svc.createSendProposal.mockResolvedValue(sendOutput);
  }
  if (swapOutput instanceof Error) {
    svc.createSwapProposal.mockRejectedValue(swapOutput);
  } else {
    svc.createSwapProposal.mockResolvedValue(swapOutput);
  }
  return svc;
}

function makeBeneficiaryService(
  defaultBeneficiary: BeneficiaryRecord | null = null,
  nicknameMatches: BeneficiaryRecord[] = [],
): jest.Mocked<
  Pick<
    BeneficiaryService,
    | 'getDefault'
    | 'listForUser'
    | 'addCryptoAddress'
    | 'addBankAccount'
    | 'resolveByNickname'
  >
> {
  return {
    getDefault: jest.fn().mockResolvedValue(defaultBeneficiary),
    listForUser: jest
      .fn()
      .mockResolvedValue(defaultBeneficiary ? [defaultBeneficiary] : []),
    addCryptoAddress: jest.fn().mockResolvedValue({ id: 'ben-crypto-new-1' }),
    addBankAccount: jest.fn().mockResolvedValue({ id: 'ben-bank-new-1' }),
    resolveByNickname: jest.fn().mockResolvedValue(nicknameMatches),
  };
}

function makeSender(): jest.Mocked<IWhatsAppSender> {
  return {
    sendText: jest.fn().mockResolvedValue({ externalMessageId: 'wamid.out' }),
    sendTemplate: jest
      .fn()
      .mockResolvedValue({ externalMessageId: 'wamid.out' }),
    sendCtaUrl: jest
      .fn()
      .mockResolvedValue({ externalMessageId: 'wamid.cta.out' }),
    sendFlow: jest
      .fn()
      .mockResolvedValue({ externalMessageId: 'wamid.flow.out' }),
    sendBeneficiaryFlow: jest
      .fn()
      .mockResolvedValue({ externalMessageId: 'wamid.ben.out' }),
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
    findWebHistory: jest.fn().mockResolvedValue([]),
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
  overrides: {
    flowId?: string;
    signingKey?: string;
    webAppBaseUrl?: string;
  } = {},
): jest.Mocked<ConfigService> {
  const flowId = overrides.flowId ?? '';
  const signingKey = overrides.signingKey ?? '';
  // Default to a configured base URL so the KYC handoff sends a token-less CTA
  // to `${WEB_APP_BASE_URL}${onboarding.webPath}`; pass '' to exercise the
  // plain-text fallback for an unconfigured base URL.
  const webAppBaseUrl = overrides.webAppBaseUrl ?? 'https://app.example.com';
  return {
    get: jest.fn((key: string) => {
      if (key === 'WHATSAPP_FLOW_ID') return flowId;
      if (key === 'DIRECTIVE_SIGNING_KEY') return signingKey;
      if (key === 'WEB_APP_BASE_URL') return webAppBaseUrl;
      if (key === 'onboarding.webPath') return '/get-started';
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
): jest.Mocked<Pick<WalletService, 'getOrProvisionNetworkWallet'>> {
  return {
    getOrProvisionNetworkWallet: jest.fn().mockResolvedValue(wallet),
  };
}

function makeBalanceService(
  snapshot: {
    fiatCurrency: string;
    asset?: string;
    totalFiatValue?: string;
    balances: Array<{
      asset: string;
      network: string;
      amount: string;
      fiatValue?: string;
    }>;
  } = {
    fiatCurrency: 'NGN',
    totalFiatValue: '16800.00',
    balances: [
      { asset: 'USDT', network: 'TRON', amount: '10.5', fiatValue: '16800.00' },
    ],
  },
): { getBalances: jest.Mock } {
  return { getBalances: jest.fn().mockResolvedValue(snapshot) };
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
    isCurrencyLive: jest.fn(() => true),
    isNetworkEnabled: jest.fn(() => true),
    isCapabilityEnabled: jest.fn(() => true),
    requireCapability: jest.fn(),
    assetProviderId: jest.fn(),
    validateAddress: jest.fn(() => true),
    inferNetworkForAddress: jest.fn(() => 'TRON'),
    defaultAssetForNetwork: jest.fn(() => 'USDT'),
  } as unknown as jest.Mocked<AssetRegistry>;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

function buildService(
  overrides: {
    identityService?: jest.Mocked<IdentityService>;
    agentPort?: jest.Mocked<IAgentPort>;
    proposalService?: jest.Mocked<
      Pick<
        ProposalService,
        | 'createBuyProposal'
        | 'createSellProposal'
        | 'createSendProposal'
        | 'createSwapProposal'
      >
    >;
    sender?: jest.Mocked<IWhatsAppSender>;
    convRepo?: jest.Mocked<IConversationRepository>;
    msgRepo?: jest.Mocked<IMessageRepository>;
    intentRepo?: jest.Mocked<IIntentRepository>;
    replyRepo?: jest.Mocked<IReplyRepository>;
    configService?: jest.Mocked<ConfigService>;
    directiveService?: jest.Mocked<Pick<DirectiveService, 'issue'>>;
    walletService?: jest.Mocked<
      Pick<WalletService, 'getOrProvisionNetworkWallet'>
    >;
    assetRegistry?: jest.Mocked<AssetRegistry>;
    beneficiaryService?: jest.Mocked<
      Pick<
        BeneficiaryService,
        | 'getDefault'
        | 'listForUser'
        | 'addCryptoAddress'
        | 'addBankAccount'
        | 'resolveByNickname'
      >
    >;
    historyService?: jest.Mocked<Pick<TransactionHistoryService, 'query'>>;
    balanceService?: { getBalances: jest.Mock };
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
  const beneficiaryService =
    overrides.beneficiaryService ?? makeBeneficiaryService();
  const historyService = overrides.historyService ?? makeHistoryService();
  const balanceService = overrides.balanceService ?? makeBalanceService();

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
    beneficiaryService as unknown as BeneficiaryService,
    historyService as unknown as TransactionHistoryService,
    balanceService as unknown as BalanceService,
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
    beneficiaryService,
    historyService,
    balanceService,
  };
}

function makeHistoryService(): jest.Mocked<
  Pick<TransactionHistoryService, 'query'>
> {
  return {
    query: jest.fn().mockResolvedValue({
      window: { from: 'F', to: 'T', label: 'Today' },
      items: [],
      totalCount: 0,
      truncated: false,
      downloadUrl:
        'https://api.example.com/transactions/statement/download?token=tok',
    }),
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

  // ── Contact (unlinked) + buy_crypto → KYC CTA handoff ───────────────────

  it('contact (unlinked) + buy_crypto → sends a token-less onboarding CTA, does NOT call proposalService', async () => {
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
    // K3: CTA URL sent, not plain text
    expect(sender.sendCtaUrl).toHaveBeenCalledTimes(1);
    const [ctaArg] = (
      sender.sendCtaUrl as jest.Mock<
        ReturnType<typeof sender.sendCtaUrl>,
        [{ to: string; url: string; buttonText: string; body: string }]
      >
    ).mock.calls[0];
    expect(ctaArg.to).toBe(FIXED_FROM);
    // Token-less onboarding URL: `${WEB_APP_BASE_URL}${onboarding.webPath}`.
    expect(ctaArg.url).toBe('https://app.example.com/get-started');
    expect(ctaArg.url).not.toContain('t=');
    expect(ctaArg.buttonText).toBeTruthy();
    // Reply summary text sent via sendText
    const sentText = captureFirstSentText(sender);
    expect(sentText).toContain('secure link');
  });

  it('contact (unlinked) + buy_crypto with WEB_APP_BASE_URL unset → text fallback, still no proposal', async () => {
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

    const convRepo = makeConvRepo(null);
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
      // WEB_APP_BASE_URL unset → onboardingUrl() returns '' → text fallback.
      configService: makeConfigService({ webAppBaseUrl: '' }),
    });

    await svc.handleInbound(baseMsg());

    expect(proposalService.createBuyProposal).not.toHaveBeenCalled();
    // sendCtaUrl NOT called since no base URL is configured
    expect(sender.sendCtaUrl).not.toHaveBeenCalled();
    // Plain text fallback sent
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

  // ── unparseable intent (ZodError) → clarification, NOT a safe-fallback ───────

  it('agent returns an unparseable intent (ZodError) → sends a rephrase clarification, message NOT marked failed', async () => {
    // The model is up but returned output failing IntentSchema.parse. This is an
    // ordinary "rephrase, please", NOT a provider outage: the user must get a
    // clarification, the message must process normally (not 'failed'), and the
    // generic safe-fallback ('something went wrong') must NOT be sent.
    const agentPort: jest.Mocked<IAgentPort> = {
      run: jest.fn().mockRejectedValue(
        new z.ZodError([
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'undefined',
            path: ['action'],
            message: 'Required',
          },
        ]),
      ),
    };
    const { svc, sender, msgRepo } = buildService({ agentPort });

    await svc.handleInbound(baseMsg());

    const sentText = captureFirstSentText(sender);
    expect(sentText).not.toContain('something went wrong');
    expect(sentText).toMatch(/rephrase|didn't (quite )?(catch|understand)/i);
    // Message processed normally, never marked failed.
    expect(msgRepo.updateStatus).not.toHaveBeenCalledWith(
      FIXED_MSG_ID,
      'failed',
      expect.anything(),
    );
  });

  // ── provider outage (non-Zod) → safe fallback (still a 5xx-style failure) ────

  it('a genuine provider outage (non-Zod error) still falls through to the safe fallback', async () => {
    const agentPort: jest.Mocked<IAgentPort> = {
      run: jest.fn().mockRejectedValue(new Error('anthropic 529 overloaded')),
    };
    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const { svc, sender, msgRepo } = buildService({ agentPort });

    await expect(svc.handleInbound(baseMsg())).resolves.toBeUndefined();

    const sentText = captureFirstSentText(sender);
    expect(sentText).toContain('something went wrong');
    expect(msgRepo.updateStatus).toHaveBeenCalledWith(
      FIXED_MSG_ID,
      'failed',
      'anthropic 529 overloaded',
    );

    loggerErrorSpy.mockRestore();
  });

  // ── multi-turn memory: prior turns threaded into the agent ───────────────────

  it('loads recent turns and threads them oldest→newest into the agent call', async () => {
    const msgRepo = makeMsgRepo();
    msgRepo.findWebHistory.mockResolvedValue([
      {
        id: 'm-2',
        userText: 'how much?',
        createdAt: new Date('2026-06-30T10:01:00Z'),
        reply: { text: 'How much USDT would you like?', outcome: null },
      },
      {
        id: 'm-1',
        userText: 'buy usdt',
        createdAt: new Date('2026-06-30T10:00:00Z'),
        reply: { text: 'Sure — which asset?', outcome: null },
      },
    ]);
    const agentPort = makeAgentPort({ action: 'none', clarification: 'ok' });
    const { svc } = buildService({ agentPort, msgRepo });

    await svc.handleInbound(baseMsg());

    // Server-built history (never client-supplied) is passed as the 2nd arg.
    const [text, history] = agentPort.run.mock.calls[0] as [
      string,
      Array<{ role: string; content: string }>,
    ];
    expect(text).toBe(baseMsg().text);
    expect(history[0]).toEqual({ role: 'user', content: 'buy usdt' });
    expect(history[history.length - 1]).toEqual({
      role: 'assistant',
      content: 'How much USDT would you like?',
    });
  });

  // ── swap, capability disabled → "not supported yet" ──────────────────────

  it('swap intent, crypto.swap capability disabled → sends "not supported yet" reply, no proposal', async () => {
    const agentPort = makeAgentPort({
      action: 'swap',
      fromAsset: 'USDT',
      toAsset: 'TRX',
      amount: '10',
    });
    const assetRegistry = makeAssetRegistry();
    // Override isCapabilityEnabled to return false for the swap capability.
    assetRegistry.isCapabilityEnabled.mockReturnValueOnce(false);
    const proposalService = makeProposalService();
    const { svc, sender } = buildService({
      agentPort,
      assetRegistry,
      proposalService,
    });

    await svc.handleInbound(baseMsg());

    const sentText = captureFirstSentText(sender);
    expect(sentText).toContain('not supported');
    expect(proposalService.createSwapProposal).not.toHaveBeenCalled();
  });

  // ── swap, capability live, verified user → proposal + flow/text confirmation ──

  it('swap intent, capability live, verified user, FLOW_ID empty → text confirmation, createSwapProposal called', async () => {
    const swapOut = stubSwapProposalOutput();
    const agentPort = makeAgentPort({
      action: 'swap',
      fromAsset: 'USDT',
      toAsset: 'TRX',
      amount: '10',
    });
    const proposalService = makeProposalService(
      stubBuyProposalOutput(),
      stubSellProposalOutput(),
      stubSendProposalOutput(),
      swapOut,
    );
    const { svc, sender } = buildService({
      agentPort,
      proposalService,
      configService: makeConfigService({
        flowId: '',
        signingKey: FIXED_SIGNING_KEY,
      }),
    });

    await svc.handleInbound(baseMsg());

    expect(proposalService.createSwapProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id-1',
        conversationId: FIXED_CONV_ID,
        fromAsset: 'USDT',
        toAsset: 'TRX',
        amount: '10',
      }),
    );
    // Text fallback: contains swap summary fields
    const sentText = captureFirstSentText(sender);
    expect(sentText).toContain('swap');
    expect(sender.sendFlow).not.toHaveBeenCalled();
  });

  it('swap intent, capability live, verified user, FLOW_ID set → sendFlow with swap data, directive request_pin', async () => {
    const swapOut = stubSwapProposalOutput();
    const agentPort = makeAgentPort({
      action: 'swap',
      fromAsset: 'USDT',
      toAsset: 'TRX',
      amount: '10',
    });
    const proposalService = makeProposalService(
      stubBuyProposalOutput(),
      stubSellProposalOutput(),
      stubSendProposalOutput(),
      swapOut,
    );
    const directiveService = makeDirectiveService();
    const { svc, sender } = buildService({
      agentPort,
      proposalService,
      directiveService,
      configService: makeConfigService({
        flowId: FIXED_FLOW_ID,
        signingKey: FIXED_SIGNING_KEY,
      }),
    });

    await svc.handleInbound(baseMsg());

    expect(proposalService.createSwapProposal).toHaveBeenCalled();
    expect(directiveService.issue).toHaveBeenCalledWith({
      proposalId: swapOut.proposalId,
      userId: 'user-id-1',
      ref: 'request_pin',
    });
    expect(sender.sendFlow).toHaveBeenCalledTimes(1);
    expect(sender.sendText).not.toHaveBeenCalledWith(
      FIXED_FROM,
      expect.stringContaining('Reply CONFIRM'),
    );
  });

  // ── swap, unlinked contact → KYC handoff, no proposal ────────────────────

  it('swap intent, unlinked contact → KYC handoff, createSwapProposal not called', async () => {
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
    const convRepo = makeConvRepo(null);
    convRepo.findByContactId.mockResolvedValue(null);
    convRepo.create.mockResolvedValue({
      ...baseConv(),
      userId: null,
      contactId: 'contact-id-1',
    });
    const agentPort = makeAgentPort({
      action: 'swap',
      fromAsset: 'USDT',
      toAsset: 'TRX',
      amount: '10',
    });
    const proposalService = makeProposalService();
    const { svc } = buildService({
      identityService,
      convRepo,
      agentPort,
      proposalService,
    });

    await svc.handleInbound(baseMsg());

    expect(proposalService.createSwapProposal).not.toHaveBeenCalled();
  });

  // ── check_balance (W-balance) ─────────────────────────────────────────────

  it('check_balance (all assets), verified user → text reply listing holdings, no proposal', async () => {
    const agentPort = makeAgentPort({ action: 'check_balance' });
    const { svc, sender, balanceService, proposalService } = buildService({
      agentPort,
    });

    await svc.handleInbound(baseMsg());

    expect(balanceService.getBalances).toHaveBeenCalledWith(
      'user-id-1',
      undefined,
    );
    const sentText = captureFirstSentText(sender);
    expect(sentText).toContain('USDT');
    // Read-only: no proposal is ever created for a balance check.
    expect(proposalService.createBuyProposal).not.toHaveBeenCalled();
  });

  it('check_balance scoped to USDT → passes the asset to the balance service', async () => {
    const agentPort = makeAgentPort({ action: 'check_balance', asset: 'USDT' });
    const { svc, balanceService } = buildService({ agentPort });

    await svc.handleInbound(baseMsg());

    expect(balanceService.getBalances).toHaveBeenCalledWith(
      'user-id-1',
      'USDT',
    );
  });

  it('check_balance, unlinked contact → KYC handoff, balance service NOT called', async () => {
    const identityService = makeIdentityService({
      resolveByChannel: jest.fn().mockResolvedValue({
        kind: 'contact',
        contact: { id: 'contact-id-1' },
      }),
    });
    const agentPort = makeAgentPort({ action: 'check_balance' });
    const { svc, balanceService } = buildService({
      identityService,
      agentPort,
    });

    await svc.handleInbound(baseMsg());

    expect(balanceService.getBalances).not.toHaveBeenCalled();
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

  it('linked user + receive_crypto → calls getOrProvisionNetworkWallet with network from registry, reply contains address + TRON + warning', async () => {
    const agentPort = makeAgentPort({ action: 'receive_crypto' });
    const walletService = makeWalletService();
    const { svc, sender, proposalService } = buildService({
      agentPort,
      walletService,
    });

    await svc.handleInbound(baseMsg());

    // WalletService called with userId + network resolved from registry (WN-2)
    expect(walletService.getOrProvisionNetworkWallet).toHaveBeenCalledWith(
      'user-id-1',
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

  // ── receive_crypto: unlinked contact → KYC CTA handoff ──────────────────

  it('contact (unlinked) + receive_crypto → onboarding CTA sent, walletService NOT called', async () => {
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
    expect(walletService.getOrProvisionNetworkWallet).not.toHaveBeenCalled();

    // K3: CTA URL sent
    expect(sender.sendCtaUrl).toHaveBeenCalledTimes(1);
    // Reply summary text sent via sendText
    const sentText = captureFirstSentText(sender);
    expect(sentText).toContain('secure link');
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

    expect(walletService.getOrProvisionNetworkWallet).not.toHaveBeenCalled();

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
    // K3: both produce the "secure link" CTA summary text.
    expect(buyReply).toBe(receiveReply);
    expect(buyReply).toContain('secure link');
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

  // ── receive_crypto: asset threaded from intent (bug fix) ──────────────────

  it('receive_crypto with asset=TRX in intent → reply uses TRX displayName ("TRX-coin"), not USDT displayName ("USD-coin")', async () => {
    // Agent named TRX — the reply must use TRX metadata, not the default USDT.
    // Use CLEARLY DISTINCT display names so the assertion distinguishes them.
    const agentPort = makeAgentPort({ action: 'receive_crypto', asset: 'TRX' });
    const walletService = makeWalletService();

    const assetRegistry = makeAssetRegistry();
    (assetRegistry.asset as jest.Mock).mockImplementation((symbol: string) => ({
      symbol,
      // Distinct sentinel names — 'TRX-coin' vs 'USD-coin' — so we can assert
      // the right one appears and the wrong one does NOT.
      displayName: symbol === 'TRX' ? 'TRX-coin' : 'USD-coin',
      kind: 'crypto',
      decimals: 6,
      networks: ['TRON'],
      providers: {},
      enabled: true,
    }));
    (assetRegistry.defaultNetworkFor as jest.Mock).mockReturnValue('TRON');
    (assetRegistry.network as jest.Mock).mockImplementation((id: string) => ({
      id,
      displayName: 'TRON (TRC-20)',
      addressPattern: '^T[1-9A-HJ-NP-Za-km-z]{33}$',
      enabled: true,
    }));

    const { svc, sender } = buildService({
      agentPort,
      walletService,
      assetRegistry,
    });

    await svc.handleInbound(baseMsg());

    const sentText = captureFirstSentText(sender);
    // Reply must use the TRX display name, not the USDT default.
    expect(sentText).toContain('TRX-coin');
    expect(sentText).not.toContain('USD-coin');
    // The address is still the same TRON wallet address.
    expect(sentText).toContain(FIXED_WALLET_ADDRESS);
  });

  it('receive_crypto with no asset in intent → reply falls back to default asset (USDT)', async () => {
    // Model did not name an asset — intent has no `asset` field.
    const agentPort = makeAgentPort({ action: 'receive_crypto' });
    const walletService = makeWalletService();
    const assetRegistry = makeAssetRegistry();

    const { svc, sender } = buildService({
      agentPort,
      walletService,
      assetRegistry,
    });

    await svc.handleInbound(baseMsg());

    const sentText = captureFirstSentText(sender);
    // Default registry stub's asset displayName for USDT is 'USDT' (makeAssetRegistry).
    expect(sentText).toContain(FIXED_WALLET_ADDRESS);
    // Should not throw and should produce a reply.
    expect(sentText.length).toBeGreaterThan(0);
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

  // ── W1: sell_crypto — with default bank beneficiary ───────────────────────

  it('(W1) sell_crypto with default bank beneficiary (FLOW_ID set) → createSellProposal + sendFlow (request_pin)', async () => {
    const sellOut = stubSellProposalOutput();
    const bankBen = stubBankBeneficiary();
    const agentPort = makeAgentPort({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '3.0625',
      fiatCurrency: 'NGN',
    });
    const proposalService = makeProposalService(
      stubBuyProposalOutput(),
      sellOut,
    );
    const beneficiaryService = makeBeneficiaryService(bankBen);
    const directiveOutput = {
      directiveId: FIXED_DIRECTIVE_ID,
      nonce: FIXED_NONCE,
      expiresAt: new Date(Date.now() + 300_000),
    };
    const directiveService = makeDirectiveService(directiveOutput);

    const { svc, sender } = buildService({
      agentPort,
      proposalService,
      beneficiaryService,
      directiveService,
      configService: makeConfigService({
        flowId: FIXED_FLOW_ID,
        signingKey: FIXED_SIGNING_KEY,
      }),
    });

    await svc.handleInbound(baseMsg());

    // Beneficiary lookup called with correct type
    expect(beneficiaryService.getDefault).toHaveBeenCalledWith(
      'user-id-1',
      'bank_account',
    );

    // Sell proposal created
    expect(proposalService.createSellProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id-1',
        beneficiaryId: bankBen.id,
      }),
    );

    // Directive issued with ref 'request_pin' (sell uses PIN)
    expect(directiveService.issue).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'request_pin' }),
    );

    // sendFlow called (not sendText confirmation)
    expect(sender.sendFlow).toHaveBeenCalledTimes(1);
    // No beneficiary flow (beneficiary exists)
    expect(sender.sendBeneficiaryFlow).not.toHaveBeenCalled();
  });

  it('(W1) sell_crypto with NO bank beneficiary → sendBeneficiaryFlow(bank_account) + retry message, NO proposal', async () => {
    const agentPort = makeAgentPort({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '3.0625',
      fiatCurrency: 'NGN',
    });
    const proposalService = makeProposalService();
    // null → no default bank beneficiary
    const beneficiaryService = makeBeneficiaryService(null);

    const { svc, sender } = buildService({
      agentPort,
      proposalService,
      beneficiaryService,
      configService: makeConfigService({
        flowId: FIXED_FLOW_ID,
        signingKey: FIXED_SIGNING_KEY,
      }),
    });

    await svc.handleInbound(baseMsg());

    // Beneficiary lookup was made
    expect(beneficiaryService.getDefault).toHaveBeenCalledWith(
      'user-id-1',
      'bank_account',
    );

    // NO sell proposal created
    expect(proposalService.createSellProposal).not.toHaveBeenCalled();

    // Beneficiary Flow sent to collect bank account
    expect(sender.sendBeneficiaryFlow).toHaveBeenCalledTimes(1);
    const benFlowArg = (
      sender.sendBeneficiaryFlow as jest.Mock<
        ReturnType<typeof sender.sendBeneficiaryFlow>,
        [Parameters<typeof sender.sendBeneficiaryFlow>[0]]
      >
    ).mock.calls[0][0];
    expect(benFlowArg.type).toBe('bank_account');
    // Wave G: the sell fiat currency is threaded into the add-bank Flow so the
    // user adds a bank in the correct currency (country derived server-side).
    expect(benFlowArg.currency).toBe('NGN');

    // sendFlow NOT called (no confirmation Flow)
    expect(sender.sendFlow).not.toHaveBeenCalled();

    // A retry message is sent via sendText
    const sentText = captureFirstSentText(sender);
    expect(sentText).toMatch(/bank|account|retry|sell/i);
  });

  it('(Wave G) sell_crypto with NO bank beneficiary threads a non-NGN sell currency into the beneficiary Flow', async () => {
    const agentPort = makeAgentPort({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '3.0625',
      fiatCurrency: 'GHS',
    });
    // null → no default bank beneficiary, so the add-bank Flow is dispatched.
    const beneficiaryService = makeBeneficiaryService(null);

    const { svc, sender } = buildService({
      agentPort,
      beneficiaryService,
      configService: makeConfigService({
        flowId: FIXED_FLOW_ID,
        signingKey: FIXED_SIGNING_KEY,
      }),
    });

    await svc.handleInbound(baseMsg());

    expect(sender.sendBeneficiaryFlow).toHaveBeenCalledTimes(1);
    const benFlowArg = (
      sender.sendBeneficiaryFlow as jest.Mock<
        ReturnType<typeof sender.sendBeneficiaryFlow>,
        [Parameters<typeof sender.sendBeneficiaryFlow>[0]]
      >
    ).mock.calls[0][0];
    expect(benFlowArg.type).toBe('bank_account');
    expect(benFlowArg.currency).toBe('GHS');
  });

  // ── W1: sell_crypto text fallback (no FLOW_ID) ───────────────────────────

  it('(W1) sell_crypto with beneficiary but FLOW_ID empty → text fallback, no sendFlow', async () => {
    const sellOut = stubSellProposalOutput();
    const bankBen = stubBankBeneficiary();
    const agentPort = makeAgentPort({
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '3.0625',
      fiatCurrency: 'NGN',
    });
    const proposalService = makeProposalService(
      stubBuyProposalOutput(),
      sellOut,
    );
    const beneficiaryService = makeBeneficiaryService(bankBen);

    const { svc, sender } = buildService({
      agentPort,
      proposalService,
      beneficiaryService,
      configService: makeConfigService({ flowId: '', signingKey: '' }),
    });

    await svc.handleInbound(baseMsg());

    expect(proposalService.createSellProposal).toHaveBeenCalled();
    expect(sender.sendFlow).not.toHaveBeenCalled();
    const sentText = captureFirstSentText(sender);
    expect(sentText).toContain('sell');
  });

  // ── W1: send_crypto — with default crypto beneficiary ────────────────────

  it('(W1) send_crypto with crypto beneficiary (FLOW_ID set) → createSendProposal + sendFlow (request_step_up)', async () => {
    const sendOut = stubSendProposalOutput();
    const cryptoBen = stubCryptoBeneficiary();
    const agentPort = makeAgentPort({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '5.0',
      network: 'TRON',
    });
    const proposalService = makeProposalService(
      stubBuyProposalOutput(),
      stubSellProposalOutput(),
      sendOut,
    );
    const beneficiaryService = makeBeneficiaryService(cryptoBen);
    const directiveOutput = {
      directiveId: FIXED_DIRECTIVE_ID,
      nonce: FIXED_NONCE,
      expiresAt: new Date(Date.now() + 300_000),
    };
    const directiveService = makeDirectiveService(directiveOutput);

    const { svc, sender } = buildService({
      agentPort,
      proposalService,
      beneficiaryService,
      directiveService,
      configService: makeConfigService({
        flowId: FIXED_FLOW_ID,
        signingKey: FIXED_SIGNING_KEY,
      }),
    });

    await svc.handleInbound(baseMsg());

    // Beneficiary lookup called with crypto_address type
    expect(beneficiaryService.getDefault).toHaveBeenCalledWith(
      'user-id-1',
      'crypto_address',
    );

    // Send proposal created
    expect(proposalService.createSendProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id-1',
        destination: { kind: 'saved_beneficiary', beneficiaryId: cryptoBen.id },
      }),
    );

    // Directive issued with ref 'request_step_up' (send uses step-up)
    expect(directiveService.issue).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'request_step_up' }),
    );

    // sendFlow called (not sendText confirmation)
    expect(sender.sendFlow).toHaveBeenCalledTimes(1);
    // No beneficiary flow
    expect(sender.sendBeneficiaryFlow).not.toHaveBeenCalled();
  });

  it('(W1) send_crypto with NO crypto beneficiary → sendBeneficiaryFlow(crypto_address), NO proposal', async () => {
    const agentPort = makeAgentPort({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '5.0',
      network: 'TRON',
    });
    const proposalService = makeProposalService();
    // null → no default crypto beneficiary
    const beneficiaryService = makeBeneficiaryService(null);

    const { svc, sender } = buildService({
      agentPort,
      proposalService,
      beneficiaryService,
      configService: makeConfigService({
        flowId: FIXED_FLOW_ID,
        signingKey: FIXED_SIGNING_KEY,
      }),
    });

    await svc.handleInbound(baseMsg());

    // Beneficiary lookup was made
    expect(beneficiaryService.getDefault).toHaveBeenCalledWith(
      'user-id-1',
      'crypto_address',
    );

    // NO send proposal created
    expect(proposalService.createSendProposal).not.toHaveBeenCalled();

    // Beneficiary Flow sent to collect crypto address
    expect(sender.sendBeneficiaryFlow).toHaveBeenCalledTimes(1);
    const benFlowArg = (
      sender.sendBeneficiaryFlow as jest.Mock<
        ReturnType<typeof sender.sendBeneficiaryFlow>,
        [Parameters<typeof sender.sendBeneficiaryFlow>[0]]
      >
    ).mock.calls[0][0];
    expect(benFlowArg.type).toBe('crypto_address');

    // sendFlow NOT called
    expect(sender.sendFlow).not.toHaveBeenCalled();
  });

  it('(W1) send_crypto with NO beneficiary, no FLOW_ID → text fallback message, NO proposal', async () => {
    const agentPort = makeAgentPort({
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '5.0',
      network: 'TRON',
    });
    const proposalService = makeProposalService();
    const beneficiaryService = makeBeneficiaryService(null);

    const { svc, sender } = buildService({
      agentPort,
      proposalService,
      beneficiaryService,
      configService: makeConfigService({ flowId: '', signingKey: '' }),
    });

    await svc.handleInbound(baseMsg());

    expect(proposalService.createSendProposal).not.toHaveBeenCalled();
    expect(sender.sendBeneficiaryFlow).not.toHaveBeenCalled();
    // Text fallback sent
    const sentText = captureFirstSentText(sender);
    expect(sentText).toMatch(/address|wallet|send/i);
  });

  // ── Wave B: sell/send recipient nicknames (WhatsApp parity) ───────────────
  // SECURITY (§3.1): a nickname is a server-resolved LOOKUP KEY against the
  // user's OWN beneficiaries. Resolution yields only a beneficiaryId; the
  // proposal service + engine re-validate ownership/type/cooling-off/sanctions.

  describe('(Wave B) recipientNickname resolution (sell + send)', () => {
    const sellIntentWithNickname = {
      action: 'sell_crypto',
      asset: 'USDT',
      cryptoAmount: '3.0625',
      fiatCurrency: 'NGN',
      recipientNickname: 'mum',
    };
    const sendIntentWithNickname = {
      action: 'send_crypto',
      asset: 'USDT',
      cryptoAmount: '5.0',
      network: 'TRON',
      recipientNickname: 'mum',
    };

    it('sell: ONE nickname match → proposal uses the NAMED beneficiary; default never consulted', async () => {
      const named: BeneficiaryRecord = {
        ...stubBankBeneficiary(),
        id: 'ben-bank-mum-1',
        label: 'Mum',
        isDefault: false,
      };
      const beneficiaryService = makeBeneficiaryService(
        stubBankBeneficiary(), // default exists but must NOT be used
        [named],
      );
      const { svc, sender, proposalService } = buildService({
        agentPort: makeAgentPort(sellIntentWithNickname),
        beneficiaryService,
        configService: makeConfigService({
          flowId: FIXED_FLOW_ID,
          signingKey: FIXED_SIGNING_KEY,
        }),
      });

      await svc.handleInbound(baseMsg());

      expect(beneficiaryService.resolveByNickname).toHaveBeenCalledWith(
        'user-id-1',
        'bank_account',
        'mum',
      );
      expect(proposalService.createSellProposal).toHaveBeenCalledWith(
        expect.objectContaining({ beneficiaryId: 'ben-bank-mum-1' }),
      );
      // The nickname beats the silent default: getDefault is never consulted.
      expect(beneficiaryService.getDefault).not.toHaveBeenCalled();
      expect(sender.sendBeneficiaryFlow).not.toHaveBeenCalled();
    });

    it('send: ONE nickname match → proposal uses the NAMED beneficiary; default never consulted', async () => {
      const named: BeneficiaryRecord = {
        ...stubCryptoBeneficiary(),
        id: 'ben-crypto-mum-1',
        label: 'Mum',
        isDefault: false,
      };
      const beneficiaryService = makeBeneficiaryService(
        stubCryptoBeneficiary(),
        [named],
      );
      const { svc, sender, proposalService } = buildService({
        agentPort: makeAgentPort(sendIntentWithNickname),
        beneficiaryService,
        configService: makeConfigService({
          flowId: FIXED_FLOW_ID,
          signingKey: FIXED_SIGNING_KEY,
        }),
      });

      await svc.handleInbound(baseMsg());

      expect(beneficiaryService.resolveByNickname).toHaveBeenCalledWith(
        'user-id-1',
        'crypto_address',
        'mum',
      );
      expect(proposalService.createSendProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: {
            kind: 'saved_beneficiary',
            beneficiaryId: 'ben-crypto-mum-1',
          },
        }),
      );
      expect(beneficiaryService.getDefault).not.toHaveBeenCalled();
      expect(sender.sendBeneficiaryFlow).not.toHaveBeenCalled();
    });

    it('sell: MULTIPLE nickname matches (FLOW_ID set) → beneficiary Flow SEEDED with the candidates, NO proposal', async () => {
      const matchA: BeneficiaryRecord = {
        ...stubBankBeneficiary(),
        id: 'ben-bank-mum-1',
        label: 'Mum',
      };
      const matchB: BeneficiaryRecord = {
        ...stubBankBeneficiary(),
        id: 'ben-bank-mum-2',
        label: 'mum',
        isDefault: false,
      };
      const beneficiaryService = makeBeneficiaryService(stubBankBeneficiary(), [
        matchA,
        matchB,
      ]);
      const { svc, sender, proposalService } = buildService({
        agentPort: makeAgentPort(sellIntentWithNickname),
        beneficiaryService,
        configService: makeConfigService({
          flowId: FIXED_FLOW_ID,
          signingKey: FIXED_SIGNING_KEY,
        }),
      });

      await svc.handleInbound(baseMsg());

      // No proposal for an ambiguous nickname; default never consulted.
      expect(proposalService.createSellProposal).not.toHaveBeenCalled();
      expect(beneficiaryService.getDefault).not.toHaveBeenCalled();

      // The beneficiary Flow is seeded with the candidate {id, label} list.
      expect(sender.sendBeneficiaryFlow).toHaveBeenCalledTimes(1);
      const benFlowArg = (
        sender.sendBeneficiaryFlow as jest.Mock<
          ReturnType<typeof sender.sendBeneficiaryFlow>,
          [Parameters<typeof sender.sendBeneficiaryFlow>[0]]
        >
      ).mock.calls[0][0];
      expect(benFlowArg.type).toBe('bank_account');
      expect(benFlowArg.beneficiaries).toEqual([
        { id: 'ben-bank-mum-1', label: 'Mum' },
        { id: 'ben-bank-mum-2', label: 'mum' },
      ]);

      // Accompanying text asks which recipient was meant.
      const sentText = captureFirstSentText(sender);
      expect(sentText).toContain("'mum'");
      expect(sentText).toMatch(/which one/i);
    });

    it('send: MULTIPLE nickname matches with NO FLOW_ID → text fallback LISTS the candidate labels, NO proposal', async () => {
      const matchA: BeneficiaryRecord = {
        ...stubCryptoBeneficiary(),
        id: 'ben-crypto-mum-1',
        label: 'Mum main',
      };
      const matchB: BeneficiaryRecord = {
        ...stubCryptoBeneficiary(),
        id: 'ben-crypto-mum-2',
        label: 'Mum backup',
        isDefault: false,
      };
      const beneficiaryService = makeBeneficiaryService(
        stubCryptoBeneficiary(),
        [matchA, matchB],
      );
      const { svc, sender, proposalService } = buildService({
        agentPort: makeAgentPort(sendIntentWithNickname),
        beneficiaryService,
        configService: makeConfigService({ flowId: '', signingKey: '' }),
      });

      await svc.handleInbound(baseMsg());

      expect(proposalService.createSendProposal).not.toHaveBeenCalled();
      expect(sender.sendBeneficiaryFlow).not.toHaveBeenCalled();
      expect(beneficiaryService.getDefault).not.toHaveBeenCalled();

      const sentText = captureFirstSentText(sender);
      // Lists every candidate label with the HUMAN-SAFE masked destination
      // (maskBeneficiaryDetail parity: first 6 + '...' + last 4) — never the
      // full address.
      expect(sentText).toContain('Mum main');
      expect(sentText).toContain('Mum backup');
      expect(sentText).toContain('TXxyzF...ef12');
      expect(sentText).not.toContain('TXxyzFakeAddress1234567890abcdef12');
      expect(sentText).toMatch(/which one/i);
    });

    it('sell: NO nickname match → beneficiary Flow + reply acknowledging the nickname; default NOT silently used', async () => {
      // Default exists — but a missed nickname must NOT quietly route money
      // to the default recipient.
      const beneficiaryService = makeBeneficiaryService(
        stubBankBeneficiary(),
        [],
      );
      const { svc, sender, proposalService } = buildService({
        agentPort: makeAgentPort({
          ...sellIntentWithNickname,
          recipientNickname: 'aunty',
        }),
        beneficiaryService,
        configService: makeConfigService({
          flowId: FIXED_FLOW_ID,
          signingKey: FIXED_SIGNING_KEY,
        }),
      });

      await svc.handleInbound(baseMsg());

      expect(proposalService.createSellProposal).not.toHaveBeenCalled();
      expect(beneficiaryService.getDefault).not.toHaveBeenCalled();

      // Existing beneficiary-Flow path (add-new form) still fires.
      expect(sender.sendBeneficiaryFlow).toHaveBeenCalledTimes(1);
      const benFlowArg = (
        sender.sendBeneficiaryFlow as jest.Mock<
          ReturnType<typeof sender.sendBeneficiaryFlow>,
          [Parameters<typeof sender.sendBeneficiaryFlow>[0]]
        >
      ).mock.calls[0][0];
      expect(benFlowArg.type).toBe('bank_account');
      expect(benFlowArg.beneficiaries).toEqual([]);

      // The reply acknowledges the unmatched nickname.
      const sentText = captureFirstSentText(sender);
      expect(sentText).toContain("'aunty'");
      expect(sentText).toMatch(/no saved/i);
    });

    it('send: NO nickname match, no FLOW_ID → text fallback acknowledges the nickname, NO proposal', async () => {
      const beneficiaryService = makeBeneficiaryService(
        stubCryptoBeneficiary(),
        [],
      );
      const { svc, sender, proposalService } = buildService({
        agentPort: makeAgentPort({
          ...sendIntentWithNickname,
          recipientNickname: 'aunty',
        }),
        beneficiaryService,
        configService: makeConfigService({ flowId: '', signingKey: '' }),
      });

      await svc.handleInbound(baseMsg());

      expect(proposalService.createSendProposal).not.toHaveBeenCalled();
      expect(sender.sendBeneficiaryFlow).not.toHaveBeenCalled();
      expect(beneficiaryService.getDefault).not.toHaveBeenCalled();

      const sentText = captureFirstSentText(sender);
      expect(sentText).toContain("'aunty'");
      expect(sentText).toMatch(/no saved/i);
    });

    it('send: ABSENT nickname preserves the default-beneficiary path (no nickname lookup)', async () => {
      const cryptoBen = stubCryptoBeneficiary();
      const beneficiaryService = makeBeneficiaryService(cryptoBen);
      const { svc, proposalService } = buildService({
        agentPort: makeAgentPort({
          action: 'send_crypto',
          asset: 'USDT',
          cryptoAmount: '5.0',
          network: 'TRON',
        }),
        beneficiaryService,
        configService: makeConfigService({
          flowId: FIXED_FLOW_ID,
          signingKey: FIXED_SIGNING_KEY,
        }),
      });

      await svc.handleInbound(baseMsg());

      expect(beneficiaryService.resolveByNickname).not.toHaveBeenCalled();
      expect(beneficiaryService.getDefault).toHaveBeenCalledWith(
        'user-id-1',
        'crypto_address',
      );
      expect(proposalService.createSendProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: {
            kind: 'saved_beneficiary',
            beneficiaryId: cryptoBen.id,
          },
        }),
      );
    });
  });

  // ── sell/send proposal-error parity → clarification text, NOT a safe-fallback ──

  describe('sell/send proposal errors → clarification (not a safe-fallback)', () => {
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
    ])(
      'sell_crypto createSellProposal throws %s → clarification text, message not failed',
      async (_label, err: Error) => {
        const proposalService = makeProposalService(
          stubBuyProposalOutput(),
          err, // createSellProposal rejects
        );
        const agentPort = makeAgentPort({
          action: 'sell_crypto',
          asset: 'USDT',
          cryptoAmount: '5',
          fiatCurrency: 'NGN',
        });
        const beneficiaryService = makeBeneficiaryService(
          stubBankBeneficiary(),
        );
        const { svc, sender, msgRepo } = buildService({
          agentPort,
          proposalService,
          beneficiaryService,
        });

        await svc.handleInbound(baseMsg());

        const sentText = captureFirstSentText(sender);
        expect(sentText).not.toContain('something went wrong');
        expect(sentText.length).toBeGreaterThan(0);
        expect(msgRepo.updateStatus).not.toHaveBeenCalledWith(
          FIXED_MSG_ID,
          'failed',
          expect.anything(),
        );
      },
    );

    it.each([
      [
        'InsufficientBalanceError',
        new InsufficientBalanceError('1', '5', 'USDT'),
      ],
      [
        'BeneficiaryCoolingOffError',
        new BeneficiaryCoolingOffError('ben-1', new Date(Date.now() + 1e6)),
      ],
      [
        'BeneficiaryWrongTypeError',
        new BeneficiaryWrongTypeError(
          'ben-1',
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
      [
        'InvalidSendAddressError',
        new InvalidSendAddressError('bad-address', 'TRON'),
      ],
    ])(
      'send_crypto createSendProposal throws %s → clarification text, message not failed',
      async (_label, err: Error) => {
        const proposalService = makeProposalService(
          stubBuyProposalOutput(),
          stubSellProposalOutput(),
          err, // createSendProposal rejects
        );
        const agentPort = makeAgentPort({
          action: 'send_crypto',
          asset: 'USDT',
          cryptoAmount: '5.0',
          network: 'TRON',
        });
        const beneficiaryService = makeBeneficiaryService(
          stubCryptoBeneficiary(),
        );
        const { svc, sender, msgRepo } = buildService({
          agentPort,
          proposalService,
          beneficiaryService,
        });

        await svc.handleInbound(baseMsg());

        const sentText = captureFirstSentText(sender);
        expect(sentText).not.toContain('something went wrong');
        expect(sentText.length).toBeGreaterThan(0);
        expect(msgRepo.updateStatus).not.toHaveBeenCalledWith(
          FIXED_MSG_ID,
          'failed',
          expect.anything(),
        );
      },
    );

    it('an UNEXPECTED createSellProposal error still falls through to the safe fallback', async () => {
      const proposalService = makeProposalService(
        stubBuyProposalOutput(),
        new Error('unexpected boom'),
      );
      const agentPort = makeAgentPort({
        action: 'sell_crypto',
        asset: 'USDT',
        cryptoAmount: '5',
        fiatCurrency: 'NGN',
      });
      const beneficiaryService = makeBeneficiaryService(stubBankBeneficiary());
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      const { svc, sender, msgRepo } = buildService({
        agentPort,
        proposalService,
        beneficiaryService,
      });

      await expect(svc.handleInbound(baseMsg())).resolves.toBeUndefined();

      const sentText = captureFirstSentText(sender);
      expect(sentText).toContain('something went wrong');
      expect(msgRepo.updateStatus).toHaveBeenCalledWith(
        FIXED_MSG_ID,
        'failed',
        'unexpected boom',
      );

      loggerErrorSpy.mockRestore();
    });
  });

  // ── currency_not_live: buy_crypto with non-live fiat → graceful text, no proposal ──

  it('buy_crypto with non-live fiatCurrency (RWF) → graceful text reply, no proposal, no beneficiary lookup', async () => {
    const assetRegistry = makeAssetRegistry();
    (assetRegistry.isCurrencyLive as jest.Mock) = jest
      .fn()
      .mockReturnValue(false);

    const { svc, sender, proposalService } = buildService({
      agentPort: makeAgentPort({
        action: 'buy_crypto',
        asset: 'USDT',
        fiatAmount: '50000',
        fiatCurrency: 'RWF',
      }),
      assetRegistry,
    });

    await svc.handleInbound(baseMsg());

    expect(proposalService.createBuyProposal).not.toHaveBeenCalled();
    // A graceful message must be sent — it should mention the currency is not available.
    const sentText = captureFirstSentText(sender);
    expect(sentText).toMatch(/RWF|not available|settle/i);
    // Must NOT say "only NGN" — that's the old hard-rejection pattern.
    expect(sentText).not.toMatch(/only NGN/i);
  });

  it('sell_crypto with non-live fiatCurrency (GHS) → graceful text reply, no proposal', async () => {
    const assetRegistry = makeAssetRegistry();
    (assetRegistry.isCurrencyLive as jest.Mock) = jest
      .fn()
      .mockReturnValue(false);

    const { svc, sender, proposalService, beneficiaryService } = buildService({
      agentPort: makeAgentPort({
        action: 'sell_crypto',
        asset: 'USDT',
        cryptoAmount: '5',
        fiatCurrency: 'GHS',
      }),
      assetRegistry,
    });

    await svc.handleInbound(baseMsg());

    expect(proposalService.createSellProposal).not.toHaveBeenCalled();
    expect(beneficiaryService.getDefault).not.toHaveBeenCalled();
    const sentText = captureFirstSentText(sender);
    expect(sentText).toMatch(/GHS|not available|settle/i);
  });

  // ── query_transactions (linked user) → text list + download CTA ────────────

  it('query_transactions (linked user) → sends a text list + a download CTA', async () => {
    const { svc, sender } = buildService({
      agentPort: {
        run: jest.fn().mockResolvedValue({
          action: 'query_transactions',
          period: 'today',
          download: true,
        }),
      } as unknown as jest.Mocked<IAgentPort>,
      historyService: {
        query: jest.fn().mockResolvedValue({
          window: { from: 'F', to: 'T', label: 'Today' },
          items: [
            {
              id: 't1',
              type: 'buy',
              status: 'completed',
              direction: 'in',
              cryptoAmount: '29.97 USDT',
              createdAt: '2026-06-29T09:00:00.000Z',
            },
          ],
          totalCount: 1,
          truncated: false,
          downloadUrl:
            'https://api.example.com/transactions/statement/download?token=tok',
        }),
      } as unknown as jest.Mocked<Pick<TransactionHistoryService, 'query'>>,
    });

    await svc.handleInbound(baseMsg());

    expect(sender.sendText).toHaveBeenCalled();
    expect(sender.sendCtaUrl).toHaveBeenCalledTimes(1);
    const ctaArg = (
      sender.sendCtaUrl as jest.Mock<
        ReturnType<typeof sender.sendCtaUrl>,
        [Parameters<typeof sender.sendCtaUrl>[0]]
      >
    ).mock.calls[0][0];
    expect(ctaArg.buttonText).toBe('Download');
    expect(ctaArg.url).toContain('token=tok');
  });

  it('query_transactions forwards a relative-duration spec to the history service', async () => {
    const historyQuery = jest.fn().mockResolvedValue({
      window: { from: 'F', to: 'T', label: 'Last 6 months' },
      items: [],
      totalCount: 0,
      truncated: false,
      hasMore: false,
      nextCursor: null,
      txType: 'all',
      downloadUrl:
        'https://api.example.com/transactions/statement/download?token=tok',
    });
    const { svc } = buildService({
      agentPort: {
        run: jest.fn().mockResolvedValue({
          action: 'query_transactions',
          relativeAmount: 6,
          relativeUnit: 'month',
          download: false,
        }),
      } as unknown as jest.Mocked<IAgentPort>,
      historyService: { query: historyQuery } as unknown as jest.Mocked<
        Pick<TransactionHistoryService, 'query'>
      >,
    });

    await svc.handleInbound(baseMsg());

    expect(historyQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ relativeAmount: 6, relativeUnit: 'month' }),
    );
  });

  // ── Task 18: extracted image/document routing ─────────────────────────────

  it('(T18) saves an extracted crypto address as a beneficiary and confirms', async () => {
    const assetRegistry = makeAssetRegistry();
    (assetRegistry.inferNetworkForAddress as jest.Mock).mockReturnValue('TRON');
    (assetRegistry.defaultAssetForNetwork as jest.Mock).mockReturnValue('USDT');
    const beneficiaryService = makeBeneficiaryService();
    (beneficiaryService.addCryptoAddress as jest.Mock).mockResolvedValue({
      id: 'b1',
    });

    const { svc, sender, agentPort } = buildService({
      assetRegistry,
      beneficiaryService,
    });

    await svc.handleInbound(
      makeMsg({
        extraction: {
          kind: 'crypto_address',
          address: 'TXYZAbcdefghij1234567890abcd',
        },
      }),
    );

    expect(beneficiaryService.addCryptoAddress).toHaveBeenCalledWith(
      expect.objectContaining({ network: 'TRON', asset: 'USDT' }),
    );
    expect(sender.sendText).toHaveBeenCalledWith(
      FIXED_FROM,
      expect.stringMatching(/payout address/i),
    );
    // Agent must NOT run for an extraction message
    expect(agentPort.run).not.toHaveBeenCalled();
  });

  it('(T18) replies with a polite failure when the address is not a supported network', async () => {
    const assetRegistry = makeAssetRegistry();
    (assetRegistry.inferNetworkForAddress as jest.Mock).mockReturnValue(null);
    const beneficiaryService = makeBeneficiaryService();

    const { svc, sender } = buildService({ assetRegistry, beneficiaryService });

    await svc.handleInbound(
      makeMsg({ extraction: { kind: 'crypto_address', address: 'garbage' } }),
    );

    expect(beneficiaryService.addCryptoAddress).not.toHaveBeenCalled();
    expect(sender.sendText).toHaveBeenCalledWith(
      FIXED_FROM,
      expect.stringMatching(/valid wallet/i),
    );
  });

  it('(T18) does not run the agent for an extraction message with kind=none', async () => {
    const { svc, agentPort, sender } = buildService();

    await svc.handleInbound(makeMsg({ extraction: { kind: 'none' } }));

    expect(agentPort.run).not.toHaveBeenCalled();
    expect(sender.sendText).toHaveBeenCalledWith(
      FIXED_FROM,
      expect.stringMatching(/couldn't find/i),
    );
  });

  it('(T18) sends the KYC handoff when an unlinked contact sends an image with an extracted address', async () => {
    const identityService = makeIdentityService({
      resolveByChannel: jest.fn().mockResolvedValue({
        kind: 'contact',
        contact: {
          id: 'contact-id-img-1',
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
      contactId: 'contact-id-img-1',
    });

    const beneficiaryService = makeBeneficiaryService();

    const { svc, sender } = buildService({
      identityService,
      convRepo,
      beneficiaryService,
    });

    await svc.handleInbound(
      makeMsg({
        extraction: {
          kind: 'crypto_address',
          address: 'TXYZAbcdefghij1234567890abcd',
        },
      }),
    );

    // KYC handoff must be triggered — sendCtaUrl (CTA branch) OR sendText with KYC content (text fallback)
    const ctaCalled = (sender.sendCtaUrl as jest.Mock).mock.calls.length > 0;
    const kycText = (sender.sendText as jest.Mock).mock.calls.some(
      ([, text]: [string, string]) => /verify|identity|link|kyc/i.test(text),
    );
    expect(ctaCalled || kycText).toBe(true);
    // Beneficiary must NOT be saved for an unlinked contact
    expect(beneficiaryService.addCryptoAddress).not.toHaveBeenCalled();
  });

  it('(T18) echoes bank details without auto-saving when no bankCode is present', async () => {
    const beneficiaryService = makeBeneficiaryService();

    const { svc, sender } = buildService({ beneficiaryService });

    await svc.handleInbound(
      makeMsg({
        extraction: {
          kind: 'bank_account',
          accountNumber: '0123456789',
          bankName: 'GTBank',
        },
      }),
    );

    expect(beneficiaryService.addBankAccount).not.toHaveBeenCalled();
    expect(sender.sendText).toHaveBeenCalledWith(
      FIXED_FROM,
      expect.stringMatching(/0123456789|account/i),
    );
  });

  it('(A2) saves an image-extracted bank account as UNVERIFIED + cooling-off (forceUnverified), never immediately usable', async () => {
    const beneficiaryService = makeBeneficiaryService();
    (beneficiaryService.addBankAccount as jest.Mock).mockResolvedValue({
      id: 'ben-bank-img-1',
      accountHolderName: null,
      verificationStatus: 'unverified',
    });

    const { svc, sender, agentPort } = buildService({ beneficiaryService });

    await svc.handleInbound(
      makeMsg({
        extraction: {
          kind: 'bank_account',
          accountNumber: '0123456789',
          bankCode: '058',
          bankName: 'GTBank',
        },
      }),
    );

    // A2: an image message carries no PIN/step-up — the extracted account must be
    // persisted as a fresh unverified destination (forceUnverified skips
    // name-enquiry and applies the first-use cooling-off), NOT verified/usable.
    expect(beneficiaryService.addBankAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        accountNumber: '0123456789',
        bankCode: '058',
        forceUnverified: true,
      }),
    );
    // The reply flags the review/cooling-off state so the user knows to check it.
    expect(sender.sendText).toHaveBeenCalledWith(
      FIXED_FROM,
      expect.stringMatching(/unverified|review|cooling/i),
    );
    // Agent must NOT run for an extraction message.
    expect(agentPort.run).not.toHaveBeenCalled();
  });
});
