/**
 * WebChatService — application-layer orchestrator for the web chat endpoint.
 *
 * Invariants (CLAUDE.md §3):
 *   - §3.1 model proposes, engine disposes: this service interprets intent and
 *     delegates to ProposalService for proposal creation, never executing transactions.
 *   - §3.2 no DB access here: all persistence goes through injected repository ports.
 *   - §3.3 KYC gate: checks kycStatus === 'verified' before any money-moving flow.
 *
 * Clean arch: no @prisma/client import here (application layer).
 */

import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  WebChatResponse,
  AgentTurnOutcome,
  Intent,
} from '@handshake-agent/contracts';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import {
  AGENT_PORT,
  type IAgentPort,
} from '../../agent/application/ports/agent.port';
import { AgentUnavailableError } from '../../agent/domain/agent-errors';
import {
  IDENTITY_REPOSITORY,
  type IIdentityRepository,
} from '../../identity/application/ports/identity.repository.port';
import {
  CONVERSATION_REPOSITORY,
  type IConversationRepository,
} from '../../conversations/application/ports/conversation.repository.port';
import {
  MESSAGE_REPOSITORY,
  type IMessageRepository,
} from '../../conversations/application/ports/message.repository.port';
import {
  INTENT_REPOSITORY,
  type IIntentRepository,
} from '../../conversations/application/ports/intent.repository.port';
import {
  REPLY_REPOSITORY,
  type IReplyRepository,
} from '../../conversations/application/ports/reply.repository.port';
import type { ProposalService } from '../../transactions/application/proposal.service';
import type { WalletService } from '../../wallets/application/wallet.service';
import type { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';

// ---------------------------------------------------------------------------
// DI tokens for proposal / wallet / beneficiary services.
// These are local aliases so ChatModule can bind them via `useExisting` without
// creating a cross-module coupling to the concrete service class in the constructor.
// ---------------------------------------------------------------------------
export const WEB_CHAT_PROPOSAL_SERVICE = Symbol('WEB_CHAT_PROPOSAL_SERVICE');
export const WEB_CHAT_WALLET_SERVICE = Symbol('WEB_CHAT_WALLET_SERVICE');
export const WEB_CHAT_BENEFICIARY_SERVICE = Symbol(
  'WEB_CHAT_BENEFICIARY_SERVICE',
);

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export interface HandleMessageInput {
  userId: string;
  text: string;
  beneficiaryId?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class WebChatService {
  private readonly logger = new Logger(WebChatService.name);

  constructor(
    @Inject(AGENT_PORT)
    private readonly agentPort: IAgentPort,
    @Inject(WEB_CHAT_PROPOSAL_SERVICE)
    private readonly proposalService: ProposalService,
    @Inject(WEB_CHAT_WALLET_SERVICE)
    private readonly walletService: WalletService,
    @Inject(WEB_CHAT_BENEFICIARY_SERVICE)
    private readonly beneficiaryService: BeneficiaryService,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identityRepo: IIdentityRepository,
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversationRepo: IConversationRepository,
    @Inject(MESSAGE_REPOSITORY)
    private readonly messageRepo: IMessageRepository,
    @Inject(INTENT_REPOSITORY)
    private readonly intentRepo: IIntentRepository,
    @Inject(REPLY_REPOSITORY)
    private readonly replyRepo: IReplyRepository,
    private readonly assetRegistry: AssetRegistry,
  ) {}

  async handleMessage(input: HandleMessageInput): Promise<WebChatResponse> {
    const { userId, text } = input;

    // Generate a correlation id to trace this turn through logs and DB rows.
    const correlationId = randomUUID();

    // 1. Load user — 404 if absent.
    const user = await this.identityRepo.loadUser(userId);
    if (user === null) {
      throw new NotFoundException('User not found');
    }

    // 2. Upsert conversation.
    let conversation = await this.conversationRepo.findByUserId(userId);
    if (conversation === null) {
      conversation = await this.conversationRepo.create({ userId });
    }
    await this.conversationRepo.touch(conversation.id, new Date());

    // 3. Persist inbound message.
    const message = await this.messageRepo.create({
      conversationId: conversation.id,
      externalMessageId: randomUUID(),
      channel: 'web',
      senderAddress: userId,
      text,
      rawUserText: text,
      processingStatus: 'received',
      correlationId,
    });

    // 4. Run agent — receives a validated Intent.
    const intent = await this.runAgent(text, correlationId);

    // 5. Persist intent record.
    await this.intentRepo.create({
      messageId: message.id,
      conversationId: conversation.id,
      action: intent.action,
      payload: { ...intent },
    });

    // 6. Map intent → outcome.
    // TypeScript narrows `intent` in each case branch via the discriminated
    // union on `action`, so no explicit `as TYPE` assertions are needed.
    let outcome: AgentTurnOutcome;
    let summaryText: string;

    switch (intent.action) {
      case 'none': {
        const clarification =
          intent.clarification ?? 'Could you clarify your request?';
        outcome = { kind: 'clarification', text: clarification };
        summaryText = outcome.text;
        break;
      }

      case 'receive_crypto': {
        if (user.kycStatus !== 'verified') {
          outcome = { kind: 'needs_kyc' };
          summaryText = 'KYC required';
          break;
        }
        const defaultAsset = this.assetRegistry.defaultCryptoAsset();
        const defaultNetwork =
          this.assetRegistry.defaultNetworkFor(defaultAsset);
        const assetMeta = this.assetRegistry.asset(defaultAsset);
        const networkMeta = this.assetRegistry.network(defaultNetwork);
        const wallet = await this.walletService.getOrProvisionNetworkWallet(
          userId,
          defaultNetwork,
        );
        outcome = {
          kind: 'receive',
          deposit: {
            asset: defaultAsset,
            network: defaultNetwork,
            address: wallet.address,
          },
        };
        summaryText = `Your ${assetMeta.displayName} deposit address (${networkMeta.displayName}): ${wallet.address}`;
        break;
      }

      case 'buy_crypto': {
        if (user.kycStatus !== 'verified') {
          outcome = { kind: 'needs_kyc' };
          summaryText = 'KYC required';
          break;
        }
        const { proposalId, confirmation } =
          await this.proposalService.createBuyProposal({
            userId,
            intent,
          });
        outcome = { kind: 'proposal', txType: 'buy', proposalId, confirmation };
        summaryText = 'Your buy proposal is ready. Please review and confirm.';
        break;
      }

      case 'sell_crypto': {
        if (user.kycStatus !== 'verified') {
          outcome = { kind: 'needs_kyc' };
          summaryText = 'KYC required';
          break;
        }
        const sellBeneficiary = input.beneficiaryId
          ? { id: input.beneficiaryId }
          : await this.beneficiaryService.getDefault(userId, 'bank_account');
        if (!sellBeneficiary) {
          outcome = {
            kind: 'needs_beneficiary',
            beneficiaryType: 'bank_account',
          };
          summaryText = 'Please add a bank account first.';
          break;
        }
        const { proposalId: sp, confirmation: sc } =
          await this.proposalService.createSellProposal({
            userId,
            intent,
            beneficiaryId: sellBeneficiary.id,
          });
        outcome = {
          kind: 'proposal',
          txType: 'sell',
          proposalId: sp,
          confirmation: sc,
        };
        summaryText = 'Your sell proposal is ready. Please review and confirm.';
        break;
      }

      case 'send_crypto': {
        if (user.kycStatus !== 'verified') {
          outcome = { kind: 'needs_kyc' };
          summaryText = 'KYC required';
          break;
        }
        const sendBeneficiary = input.beneficiaryId
          ? { id: input.beneficiaryId }
          : await this.beneficiaryService.getDefault(userId, 'crypto_address');
        if (!sendBeneficiary) {
          outcome = {
            kind: 'needs_beneficiary',
            beneficiaryType: 'crypto_address',
          };
          summaryText = 'Please add a crypto address first.';
          break;
        }
        const { proposalId: snp, confirmation: snc } =
          await this.proposalService.createSendProposal({
            userId,
            intent,
            beneficiaryId: sendBeneficiary.id,
          });
        outcome = {
          kind: 'proposal',
          txType: 'send',
          proposalId: snp,
          confirmation: snc,
        };
        summaryText = 'Your send proposal is ready. Please review and confirm.';
        break;
      }

      case 'check_balance':
      case 'swap':
      case 'buy_ticket': {
        outcome = { kind: 'not_supported', action: intent.action };
        summaryText = 'That feature is not yet available.';
        break;
      }

      default: {
        // Unrecognized intent action — future model may emit new intents
        // before this service is updated. Log it and fail safe (not_supported).
        // Never pass the raw model string to clients; use the sentinel 'unknown'.
        this.logger.warn(
          { action: (intent as { action: string }).action },
          'Unrecognized intent action — treating as not_supported',
        );
        outcome = { kind: 'not_supported', action: 'unknown' };
        summaryText = 'That feature is not yet available.';
        break;
      }
    }

    // 7. Persist reply.
    await this.replyRepo.create({
      conversationId: conversation.id,
      messageId: message.id,
      text: summaryText,
      correlationId,
    });

    // 8. Return response envelope.
    return {
      reply: { text: summaryText },
      outcome,
      conversationId: conversation.id,
      messageId: message.id,
    };
  }

  /**
   * Runs the agent for a turn, converting any failure into a typed
   * AgentUnavailableError. The agent/LLM call is the one flaky external
   * dependency in this flow (provider error, timeout, or Intent validation
   * failure); surfacing a typed error lets the global filter map it to a clean
   * 5xx instead of letting the raw provider error bubble out as an opaque 500
   * (I1/I2).
   */
  private async runAgent(text: string, correlationId: string): Promise<Intent> {
    try {
      return await this.agentPort.run(text);
    } catch (err: unknown) {
      this.logger.error(
        { correlationId, err },
        'Agent run failed — surfacing as AgentUnavailableError',
      );
      throw new AgentUnavailableError();
    }
  }
}
