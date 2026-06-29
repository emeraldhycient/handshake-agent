import { randomUUID } from 'node:crypto';

import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DocumentExtractionResult } from '@handshake-agent/contracts';

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
import type { HandoffTokenService } from '../../identity/application/handoff-token.service';
import type { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import type { BalanceService } from '../../balances/application/balance.service';
import type { BalanceSnapshot } from '@handshake-agent/contracts';
import { signFlowToken } from '../../whatsapp/application/flow-token';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { TransactionHistoryService } from '../../transactions/application/transaction-history.service';
import type {
  QueryTransactionsIntent,
  TransactionHistoryResponse,
} from '@handshake-agent/contracts';

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

/** DI token for HandoffTokenService — injected by symbol (K3). */
export const HANDOFF_TOKEN_SERVICE = Symbol('HANDOFF_TOKEN_SERVICE');

/** DI token for BeneficiaryService — injected by symbol to avoid coupling at module level (W1). */
export const BENEFICIARY_SERVICE = Symbol('BENEFICIARY_SERVICE');

/** DI token for TransactionHistoryService — injected by symbol (read-only history). */
export const TRANSACTION_HISTORY_SERVICE = Symbol(
  'TRANSACTION_HISTORY_SERVICE',
);
/** DI token for BalanceService — injected by symbol (read-only balance snapshot). */
export const BALANCE_SERVICE = Symbol('BALANCE_SERVICE');

const SAFE_FALLBACK = 'Sorry, something went wrong — please try again.';

/** Max history lines rendered in a WhatsApp text reply (the full set is in the PDF). */
const MAX_WA_HISTORY_LINES = 20;

// ---------------------------------------------------------------------------
// Internal resolved-identity shapes
// ---------------------------------------------------------------------------

/**
 * Discriminated union returned by `requireActiveUser`.
 * The caller checks for `'needsKyc'`, `'needsReverify'`, or `'user'`.
 * Callers with `'needsKyc'` or `'needsReverify'` call `sendKycHandoff` and short-circuit.
 * `'reply'` is kept for backward compat; populated with a generic message.
 */
type ActiveUserResult =
  | { user: { id: string } }
  | { needsKyc: true; channelAddress: string }
  | { needsReverify: true; channelAddress: string }
  | { reply: string };

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
    @Inject(HANDOFF_TOKEN_SERVICE)
    private readonly handoffTokenService: HandoffTokenService,
    @Inject(BENEFICIARY_SERVICE)
    private readonly beneficiaryService: BeneficiaryService,
    @Inject(TRANSACTION_HISTORY_SERVICE)
    private readonly historyService: TransactionHistoryService,
    @Inject(BALANCE_SERVICE)
    private readonly balanceService: BalanceService,
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

      // Image/document path: a vision-extracted candidate (never an agent run, never a money move).
      // Must come BEFORE agentPort.run so the agent never sees extraction messages (§3.1).
      if (msg.extraction) {
        const replyText = await this.handleExtractedMedia(
          msg.extraction,
          identity,
          msg,
        );
        const reply = await this.replyRepo.create({
          conversationId: conversation.id,
          messageId: message.id,
          text: replyText,
          correlationId,
        });
        await this.sender.sendText(msg.fromAddress, replyText);
        await this.replyRepo.updateStatus(reply.id, 'sent', {
          sentAt: new Date(),
        });
        await this.messageRepo.updateStatus(message.id, 'processed');
        return;
      }

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
      case 'sell_crypto': {
        const { replyText, flowSent } = await this.handleSell(
          intent,
          identity,
          conversation,
          msg,
        );
        return { replyText, flowSent };
      }
      case 'send_crypto': {
        const { replyText, flowSent } = await this.handleSendCrypto(
          intent,
          identity,
          conversation,
          msg,
        );
        return { replyText, flowSent };
      }
      case 'receive_crypto': {
        const replyText = await this.handleReceive(identity, msg.fromAddress);
        return { replyText, flowSent: false };
      }
      case 'query_transactions': {
        const { replyText, flowSent } = await this.handleTransactionHistory(
          intent as unknown as QueryTransactionsIntent,
          identity,
          msg,
        );
        return { replyText, flowSent };
      }
      case 'check_balance': {
        const replyText = await this.handleCheckBalance(
          intent,
          identity,
          msg.fromAddress,
        );
        return { replyText, flowSent: false };
      }
      case 'swap': {
        const { replyText, flowSent } = await this.handleSwap(
          intent,
          identity,
          conversation,
          msg,
        );
        return { replyText, flowSent };
      }
      case 'none': {
        return {
          replyText: intent.clarification ?? 'Could you clarify your request?',
          flowSent: false,
        };
      }
      default: {
        // buy_ticket — deferred.
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
   * Returns `{ needsKyc }` when the identity is an unlinked Contact.
   * Returns `{ needsReverify }` when the user requires re-verification.
   *
   * Callers with `needsKyc`/`needsReverify` must call `sendKycHandoff` and return its result.
   * This is the ONE place that generates KYC / re-verify replies (K3 — web handoff CTA).
   */
  private requireActiveUser(
    identity: ResolvedIdentity,
    channelAddress: string,
  ): ActiveUserResult {
    if (identity.kind !== 'user') {
      return { needsKyc: true, channelAddress };
    }
    if (identity.requiresReverification) {
      return { needsReverify: true, channelAddress };
    }
    return { user: identity.user };
  }

  /**
   * Mints a KYC handoff token and sends a CTA-URL button to the user.
   *
   * Single shared path for all needs-KYC and needs-reverify cases (K3).
   * If WEB_APP_BASE_URL is unset, falls back to a plain-text message.
   *
   * Returns the short summary text that goes into the reply row.
   */
  private async sendKycHandoff(channelAddress: string): Promise<string> {
    try {
      const { url } = await this.handoffTokenService.mintKycToken({
        channelAddress,
      });

      if (!url) {
        // WEB_APP_BASE_URL not configured → text fallback.
        return this.kycRequiredFallbackReply();
      }

      await this.sender.sendCtaUrl({
        to: channelAddress,
        body: 'To start transacting, please verify your identity. It only takes a minute.',
        buttonText: 'Verify now',
        url,
      });

      return "I've sent you a secure link to verify your identity.";
    } catch (err: unknown) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'sendKycHandoff failed — falling back to text reply',
      );
      return this.kycRequiredFallbackReply();
    }
  }

  /**
   * Text fallback for when WEB_APP_BASE_URL is unset or the handoff token service fails.
   * ONE canonical text for all routes that need a linked user (when CTA is unavailable).
   */
  private kycRequiredFallbackReply(): string {
    return (
      'To transact, you need to complete KYC first. ' +
      'Please visit our web app to verify your identity.'
    );
  }

  /**
   * Re-verification text fallback — for SIM-swap / step-up cases (CLAUDE.md §3.4).
   */
  private reverifyFallbackReply(): string {
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
    const guard = this.requireActiveUser(identity, msg.fromAddress);
    if ('needsKyc' in guard) {
      const replyText = await this.sendKycHandoff(guard.channelAddress);
      return { replyText, flowSent: false };
    }
    if ('needsReverify' in guard) {
      return { replyText: this.reverifyFallbackReply(), flowSent: false };
    }
    if ('reply' in guard) {
      return { replyText: guard.reply, flowSent: false };
    }

    // Currency liveness gate: emit a graceful reply for supported-but-not-live fiats
    // (e.g. GHS, RWF). Never build a proposal for a non-live currency (§3.1 — no fake quote).
    const buyFiatCurrency = (intent as { fiatCurrency?: string }).fiatCurrency;
    if (
      buyFiatCurrency &&
      !this.assetRegistry.isCurrencyLive(buyFiatCurrency)
    ) {
      return {
        replyText: `We settle in NGN for now — ${buyFiatCurrency} isn't available yet.`,
        flowSent: false,
      };
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
  // Private: sell_crypto handler (W1)
  // ---------------------------------------------------------------------------

  /**
   * Handles a `sell_crypto` intent:
   *   1. Guard: requires active user (KYC + reverification check).
   *   2. Resolve default bank beneficiary.
   *      - If none → send beneficiary Flow (FLOW_ID set) or text fallback, no proposal.
   *   3. Create sell proposal → send confirmation Flow (request_pin directive).
   *      - If FLOW_ID unset → text confirmation fallback.
   *
   * §3.1: model only proposes; the engine (ExecutionService.executeSell) disposes.
   * TODO(W2): chain beneficiary-select Flow into proposal in a single Flow.
   */
  private async handleSell(
    intent: RoutableIntent,
    identity: ResolvedIdentity,
    conversation: ConversationRecord,
    msg: InboundMessage,
  ): Promise<{ replyText: string; flowSent: boolean }> {
    const guard = this.requireActiveUser(identity, msg.fromAddress);
    if ('needsKyc' in guard) {
      const replyText = await this.sendKycHandoff(guard.channelAddress);
      return { replyText, flowSent: false };
    }
    if ('needsReverify' in guard) {
      return { replyText: this.reverifyFallbackReply(), flowSent: false };
    }
    if ('reply' in guard) {
      return { replyText: guard.reply, flowSent: false };
    }

    const { user } = guard;

    // Currency liveness gate: emit a graceful reply for supported-but-not-live fiats.
    // Must come BEFORE the beneficiary lookup — never reach that for a non-live currency.
    const sellFiatCurrency = (intent as { fiatCurrency?: string }).fiatCurrency;
    if (
      sellFiatCurrency &&
      !this.assetRegistry.isCurrencyLive(sellFiatCurrency)
    ) {
      return {
        replyText: `We settle in NGN for now — ${sellFiatCurrency} isn't available yet.`,
        flowSent: false,
      };
    }

    // Resolve default bank beneficiary — must exist before creating the proposal.
    const beneficiary = await this.beneficiaryService.getDefault(
      user.id,
      'bank_account',
    );

    if (beneficiary === null) {
      // No bank account saved → send the beneficiary Flow so the user can add/select one.
      // TODO(W2): full single-Flow chaining (beneficiary-select → sell proposal) in one round-trip.
      return this.sendBeneficiaryFlowOrFallback({
        userId: user.id,
        to: msg.fromAddress,
        type: 'bank_account',
        retryText:
          'Please add a bank account to sell crypto. Once added, send your sell request again.',
      });
    }

    // Happy path: create the sell proposal.
    const { proposalId, confirmation } =
      await this.proposalService.createSellProposal({
        userId: user.id,
        conversationId: conversation.id,
        intent: intent as Parameters<
          ProposalService['createSellProposal']
        >[0]['intent'],
        beneficiaryId: beneficiary.id,
      });

    return this.sendConfirmationFlow({
      proposalId,
      userId: user.id,
      to: msg.fromAddress,
      directiveRef: 'request_pin',
      screen: 'SELL_CONFIRM',
      flowData: {
        proposalId,
        asset: confirmation.asset,
        cryptoAmount: confirmation.cryptoAmount,
        netFiatAmount: confirmation.netFiatAmount,
        processingFeeAmount: confirmation.processingFeeAmount,
        fiatCurrency: confirmation.fiatCurrency,
      },
      textFallback: this.buildSellConfirmationText(confirmation),
      flowSentSummary:
        'A secure confirmation form has been sent. Please complete it to proceed with your sell.',
    });
  }

  // ---------------------------------------------------------------------------
  // Private: send_crypto handler (W1)
  // ---------------------------------------------------------------------------

  /**
   * Handles a `send_crypto` intent:
   *   1. Guard: requires active user.
   *   2. Resolve default crypto_address beneficiary.
   *      - If none → send beneficiary Flow (crypto_address) or text fallback.
   *   3. Create send proposal → send confirmation Flow (request_step_up directive).
   *      - If FLOW_ID unset → text confirmation fallback.
   *
   * §3.1: model only proposes; the engine (ExecutionService.executeSend) disposes.
   * send uses `request_step_up` (not `request_pin`) because it moves funds on-chain.
   * TODO(W2): chain beneficiary-select Flow into proposal in a single Flow.
   */
  private async handleSendCrypto(
    intent: RoutableIntent,
    identity: ResolvedIdentity,
    conversation: ConversationRecord,
    msg: InboundMessage,
  ): Promise<{ replyText: string; flowSent: boolean }> {
    const guard = this.requireActiveUser(identity, msg.fromAddress);
    if ('needsKyc' in guard) {
      const replyText = await this.sendKycHandoff(guard.channelAddress);
      return { replyText, flowSent: false };
    }
    if ('needsReverify' in guard) {
      return { replyText: this.reverifyFallbackReply(), flowSent: false };
    }
    if ('reply' in guard) {
      return { replyText: guard.reply, flowSent: false };
    }

    const { user } = guard;

    // Resolve default crypto_address beneficiary — must exist before creating the proposal.
    const beneficiary = await this.beneficiaryService.getDefault(
      user.id,
      'crypto_address',
    );

    if (beneficiary === null) {
      // No crypto address saved → send the beneficiary Flow so the user can add/select one.
      return this.sendBeneficiaryFlowOrFallback({
        userId: user.id,
        to: msg.fromAddress,
        type: 'crypto_address',
        retryText:
          'Please add a crypto wallet address first. Once added, send your send request again.',
      });
    }

    // Happy path: create the send proposal.
    const { proposalId, confirmation } =
      await this.proposalService.createSendProposal({
        userId: user.id,
        conversationId: conversation.id,
        intent: intent as Parameters<
          ProposalService['createSendProposal']
        >[0]['intent'],
        beneficiaryId: beneficiary.id,
      });

    return this.sendConfirmationFlow({
      proposalId,
      userId: user.id,
      to: msg.fromAddress,
      directiveRef: 'request_step_up',
      screen: 'SEND_CONFIRM',
      flowData: {
        proposalId,
        asset: confirmation.asset,
        cryptoAmount: confirmation.cryptoAmount,
        network: confirmation.network,
        networkFeeCrypto: confirmation.networkFeeCrypto,
        totalDebit: confirmation.totalDebit,
        toAddressMasked: confirmation.toAddressMasked,
      },
      textFallback: this.buildSendConfirmationText(confirmation),
      flowSentSummary:
        'A secure confirmation form has been sent. Please complete it to proceed with your send.',
    });
  }

  // ---------------------------------------------------------------------------
  // Private: swap handler
  // ---------------------------------------------------------------------------

  /**
   * Handles a `swap` intent:
   *   1. Capability gate: if crypto.swap is disabled → not-supported reply.
   *   2. Guard: requires active user (KYC + reverification check).
   *   3. Create swap proposal → send confirmation Flow (request_pin directive).
   *      - If FLOW_ID unset → text confirmation fallback.
   *
   * §3.1: model only proposes; the engine (ExecutionService.executeSwap) disposes.
   * The swap uses `request_pin` (same as buy/sell) — no on-chain withdrawal initiated
   * by the user (the provider swaps within its own custody).
   */
  private async handleSwap(
    intent: RoutableIntent,
    identity: ResolvedIdentity,
    conversation: ConversationRecord,
    msg: InboundMessage,
  ): Promise<{ replyText: string; flowSent: boolean }> {
    // 1. Capability gate — check before any user resolution (fail cheap).
    if (!this.assetRegistry.isCapabilityEnabled('crypto.swap')) {
      return {
        replyText: this.notSupportedReply('swap'),
        flowSent: false,
      };
    }

    // 2. Guard: requires an active, KYC-verified user.
    const guard = this.requireActiveUser(identity, msg.fromAddress);
    if ('needsKyc' in guard) {
      const replyText = await this.sendKycHandoff(guard.channelAddress);
      return { replyText, flowSent: false };
    }
    if ('needsReverify' in guard) {
      return { replyText: this.reverifyFallbackReply(), flowSent: false };
    }
    if ('reply' in guard) {
      return { replyText: guard.reply, flowSent: false };
    }

    const { user } = guard;

    // 3. Create the swap proposal (fromAsset === toAsset guard runs in the engine).
    const fromAsset = (intent as { fromAsset?: string }).fromAsset ?? '';
    const toAsset = (intent as { toAsset?: string }).toAsset ?? '';
    const amount = (intent as { amount?: string }).amount ?? '';

    const { proposalId, confirmation } =
      await this.proposalService.createSwapProposal({
        userId: user.id,
        conversationId: conversation.id,
        fromAsset,
        toAsset,
        amount,
      });

    return this.sendConfirmationFlow({
      proposalId,
      userId: user.id,
      to: msg.fromAddress,
      directiveRef: 'request_pin',
      screen: 'SWAP_CONFIRM',
      flowData: {
        proposalId,
        fromAsset: confirmation.fromAsset,
        toAsset: confirmation.toAsset,
        fromAmount: confirmation.fromAmount,
        toAmount: confirmation.toAmount,
        rate: confirmation.rate,
        networkFee: confirmation.networkFee,
        transactionFee: confirmation.transactionFee,
        estimatedArrivalSec: confirmation.estimatedArrivalSec,
      },
      textFallback: this.buildSwapConfirmationText(confirmation),
      flowSentSummary:
        'A secure confirmation form has been sent. Please complete it to proceed with your swap.',
    });
  }

  // ---------------------------------------------------------------------------
  // Private: shared confirmation Flow presenter (buy/sell/send) (W1)
  // ---------------------------------------------------------------------------

  /**
   * Shared presenter: issues a directive, signs a flow_token, sends the
   * confirmation Flow, and returns a short summary text.
   *
   * When `WHATSAPP_FLOW_ID` is absent: falls back to the caller-supplied text.
   *
   * Extracted to avoid duplication across buy/sell/send (DRY — root §13.2).
   */
  private async sendConfirmationFlow(params: {
    proposalId: string;
    userId: string;
    to: string;
    directiveRef: 'request_pin' | 'request_step_up';
    screen: string;
    /** Extra data fields for the Flow screen (proposal-type-specific). */
    flowData: Record<string, unknown>;
    /** Registry-formatted text confirmation for the no-Flow fallback. */
    textFallback: string;
    /** Short summary text returned when the Flow was sent. */
    flowSentSummary: string;
  }): Promise<{ replyText: string; flowSent: boolean }> {
    const { proposalId, userId, to, directiveRef, screen, flowData } = params;
    const flowId = this.configService.get<string>('WHATSAPP_FLOW_ID') ?? '';

    if (flowId) {
      const signingKey =
        this.configService.get<string>('DIRECTIVE_SIGNING_KEY') ?? '';

      const { directiveId, nonce, expiresAt } =
        await this.directiveService.issue({
          proposalId,
          userId,
          ref: directiveRef,
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
        screen,
        data: {
          ...flowData,
          // nonce travels only via Flow E2E encryption — never plaintext (§3.5)
          nonce,
        },
      });

      return { replyText: params.flowSentSummary, flowSent: true };
    }

    // Fallback: no Flow published yet — send itemized text confirmation.
    this.logger.warn(
      { proposalId },
      'WHATSAPP_FLOW_ID not configured — falling back to plain-text confirmation',
    );
    return { replyText: params.textFallback, flowSent: false };
  }

  // ---------------------------------------------------------------------------
  // Private: send beneficiary Flow or text fallback (W1)
  // ---------------------------------------------------------------------------

  /**
   * Sends the beneficiary add/select Flow (FLOW_ID set) or a plain-text retry
   * message when WHATSAPP_FLOW_ID is not configured.
   *
   * Returns { replyText, flowSent: true } when the Flow was dispatched,
   * { replyText, flowSent: false } for the text-fallback path.
   */
  private async sendBeneficiaryFlowOrFallback(params: {
    userId: string;
    to: string;
    type: 'bank_account' | 'crypto_address';
    retryText: string;
  }): Promise<{ replyText: string; flowSent: boolean }> {
    const { userId, to, type, retryText } = params;
    const flowId = this.configService.get<string>('WHATSAPP_FLOW_ID') ?? '';

    if (flowId) {
      const signingKey =
        this.configService.get<string>('DIRECTIVE_SIGNING_KEY') ?? '';

      // Mint a short-lived flow_token for the beneficiary flow session.
      // No directive is issued here — the beneficiary-flow endpoint validates
      // userId from the token to authorise beneficiary writes (S3).
      const exp = Math.floor(Date.now() / 1000) + 600; // 10-minute window
      const flowToken = signFlowToken(
        { proposalId: '', directiveId: '', userId, exp },
        signingKey,
      );

      await this.sender.sendBeneficiaryFlow({
        to,
        flowId,
        flowToken,
        type,
        beneficiaries: [], // S3: empty for "add new" flow; listing saved benefs is a follow-up
      });

      // flowSent: false — the beneficiary Flow is a collection form, not the
      // confirmation Flow. The retryText guidance must still reach the user via
      // sendText so they know to re-send their original request after adding.
      return { replyText: retryText, flowSent: false };
    }

    // Fallback: no Flow published yet — plain-text guidance.
    return { replyText: retryText, flowSent: false };
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
    return this.sendConfirmationFlow({
      proposalId,
      userId,
      to,
      directiveRef: 'request_pin',
      screen: 'CONFIRM',
      flowData: {
        proposalId,
        asset: confirmation.asset,
        cryptoAmount: confirmation.cryptoAmount,
        fiatAmount: confirmation.fiatAmount,
        processingFeeAmount: confirmation.processingFeeAmount,
        totalFiat: confirmation.totalFiat,
      },
      textFallback: this.buildConfirmationText(confirmation),
      flowSentSummary:
        'A secure confirmation form has been sent. Please complete it to proceed with your purchase.',
    });
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

  private async handleReceive(
    identity: ResolvedIdentity,
    channelAddress: string,
  ): Promise<string> {
    const guard = this.requireActiveUser(identity, channelAddress);
    if ('needsKyc' in guard) {
      return this.sendKycHandoff(guard.channelAddress);
    }
    if ('needsReverify' in guard) {
      return this.reverifyFallbackReply();
    }
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

    // WN-1: wallet is per-(user,network); asset for display comes from the registry
    // (defaultAsset), not the wallet record itself.
    const wallet = await this.walletService.getOrProvisionNetworkWallet(
      guard.user.id,
      defaultNetwork,
    );

    return (
      `Your ${assetMeta.displayName} deposit address (${networkMeta.displayName}):\n${wallet.address}\n\n` +
      `Only send ${assetMeta.displayName} on the ${networkMeta.displayName} to this address. Other assets or networks will be lost.`
    );
  }

  // ---------------------------------------------------------------------------
  // Private: query_transactions handler (read-only history)
  // ---------------------------------------------------------------------------

  /**
   * Handles a `query_transactions` intent: read-only history for a linked user.
   * Renders the list as text and hands off the PDF via a signed download link
   * (sendCtaUrl). No KYC/PIN gate — this moves no money (§3.1/§3.3).
   */
  private async handleTransactionHistory(
    intent: QueryTransactionsIntent,
    identity: ResolvedIdentity,
    msg: InboundMessage,
  ): Promise<{ replyText: string; flowSent: boolean }> {
    const guard = this.requireActiveUser(identity, msg.fromAddress);
    if ('needsKyc' in guard) {
      const replyText = await this.sendKycHandoff(guard.channelAddress);
      return { replyText, flowSent: false };
    }
    if ('needsReverify' in guard) {
      return { replyText: this.reverifyFallbackReply(), flowSent: false };
    }
    if ('reply' in guard) {
      return { replyText: guard.reply, flowSent: false };
    }

    const result = await this.historyService.query(guard.user.id, {
      period: intent.period,
      from: intent.from,
      to: intent.to,
      txType: intent.txType,
    });

    if (result.totalCount === 0) {
      return {
        replyText: `No transactions for ${result.window.label}.`,
        flowSent: false,
      };
    }

    // Send the list, then a CTA URL to the signed PDF. Returning flowSent:true
    // tells handleInbound NOT to re-send replyText (we've already dispatched).
    await this.sender.sendText(msg.fromAddress, this.buildHistoryText(result));
    await this.sender.sendCtaUrl({
      to: msg.fromAddress,
      body: `Download your statement (${result.window.label})`,
      buttonText: 'Download',
      url: result.downloadUrl,
    });
    return {
      replyText: `Sent your ${result.window.label} statement.`,
      flowSent: true,
    };
  }

  /** Builds a plain-text history list (date · type · ±amount · status). */
  private buildHistoryText(result: TransactionHistoryResponse): string {
    const shown = result.items.slice(0, MAX_WA_HISTORY_LINES);
    const lines = shown.map((it) => {
      const sign = it.direction === 'in' ? '+' : '-';
      const amount = it.cryptoAmount ?? it.fiatAmount ?? '';
      const day = it.createdAt.slice(0, 10);
      return `${day}  ${it.type.toUpperCase()}  ${sign}${amount}  [${it.status}]`;
    });
    const header = `Your transactions (${result.window.label}):`;
    const more =
      result.totalCount > shown.length
        ? `\n…and ${result.totalCount - shown.length} more — download the statement or narrow the date range to see more.`
        : '';
    return `${header}\n${lines.join('\n')}${more}`;
  }

  // ---------------------------------------------------------------------------
  // Private: check_balance handler (read-only — §3.1)
  // ---------------------------------------------------------------------------

  /**
   * Handles a `check_balance` intent: requires an active (KYC-verified) user, then
   * reads the balance snapshot (all assets, or one if `intent.asset` is set) and
   * renders it as a plain-text list. No proposal, no directive, no engine — reading
   * a balance never moves money (§3.1).
   */
  private async handleCheckBalance(
    intent: RoutableIntent,
    identity: ResolvedIdentity,
    channelAddress: string,
  ): Promise<string> {
    const guard = this.requireActiveUser(identity, channelAddress);
    if ('needsKyc' in guard) {
      return this.sendKycHandoff(guard.channelAddress);
    }
    if ('needsReverify' in guard) {
      return this.reverifyFallbackReply();
    }
    if ('reply' in guard) {
      return guard.reply;
    }

    // `asset` is optional on the check_balance intent; absent = all assets.
    const asset = (intent as { asset?: string }).asset;
    const snapshot = await this.balanceService.getBalances(
      guard.user.id,
      asset,
    );
    return this.buildBalanceText(snapshot);
  }

  /**
   * Renders a balance snapshot as a WhatsApp text/list reply via registry
   * formatters (no hardcoded symbols). The mid-market fiat value is shown as an
   * approximate figure; the FX spread is never surfaced (user rule).
   */
  private buildBalanceText(snapshot: BalanceSnapshot): string {
    if (snapshot.balances.length === 0) {
      return snapshot.asset
        ? `You don't hold any ${snapshot.asset} yet.`
        : "You don't have any assets yet. Send funds to your wallet to get started.";
    }

    const lines = snapshot.balances.map((b) => {
      const crypto = this.assetRegistry.formatCrypto(b.asset, b.amount);
      const fiat = b.fiatValue
        ? ` (≈ ${this.assetRegistry.formatFiat(snapshot.fiatCurrency, b.fiatValue)})`
        : '';
      return `• ${crypto}${fiat}`;
    });

    const header = snapshot.asset
      ? `Your ${snapshot.asset} balance:`
      : 'Here are your balances:';
    return `${header}\n${lines.join('\n')}`;
  }

  /**
   * Builds the itemized sell confirmation text via registry formatters.
   */
  private buildSellConfirmationText(c: {
    asset: string;
    cryptoAmount: string;
    fiatCurrency: string;
    netFiatAmount: string;
    processingFeeAmount: string;
    expiresAt: string;
    beneficiaryLabel?: string;
  }): string {
    const assetMeta = this.assetRegistry.asset(c.asset);
    const destLabel = c.beneficiaryLabel ? ` → ${c.beneficiaryLabel}` : '';
    return (
      `Here is your sell summary${destLabel}:\n` +
      `Asset: ${assetMeta.displayName}\n` +
      `You sell: ${this.assetRegistry.formatCrypto(c.asset, c.cryptoAmount)}\n` +
      `You receive: ${this.assetRegistry.formatFiat(c.fiatCurrency, c.netFiatAmount)}\n` +
      `Processing fee: ${this.assetRegistry.formatFiat(c.fiatCurrency, c.processingFeeAmount)}\n` +
      `Expires at: ${c.expiresAt}\n` +
      `Reply CONFIRM to proceed.`
    );
  }

  /**
   * Builds the itemized send confirmation text via registry formatters.
   */
  private buildSendConfirmationText(c: {
    asset: string;
    cryptoAmount: string;
    network: string;
    networkFeeCrypto: string;
    totalDebit: string;
    toAddressMasked: string;
    expiresAt: string;
    beneficiaryLabel?: string;
  }): string {
    const assetMeta = this.assetRegistry.asset(c.asset);
    const networkMeta = this.assetRegistry.network(c.network);
    const destLabel = c.beneficiaryLabel ? ` (${c.beneficiaryLabel})` : '';
    return (
      `Here is your send summary:\n` +
      `Asset: ${assetMeta.displayName}\n` +
      `Network: ${networkMeta.displayName}\n` +
      `You send: ${this.assetRegistry.formatCrypto(c.asset, c.cryptoAmount)}\n` +
      `Network fee: ${this.assetRegistry.formatCrypto(c.asset, c.networkFeeCrypto)}\n` +
      `Total debit: ${this.assetRegistry.formatCrypto(c.asset, c.totalDebit)}\n` +
      `To${destLabel}: ${c.toAddressMasked}\n` +
      `Expires at: ${c.expiresAt}\n` +
      `Reply CONFIRM to proceed.`
    );
  }

  /**
   * Builds the itemized swap confirmation text via registry formatters.
   */
  private buildSwapConfirmationText(c: {
    fromAsset: string;
    toAsset: string;
    fromAmount: string;
    toAmount: string;
    rate: string;
    networkFee: string;
    transactionFee: string;
    estimatedArrivalSec: number;
    expiresAt: string;
  }): string {
    const fromMeta = this.assetRegistry.asset(c.fromAsset);
    const toMeta = this.assetRegistry.asset(c.toAsset);
    return (
      `Here is your swap summary:\n` +
      `You swap: ${this.assetRegistry.formatCrypto(c.fromAsset, c.fromAmount)} (${fromMeta.displayName})\n` +
      `You receive: ${this.assetRegistry.formatCrypto(c.toAsset, c.toAmount)} (${toMeta.displayName})\n` +
      `Rate: 1 ${c.fromAsset} = ${c.rate} ${c.toAsset}\n` +
      `Network fee: ${this.assetRegistry.formatCrypto(c.fromAsset, c.networkFee)}\n` +
      `Transaction fee: ${this.assetRegistry.formatCrypto(c.fromAsset, c.transactionFee)}\n` +
      `Est. arrival: ${c.estimatedArrivalSec}s\n` +
      `Expires at: ${c.expiresAt}\n` +
      `Reply CONFIRM to proceed.`
    );
  }

  // ---------------------------------------------------------------------------
  // Private: extracted-media handler (Task 18)
  // ---------------------------------------------------------------------------

  /**
   * Routes a vision-extracted candidate (address / bank account / none) to the
   * appropriate persistence path.
   *
   * SACROSANCT (§3.1): this is a candidate the vision model proposes — it never
   * moves money. `addCryptoAddress` validates the address and applies a
   * cooling-off; any actual send/sell still requires the full proposal → confirm
   * → PIN path. The agent is NOT run for extraction messages.
   */
  private async handleExtractedMedia(
    extraction: DocumentExtractionResult,
    identity: ResolvedIdentity,
    msg: InboundMessage,
  ): Promise<string> {
    // Guard: all paths that persist data require a linked, verified user.
    const guard = this.requireActiveUser(identity, msg.fromAddress);
    if ('needsKyc' in guard) {
      return this.sendKycHandoff(guard.channelAddress);
    }
    if ('needsReverify' in guard) {
      return this.reverifyFallbackReply();
    }
    if ('reply' in guard) {
      return guard.reply;
    }
    const { user } = guard;

    if (extraction.kind === 'crypto_address') {
      // Network is carried by the extraction (vision model named it) or inferred
      // server-side via the registry pattern match — never hardcoded here.
      const network =
        extraction.network ??
        this.assetRegistry.inferNetworkForAddress(extraction.address);
      if (!network) {
        return 'I read an address but it does not look like a valid wallet for a network we support.';
      }
      const asset = this.assetRegistry.defaultAssetForNetwork(network);
      if (!asset) {
        return 'I read a wallet address but we do not support that network yet.';
      }
      try {
        await this.beneficiaryService.addCryptoAddress({
          userId: user.id,
          address: extraction.address,
          network,
          asset,
          label: 'From image',
        });
      } catch {
        return 'I read a wallet address but could not validate it. Please double-check and try again.';
      }
      const networkMeta = this.assetRegistry.network(network);
      const masked = this.maskAddress(extraction.address);
      return (
        `Saved this wallet (${networkMeta.displayName}, ${masked}) as a payout address. ` +
        `Say "send 10 USDT to it" to send.`
      );
    }

    if (extraction.kind === 'bank_account') {
      if (extraction.bankCode) {
        // We have enough to run name-enquiry — save the beneficiary immediately.
        try {
          const saved = await this.beneficiaryService.addBankAccount({
            userId: user.id,
            accountNumber: extraction.accountNumber,
            bankCode: extraction.bankCode,
            // The BeneficiaryService overwrites this with the bank-resolved name.
            accountName: extraction.bankName ?? '',
            label: extraction.bankName ?? 'From image',
          });
          const displayName = saved.accountHolderName ?? 'your account';
          return `Saved ${displayName} (•••${extraction.accountNumber.slice(-4)}) as a payout account.`;
        } catch {
          return (
            'I read bank details but could not verify the account. ' +
            'Please add it from the payout-account form.'
          );
        }
      }
      // No bankCode — echo the partial details so the user knows what was read,
      // but do NOT save (name-enquiry requires a bankCode).
      const bank = extraction.bankName ? ` at ${extraction.bankName}` : '';
      return (
        `I read account •••${extraction.accountNumber.slice(-4)}${bank}. ` +
        `Add it as a payout account and I'll use it.`
      );
    }

    // kind === 'none'
    return "I couldn't find a wallet address or bank details in that image.";
  }

  /**
   * Masks a crypto address for display: first 4 … last 4 characters.
   * Short addresses (≤ 10 chars) are shown as-is — defensive for unusual cases.
   */
  private maskAddress(addr: string): string {
    return addr.length <= 10 ? addr : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
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
