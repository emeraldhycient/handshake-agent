import { randomUUID } from 'node:crypto';

import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  IInboundHandler,
  InboundMessage,
} from '../../whatsapp/application/ports/inbound-handler.port';
import {
  WHATSAPP_SENDER,
  type IWhatsAppSender,
} from '../../whatsapp/application/ports/whatsapp-sender.port';
import {
  AGENT_PORT,
  type IAgentPort,
} from '../../agent/application/ports/agent.port';
import { IdentityService } from '../../identity/application/identity.service';
import type { ProposalService } from '../../transactions/application/proposal.service';
import type { DirectiveService } from '../../transactions/application/directive.service';
import type { WalletService } from '../../wallets/application/wallet.service';
import { signFlowToken } from '../../whatsapp/application/flow-token';
import { AssetRegistry } from '../../../core/catalog/asset-registry';

import {
  CONVERSATION_REPOSITORY,
  type IConversationRepository,
  type ConversationRecord,
} from './ports/conversation.repository.port';
import {
  MESSAGE_REPOSITORY,
  type IMessageRepository,
} from './ports/message.repository.port';
import {
  INTENT_REPOSITORY,
  type IIntentRepository,
} from './ports/intent.repository.port';
import {
  REPLY_REPOSITORY,
  type IReplyRepository,
} from './ports/reply.repository.port';

/** DI token for ProposalService — injected by symbol to avoid circular import at module level */
export const PROPOSAL_SERVICE = Symbol('PROPOSAL_SERVICE');

/** DI token for DirectiveService — injected by symbol to keep application layer clean */
export const DIRECTIVE_SERVICE = Symbol('DIRECTIVE_SERVICE');

/** DI token for WalletService — injected by symbol to avoid coupling at module level */
export const WALLET_SERVICE = Symbol('WALLET_SERVICE');

const SAFE_FALLBACK = 'Sorry, something went wrong — please try again.';

// ---------------------------------------------------------------------------
// Internal resolved-identity shapes
// ---------------------------------------------------------------------------

/**
 * Discriminated union returned by `requireActiveUser`.
 * The caller checks for `'reply'` key and short-circuits; otherwise gets a
 * narrowed `{ user }` with the linked user id.
 */
type ActiveUserResult = { user: { id: string } } | { reply: string };

// ---------------------------------------------------------------------------
// Intent type helpers (narrow subset used by the router)
// ---------------------------------------------------------------------------

/** Minimal shape that every routed intent must carry. */
interface RoutableIntent {
  action: string;
  clarification?: string;
}

// ---------------------------------------------------------------------------
// Identity resolution output (from IdentityService)
// ---------------------------------------------------------------------------

type ResolvedIdentity = Awaited<
  ReturnType<IdentityService['resolveByChannel']>
>;

@Injectable()
export class ConversationService implements IInboundHandler {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly identityService: IdentityService,
    @Inject(AGENT_PORT) private readonly agentPort: IAgentPort,
    @Inject(PROPOSAL_SERVICE) private readonly proposalService: ProposalService,
    @Inject(WHATSAPP_SENDER) private readonly sender: IWhatsAppSender,
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversationRepo: IConversationRepository,
    @Inject(MESSAGE_REPOSITORY)
    private readonly messageRepo: IMessageRepository,
    @Inject(INTENT_REPOSITORY) private readonly intentRepo: IIntentRepository,
    @Inject(REPLY_REPOSITORY) private readonly replyRepo: IReplyRepository,
    private readonly configService: ConfigService,
    @Inject(DIRECTIVE_SERVICE)
    private readonly directiveService: DirectiveService,
    @Inject(WALLET_SERVICE)
    private readonly walletService: WalletService,
    private readonly assetRegistry: AssetRegistry,
  ) {}

  async handleInbound(msg: InboundMessage): Promise<void> {
    const correlationId = randomUUID();
    // Tracked outside try so the catch block can mark the message failed.
    let messageId: string | null = null;

    try {
      // Step 1: Dedup — if we have already processed this external message id, no-op.
      const existing = await this.messageRepo.findByExternalId(
        msg.externalMessageId,
      );
      if (existing !== null) {
        return;
      }

      // Step 2: Resolve identity — linked User or unlinked Contact.
      const identity = await this.identityService.resolveByChannel({
        channel: msg.channel,
        channelAddress: msg.fromAddress,
        normalizedPhone: msg.fromAddress,
      });

      // Step 3: Upsert conversation (one per identity, keyed by userId XOR contactId).
      const conversation = await this.upsertConversation(identity);

      // Step 4: Persist inbound message (dedup anchor for subsequent retries).
      const message = await this.messageRepo.create({
        conversationId: conversation.id,
        externalMessageId: msg.externalMessageId,
        channel: msg.channel,
        senderAddress: msg.fromAddress,
        text: msg.text,
        rawUserText: msg.text,
        processingStatus: 'received',
        correlationId,
      });
      messageId = message.id;

      // Step 5: Run the NLU agent — emits a validated structured intent, never moves money.
      const intent = await this.agentPort.run(msg.text);

      // Persist the intent for audit trail.
      await this.intentRepo.create({
        messageId: message.id,
        conversationId: conversation.id,
        action: intent.action,
        payload: intent,
      });

      // Step 6: Route on intent action via switch dispatch.
      const { replyText, flowSent } = await this.routeIntent(
        intent,
        identity,
        conversation,
        msg,
      );

      // Step 7: Persist the reply and dispatch it (unless the Flow was already dispatched).
      const reply = await this.replyRepo.create({
        conversationId: conversation.id,
        messageId: message.id,
        text: replyText,
        correlationId,
      });

      if (!flowSent) {
        // Text path: dispatch via sendText.
        await this.sender.sendText(msg.fromAddress, replyText);
      }

      // Mark statuses: reply sent, message processed.
      await this.replyRepo.updateStatus(reply.id, 'sent', {
        sentAt: new Date(),
      });
      await this.messageRepo.updateStatus(message.id, 'processed');
    } catch (err) {
      // Step 8: Failure handling — never throw out of handleInbound (webhook has already 200-acked).
      // If the message row was persisted, mark it failed.
      if (messageId !== null) {
        try {
          await this.messageRepo.updateStatus(
            messageId,
            'failed',
            err instanceof Error ? err.message : String(err),
          );
        } catch {
          // Swallow — best-effort status update; do not mask the original error.
        }
      }

      // Log the error so it is captured by pino — the catch block must never throw.
      // Cast err through unknown→Error|string for structured logging; pino serialises it.
      const logErr = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        {
          err: logErr,
          correlationId,
          externalMessageId: msg.externalMessageId,
          messageId,
        },
        'handleInbound failed — sending safe fallback',
      );

      // Best-effort: send a safe fallback reply so the user is not left hanging.
      try {
        await this.sender.sendText(msg.fromAddress, SAFE_FALLBACK);
      } catch {
        // Swallow — webhook has already 200-acked; we cannot propagate errors here.
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: conversation upsert
  // ---------------------------------------------------------------------------

  private async upsertConversation(
    identity: ResolvedIdentity,
  ): Promise<ConversationRecord> {
    let conversation =
      identity.kind === 'user'
        ? await this.conversationRepo.findByUserId(identity.user.id)
        : await this.conversationRepo.findByContactId(identity.contact.id);

    if (conversation === null) {
      conversation =
        identity.kind === 'user'
          ? await this.conversationRepo.create({ userId: identity.user.id })
          : await this.conversationRepo.create({
              contactId: identity.contact.id,
            });
    }

    await this.conversationRepo.touch(conversation.id, new Date());
    return conversation;
  }

  // ---------------------------------------------------------------------------
  // Private: intent router
  // ---------------------------------------------------------------------------

  /**
   * Dispatches a validated intent to the appropriate handler. Returns the reply
   * text and whether a WhatsApp Flow was already dispatched (so the caller knows
   * whether to also call sendText).
   */
  private async routeIntent(
    intent: RoutableIntent,
    identity: ResolvedIdentity,
    conversation: ConversationRecord,
    msg: InboundMessage,
  ): Promise<{ replyText: string; flowSent: boolean }> {
    switch (intent.action) {
      case 'buy_crypto': {
        const { replyText, flowSent } = await this.handleBuy(
          intent,
          identity,
          conversation,
          msg,
        );
        return { replyText, flowSent };
      }
      case 'receive_crypto': {
        const replyText = await this.handleReceive(identity);
        return { replyText, flowSent: false };
      }
      case 'none': {
        return {
          replyText: intent.clarification ?? 'Could you clarify your request?',
          flowSent: false,
        };
      }
      default: {
        // sell_crypto / send_crypto / swap / buy_ticket / check_balance — deferred.
        return {
          replyText: this.notSupportedReply(intent.action),
          flowSent: false,
        };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: shared active-user guard
  // ---------------------------------------------------------------------------

  /**
   * Single shared guard for all intent handlers that require a linked, verified user.
   *
   * Returns `{ user }` when the identity is an active linked user ready to transact.
   * Returns `{ reply }` when the identity is unlinked (KYC required) or requires
   * re-verification — callers must short-circuit and return the reply immediately.
   *
   * NOTE: This is the one place that generates KYC / re-verify replies (Task K3
   * will replace these text strings with a web-handoff CTA; that change lives here only).
   */
  private requireActiveUser(identity: ResolvedIdentity): ActiveUserResult {
    if (identity.kind !== 'user') {
      return { reply: this.kycRequiredReply() };
    }
    if (identity.requiresReverification) {
      return { reply: this.reverifyReply() };
    }
    return { user: identity.user };
  }

  /**
   * KYC-required reply — ONE canonical text for all routes that need a linked user.
   * Task K3 will replace this with a web-handoff CTA button; the one-place rule
   * ensures that change lands in a single method.
   */
  private kycRequiredReply(): string {
    return (
      'To transact, you need to complete KYC first. ' +
      'Please visit our web app to verify your identity.'
    );
  }

  /**
   * Re-verification required reply — ONE canonical text for SIM-swap / step-up cases
   * (CLAUDE.md §3.4). Same one-place rule as kycRequiredReply.
   */
  private reverifyReply(): string {
    return (
      'Your account requires re-verification before you can transact. ' +
      'Please visit our web app to re-verify.'
    );
  }

  // ---------------------------------------------------------------------------
  // Private: buy_crypto handler
  // ---------------------------------------------------------------------------

  private async handleBuy(
    intent: RoutableIntent,
    identity: ResolvedIdentity,
    conversation: ConversationRecord,
    msg: InboundMessage,
  ): Promise<{ replyText: string; flowSent: boolean }> {
    const guard = this.requireActiveUser(identity);
    if ('reply' in guard) {
      return { replyText: guard.reply, flowSent: false };
    }

    // Happy path: create a buy proposal (deterministic engine; model proposes, engine disposes — §3.1).
    const { proposalId, confirmation } =
      await this.proposalService.createBuyProposal({
        userId: guard.user.id,
        conversationId: conversation.id,
        // The intent object is passed through; ProposalService validates it (§3.3).
        intent: intent as Parameters<
          ProposalService['createBuyProposal']
        >[0]['intent'],
      });

    return this.sendBuyConfirmation({
      proposalId,
      confirmation,
      userId: guard.user.id,
      to: msg.fromAddress,
    });
  }

  // ---------------------------------------------------------------------------
  // Private: buy-confirmation presenter
  // ---------------------------------------------------------------------------

  /**
   * Extracted presenter for the buy-confirmation step.
   *
   * When `WHATSAPP_FLOW_ID` is set: issues a directive, signs a flow_token,
   * dispatches the E2E confirmation Flow, and returns a short summary text.
   *
   * When `WHATSAPP_FLOW_ID` is absent: builds and returns a registry-formatted
   * itemized text confirmation as the fallback (operators enable the Flow by
   * setting this env after publishing in Meta).
   */
  private async sendBuyConfirmation(params: {
    proposalId: string;
    confirmation: {
      asset: string;
      cryptoAmount: string;
      fiatAmount: string;
      fiatCurrency: string;
      processingFeeAmount: string;
      totalFiat: string;
      expiresAt: string;
    };
    userId: string;
    to: string;
  }): Promise<{ replyText: string; flowSent: boolean }> {
    const { proposalId, confirmation, userId, to } = params;
    const flowId = this.configService.get<string>('WHATSAPP_FLOW_ID') ?? '';

    if (flowId) {
      // Flow path: mint a directive, sign a flow_token, send the E2E confirmation Flow.
      // The nonce travels ONLY via the Flow E2E channel — never in plaintext chat (§3.5).
      const signingKey =
        this.configService.get<string>('DIRECTIVE_SIGNING_KEY') ?? '';

      const { directiveId, nonce, expiresAt } =
        await this.directiveService.issue({
          proposalId,
          userId,
          ref: 'request_pin',
        });

      const flowToken = signFlowToken(
        {
          proposalId,
          directiveId,
          userId,
          exp: Math.floor(expiresAt.getTime() / 1000),
        },
        signingKey,
      );

      await this.sender.sendFlow({
        to,
        flowId,
        flowToken,
        cta: 'Confirm',
        screen: 'CONFIRM',
        data: {
          proposalId,
          asset: confirmation.asset,
          cryptoAmount: confirmation.cryptoAmount,
          fiatAmount: confirmation.fiatAmount,
          processingFeeAmount: confirmation.processingFeeAmount,
          totalFiat: confirmation.totalFiat,
          // nonce travels only via Flow E2E encryption — never plaintext (§3.5)
          nonce,
        },
      });

      // Short summary for the reply row — the Flow is the real interaction surface.
      return {
        replyText:
          'A secure confirmation form has been sent. Please complete it to proceed with your purchase.',
        flowSent: true,
      };
    }

    // Fallback: no Flow published yet — send itemized text confirmation.
    // Operators enable the Flow by setting WHATSAPP_FLOW_ID after publishing in Meta.
    this.logger.warn(
      { proposalId },
      'WHATSAPP_FLOW_ID not configured — falling back to plain-text confirmation',
    );
    return {
      replyText: this.buildConfirmationText(confirmation),
      flowSent: false,
    };
  }

  /**
   * Builds the itemized text confirmation via registry formatters.
   * No hardcoded '₦', 'USDT', 'TRON', or manual number formatting — all go
   * through `AssetRegistry.formatFiat` / `AssetRegistry.formatCrypto` / metadata.
   */
  private buildConfirmationText(c: {
    asset: string;
    cryptoAmount: string;
    fiatAmount: string;
    fiatCurrency: string;
    processingFeeAmount: string;
    totalFiat: string;
    expiresAt: string;
  }): string {
    const assetMeta = this.assetRegistry.asset(c.asset);
    return (
      `Here is your buy summary:\n` +
      `Asset: ${assetMeta.displayName}\n` +
      `You receive: ${this.assetRegistry.formatCrypto(c.asset, c.cryptoAmount)}\n` +
      `Amount: ${this.assetRegistry.formatFiat(c.fiatCurrency, c.fiatAmount)}\n` +
      `Processing fee: ${this.assetRegistry.formatFiat(c.fiatCurrency, c.processingFeeAmount)}\n` +
      `Total: ${this.assetRegistry.formatFiat(c.fiatCurrency, c.totalFiat)}\n` +
      `Expires at: ${c.expiresAt}\n` +
      `Reply CONFIRM to proceed.`
    );
  }

  // ---------------------------------------------------------------------------
  // Private: receive_crypto handler
  // ---------------------------------------------------------------------------

  private async handleReceive(identity: ResolvedIdentity): Promise<string> {
    const guard = this.requireActiveUser(identity);
    if ('reply' in guard) {
      return guard.reply;
    }

    // Happy path: read-only — provision the default crypto wallet if needed and
    // return the address. No proposal, no directive, no execution engine — receiving
    // is purely informational (§3.1).
    // Asset and network are derived from the registry — no hardcoded literals (task X3).
    const defaultAsset = this.assetRegistry.defaultCryptoAsset();
    const defaultNetwork = this.assetRegistry.defaultNetworkFor(defaultAsset);
    const assetMeta = this.assetRegistry.asset(defaultAsset);
    const networkMeta = this.assetRegistry.network(defaultNetwork);

    const wallet = await this.walletService.getOrProvisionWallet(
      guard.user.id,
      defaultAsset,
      defaultNetwork,
    );

    return (
      `Your ${assetMeta.displayName} deposit address (${networkMeta.displayName}):\n${wallet.address}\n\n` +
      `Only send ${assetMeta.displayName} on the ${networkMeta.displayName} to this address. Other assets or networks will be lost.`
    );
  }

  // ---------------------------------------------------------------------------
  // Private: unsupported-action reply
  // ---------------------------------------------------------------------------

  private notSupportedReply(action: string): string {
    // The supported set grows via config (§7); this fallback covers deferred actions.
    // `action` is logged in the future; for now build a generic reply from registry.
    void action; // acknowledged — surface it in a future logging enhancement
    const defaultAsset = this.assetRegistry.asset('USDT').displayName;
    const defaultFiat = this.assetRegistry.fiat('NGN').displayName;
    return `That's not supported yet — you can buy ${defaultAsset} with ${defaultFiat}.`;
  }
}
