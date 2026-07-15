/**
 * WebChatService — application-layer orchestrator for the web chat endpoint.
 *
 * Invariants (CLAUDE.md §3):
 *   - §3.1 model proposes, engine disposes: this service interprets intent and
 *     delegates to ProposalService for proposal creation, never executing transactions.
 *   - §3.2 no DB access here: all persistence goes through injected repository ports.
 *   - §3.3 KYC gate: checks capability → minimum-KYC-tier (buy/receive at
 *     tier_1, sell/send/swap at tier_2 — `meetsCapability`), mirroring the
 *     engine's authoritative `KycGateService.assertBaselineEligibility`. This is
 *     a chat-entry UX pre-check only; the engine re-checks server-side before
 *     any money moves.
 *
 * Clean arch: no @prisma/client import here (application layer).
 */

import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ZodError } from 'zod';
import { AgentTurnOutcomeSchema } from '@handshake-agent/contracts';
import type {
  WebChatResponse,
  AgentTurnOutcome,
  Intent,
  ChatHistoryResponse,
  BalanceSnapshot,
  EffectiveRate,
  KycTier,
  SendDestinationInput,
} from '@handshake-agent/contracts';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { GatingConfig } from '../../../core/config/configuration';
import {
  AGENT_PORT,
  type IAgentPort,
  type ConversationTurn,
} from '../../agent/application/ports/agent.port';
import { AgentUnavailableError } from '../../agent/domain/agent-errors';
import {
  BeneficiaryCoolingOffError,
  BeneficiaryWrongTypeError,
} from '../../beneficiaries/domain/beneficiary-errors';
import { SanctionsBlockedError } from '../../compliance/domain/compliance-errors';
import {
  IDENTITY_REPOSITORY,
  type IIdentityRepository,
  type UserRecord,
} from '../../identity/application/ports/identity.repository.port';
import { HandleService } from '../../identity/application/handle.service';
import type { Capability } from '../../identity/application/kyc-gate.service';
import {
  meetsCapabilityMinTier,
  tierAtLeast,
} from '../../identity/domain/tier-order';
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
import type {
  ProposalService,
  SendDestination,
} from '../../transactions/application/proposal.service';
import type { WalletService } from '../../wallets/application/wallet.service';
import type { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import type { BeneficiaryRecord } from '../../beneficiaries/application/ports/beneficiary.repository.port';
import { maskBeneficiaryDetail } from '../../beneficiaries/application/beneficiary-display';
import type { TransactionHistoryService } from '../../transactions/application/transaction-history.service';
import { StatementTokenService } from '../../transactions/application/statement-token.service';
import type { BalanceService } from '../../balances/application/balance.service';
import type { RatesService } from '../../quotes/application/rates.service';
import {
  InsufficientBalanceError,
  SwapSameAssetError,
  SwapUnavailableError,
} from '../../transactions/domain/execution-errors';
import {
  AmountTooSmallError,
  SelfSendError,
} from '../../transactions/domain/amount-guard-errors';
import { InvalidSendAddressError } from '../../transactions/domain/invalid-send-address.error';

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
export const WEB_CHAT_HISTORY_SERVICE = Symbol('WEB_CHAT_HISTORY_SERVICE');
export const WEB_CHAT_BALANCE_SERVICE = Symbol('WEB_CHAT_BALANCE_SERVICE');
export const WEB_CHAT_RATES_SERVICE = Symbol('WEB_CHAT_RATES_SERVICE');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Number of most-recent persisted turns loaded as short-term memory and threaded
 * into the agent on each call. Kept small so the prompt stays bounded; history is
 * a refinement aid (resolving "50k" → the asset the agent just asked about), not
 * a transcript. The agent itself holds no DB checkpointer (CLAUDE.md §6).
 */
const HISTORY_TURN_LIMIT = 6;

/**
 * Shown when the model returns output that fails IntentSchema validation (a
 * ZodError) — the model is up but produced something unroutable. This is a
 * clarification, never a 503 (a true provider outage stays AgentUnavailableError).
 */
const UNPARSEABLE_INTENT_CLARIFICATION =
  "Sorry, I didn't quite catch that. Could you rephrase your request?";

/**
 * Minimum length for a message token to be worth classifying as an on-chain
 * address in `parseAddressFromText`. A conservative floor: every supported
 * network's address is far longer (TRON ~34, EVM 42), while send-command words
 * ("send", "USDT", "to", a nickname) are short — so this cheaply skips obvious
 * non-addresses before the registry runs its regexes, and never skips a real
 * address. Correctness still rests on `AssetRegistry.inferNetworkForAddress`;
 * this is only a short-circuit.
 */
const MIN_ADDRESS_TOKEN_LENGTH = 12;

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export interface HandleMessageInput {
  userId: string;
  text: string;
  beneficiaryId?: string;
  /**
   * A USER-SUPPLIED raw on-chain destination captured in the send-to-address
   * card / Flow (§3.1 — never model output). Mutually exclusive with
   * `beneficiaryId` (enforced by `ChatMessageRequestSchema`). The engine
   * re-validates the address + network before any money moves.
   */
  sendDestination?: SendDestinationInput;
}

export interface GetHistoryInput {
  userId: string;
  /** Message-id cursor: return only turns strictly older than this id. */
  before?: string;
  /** Page size (validated/defaulted at the presentation boundary). */
  limit: number;
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
    @Inject(WEB_CHAT_HISTORY_SERVICE)
    private readonly historyService: TransactionHistoryService,
    @Inject(WEB_CHAT_BALANCE_SERVICE)
    private readonly balanceService: BalanceService,
    @Inject(WEB_CHAT_RATES_SERVICE)
    private readonly ratesService: RatesService,
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
    private readonly statementTokens: StatementTokenService,
    private readonly config: EffectiveConfigService,
    private readonly handleService: HandleService,
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

    // 3. Load short-term memory BEFORE persisting the current turn, so the new
    //    inbound message is not folded into its own history. Built server-side
    //    from the message repo — authoritative, never trusting client input (§3.2).
    const history = await this.loadHistory(conversation.id);

    // 4. Persist inbound message.
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

    // 5. Run agent — receives a validated Intent (with prior-turn context).
    const intent = await this.runAgent(text, correlationId, history);

    // 6. Persist intent record.
    await this.intentRepo.create({
      messageId: message.id,
      conversationId: conversation.id,
      action: intent.action,
      payload: { ...intent },
    });

    // 7. Map intent → outcome.
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
        if (!this.meetsCapability(user, 'crypto.receive')) {
          outcome = { kind: 'needs_kyc' };
          summaryText = 'KYC required';
          break;
        }
        // Use the asset named in the intent; fall back to registry default when
        // the model did not specify one. On TRON, USDT and TRX share one address —
        // we always provision the same network wallet; only the label changes.
        const requestedAsset =
          intent.asset ?? this.assetRegistry.defaultCryptoAsset();
        const receiveNetwork =
          this.assetRegistry.defaultNetworkFor(requestedAsset);
        const assetMeta = this.assetRegistry.asset(requestedAsset);
        const networkMeta = this.assetRegistry.network(receiveNetwork);
        const wallet = await this.walletService.getOrProvisionNetworkWallet(
          userId,
          receiveNetwork,
        );
        outcome = {
          kind: 'receive',
          deposit: {
            asset: requestedAsset,
            network: receiveNetwork,
            address: wallet.address,
          },
        };
        summaryText = `Your ${assetMeta.displayName} deposit address (${networkMeta.displayName}): ${wallet.address}`;
        break;
      }

      case 'buy_crypto': {
        if (!this.meetsCapability(user, 'crypto.buy')) {
          outcome = { kind: 'needs_kyc' };
          summaryText = 'KYC required';
          break;
        }
        // Single resolution point (multi-currency ergonomics, CLAUDE.md §7):
        // default to the catalog base fiat when the model omitted it, then
        // thread the SAME resolved value into both this handler's own gating
        // and the engine call below — mirroring the get_rate handling.
        const buyFiatCurrency =
          intent.fiatCurrency ?? this.assetRegistry.defaultFiat();
        if (!this.assetRegistry.isCurrencyLive(buyFiatCurrency)) {
          outcome = {
            kind: 'currency_not_live',
            currency: buyFiatCurrency,
            // Catalog-driven live set so the client copy names what CAN settle
            // today instead of hardcoding a launch currency.
            liveCurrencies: this.assetRegistry.enabledFiats(),
          };
          summaryText = `${buyFiatCurrency} isn't available for settlement yet.`;
          break;
        }
        const { proposalId, confirmation } =
          await this.proposalService.createBuyProposal({
            userId,
            intent: { ...intent, fiatCurrency: buyFiatCurrency },
          });
        outcome = { kind: 'proposal', txType: 'buy', proposalId, confirmation };
        summaryText = 'Your buy proposal is ready. Please review and confirm.';
        break;
      }

      case 'sell_crypto': {
        if (!this.meetsCapability(user, 'crypto.sell')) {
          outcome = { kind: 'needs_kyc' };
          summaryText = 'KYC required';
          break;
        }
        // Single resolution point (multi-currency ergonomics, CLAUDE.md §7) —
        // see the matching comment in the buy_crypto branch.
        const sellFiatCurrency =
          intent.fiatCurrency ?? this.assetRegistry.defaultFiat();
        if (!this.assetRegistry.isCurrencyLive(sellFiatCurrency)) {
          outcome = {
            kind: 'currency_not_live',
            currency: sellFiatCurrency,
            liveCurrencies: this.assetRegistry.enabledFiats(),
          };
          summaryText = `${sellFiatCurrency} isn't available for settlement yet.`;
          break;
        }
        const sellResolution = await this.resolvePayoutBeneficiary(
          userId,
          'bank_account',
          input.beneficiaryId,
          intent.recipientNickname,
          // Filter to banks that pay out in the sell currency so a non-NGN sell
          // prompts to add a matching-currency bank instead of dead-ending.
          sellFiatCurrency,
        );
        if (!sellResolution.resolved) {
          outcome = sellResolution.outcome;
          summaryText = sellResolution.summaryText;
          break;
        }
        try {
          const { proposalId: sp, confirmation: sc } =
            await this.proposalService.createSellProposal({
              userId,
              intent: { ...intent, fiatCurrency: sellFiatCurrency },
              beneficiaryId: sellResolution.beneficiaryId,
            });
          outcome = {
            kind: 'proposal',
            txType: 'sell',
            proposalId: sp,
            confirmation: sc,
          };
          summaryText =
            'Your sell proposal is ready. Please review and confirm.';
        } catch (sellErr) {
          // Proposal-builder rejections with a stable code are ordinary
          // correctable conditions (insufficient balance, dust amount, sanctions
          // hit). Surface them inline as a clarification — never let them bubble
          // to a 4xx/5xx that drops the chat thread (parity with the swap branch).
          const clarification = this.proposalErrorClarification(sellErr);
          if (clarification === null) throw sellErr;
          outcome = { kind: 'clarification', text: clarification };
          summaryText = clarification;
        }
        break;
      }

      case 'send_crypto': {
        if (!this.meetsCapability(user, 'crypto.send')) {
          outcome = { kind: 'needs_kyc' };
          summaryText = 'KYC required';
          break;
        }
        // Network-consistency guard (§3.1): the engine validates, screens, and
        // settles the send on `intent.network` authoritatively. A client-supplied
        // `sendDestination.network` MUST NOT diverge from it — sending on a
        // network other than the one that was validated is a misroute hazard.
        // For Spec 1 (USDT/TRON) the two coincide; fail closed to a clarification
        // on any mismatch rather than silently proceed. Compared case-insensitively
        // so schema-canonical casing drift never yields a false positive.
        if (
          input.sendDestination &&
          input.sendDestination.network.toUpperCase() !==
            intent.network.toUpperCase()
        ) {
          const networkMismatchText =
            "That address is for a different network than the one I'd send on. Please double-check the network and try again.";
          outcome = { kind: 'clarification', text: networkMismatchText };
          summaryText = networkMismatchText;
          break;
        }
        const sendResolution = await this.resolveSendDestination(
          userId,
          {
            beneficiaryId: input.beneficiaryId,
            sendDestination: input.sendDestination,
          },
          intent.recipientNickname,
          input.text,
        );
        if (!sendResolution.resolved) {
          outcome = sendResolution.outcome;
          summaryText = sendResolution.summaryText;
          break;
        }
        try {
          const { proposalId: snp, confirmation: snc } =
            await this.proposalService.createSendProposal({
              userId,
              intent,
              destination: sendResolution.destination,
            });
          outcome = {
            kind: 'proposal',
            txType: 'send',
            proposalId: snp,
            confirmation: snc,
          };
          summaryText =
            'Your send proposal is ready. Please review and confirm.';
        } catch (sendErr) {
          // Same parity as sell: convert the stable-coded proposal rejections
          // (insufficient balance, cooling-off, wrong beneficiary type, sanctions,
          // dust amount, self-send, invalid raw address) into a first-class
          // clarification rather than an opaque 4xx/5xx that drops the thread.
          const clarification = this.proposalErrorClarification(sendErr);
          if (clarification === null) throw sendErr;
          outcome = { kind: 'clarification', text: clarification };
          summaryText = clarification;
        }
        break;
      }

      case 'query_transactions': {
        const result = await this.historyService.query(userId, {
          period: intent.period,
          from: intent.from,
          to: intent.to,
          relativeAmount: intent.relativeAmount,
          relativeUnit: intent.relativeUnit,
          txType: intent.txType,
        });
        outcome = { kind: 'transactions', ...result };
        summaryText =
          result.totalCount > 0
            ? `Found ${result.totalCount} transaction(s) for ${result.window.label}.`
            : `No transactions for ${result.window.label}.`;
        break;
      }

      case 'check_balance': {
        // Read-only (§3.1): no proposal, no engine. Gated at tier_1 like the
        // other tier_1 surfaces — an unverified user has no provisioned wallets
        // to read. `check_balance` is not a transactable capability (no
        // `Capability` entry / `gating.capabilityMinTier` key), so it is gated
        // directly against `tierAtLeast` rather than `meetsCapability`.
        if (!tierAtLeast(user.kycTier as KycTier, 'tier_1')) {
          outcome = { kind: 'needs_kyc' };
          summaryText = 'KYC required';
          break;
        }
        const snapshot = await this.balanceService.getBalances(
          userId,
          intent.asset,
        );
        outcome = { kind: 'balance', ...snapshot };
        summaryText = this.buildBalanceSummary(snapshot);
        break;
      }

      case 'get_rate': {
        // Read-only rate discovery (§3.1): no proposal, no engine, no KYC gate —
        // a market rate is public information, not user-scoped data. The folded
        // buy+sell figure is what the engine transacts at (shared pricing seam).
        // Rendered as an assistant text reply (the `clarification` outcome is the
        // general text channel; no new outcome card kind is introduced).
        const fiatCurrency =
          intent.fiatCurrency ?? this.assetRegistry.defaultFiat();
        const rateText = await this.buildRateReply(intent.asset, fiatCurrency);
        outcome = { kind: 'clarification', text: rateText };
        summaryText = rateText;
        break;
      }

      case 'list_rates': {
        // Read-only: every enabled, tradeable, priced pair as a text list.
        const listText = await this.buildRatesListReply();
        outcome = { kind: 'clarification', text: listText };
        summaryText = listText;
        break;
      }

      case 'swap': {
        if (!this.assetRegistry.isCapabilityEnabled('crypto.swap')) {
          outcome = { kind: 'not_supported', action: 'swap' };
          summaryText = 'That feature is not yet available.';
          break;
        }
        if (!this.meetsCapability(user, 'crypto.swap')) {
          outcome = { kind: 'needs_kyc' };
          summaryText = 'KYC required';
          break;
        }
        try {
          const { proposalId: swapPid, confirmation: swapConf } =
            await this.proposalService.createSwapProposal({
              userId,
              fromAsset: intent.fromAsset,
              toAsset: intent.toAsset,
              amount: intent.amount,
            });
          outcome = {
            kind: 'proposal',
            txType: 'swap',
            proposalId: swapPid,
            confirmation: swapConf,
          };
          summaryText =
            'Your swap proposal is ready. Please review and confirm.';
        } catch (swapErr) {
          if (swapErr instanceof SwapUnavailableError) {
            // Blockradar returned 404: swap not active on this account/testnet.
            // Surface gracefully — do not 500.
            this.logger.warn(
              { err: swapErr.message },
              'Swap unavailable from provider — surfacing not_supported to user',
            );
            outcome = { kind: 'not_supported', action: 'swap' };
            summaryText =
              "Swap isn't available right now. Please try again later or contact support.";
          } else if (swapErr instanceof SwapSameAssetError) {
            // Ordinary user-input mistake (e.g. the model emits "swap USDT for
            // USDT") — surface inline as a clarification, never an opaque 500.
            const sameAssetText = 'Choose two different assets to swap.';
            outcome = { kind: 'clarification', text: sameAssetText };
            summaryText = sameAssetText;
          } else if (swapErr instanceof InsufficientBalanceError) {
            outcome = {
              kind: 'clarification',
              text: swapErr.message,
            };
            summaryText = swapErr.message;
          } else {
            throw swapErr;
          }
        }
        break;
      }

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

    // 8. Persist reply — including the rendered outcome so the web thread can be
    //    reconstructed on reload (GET /chat/messages) without re-running the agent.
    await this.replyRepo.create({
      conversationId: conversation.id,
      messageId: message.id,
      text: summaryText,
      correlationId,
      outcome,
    });

    // 9. Return response envelope.
    return {
      reply: { text: summaryText },
      outcome,
      conversationId: conversation.id,
      messageId: message.id,
    };
  }

  /**
   * Runs the agent for a turn, classifying its two failure modes:
   *
   *   - A ZodError from IntentSchema.parse means the model is UP but returned
   *     output we cannot route (missing/invalid action). That is an ordinary
   *     "rephrase, please" — surfaced as a `none` Intent so the normal
   *     clarification branch renders it. NEVER a 503.
   *   - Any other failure (network/timeout/auth/5xx) is a genuine provider
   *     outage → typed AgentUnavailableError so the global filter maps it to a
   *     clean 5xx instead of leaking the raw provider error as an opaque 500
   *     (I1/I2).
   *
   * `history` is short-term memory built server-side and threaded in so a
   * follow-up ("50k") resolves against the question the agent just asked.
   */
  private async runAgent(
    text: string,
    correlationId: string,
    history: ConversationTurn[],
  ): Promise<Intent> {
    try {
      return await this.agentPort.run(text, history);
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        this.logger.warn(
          { correlationId },
          'Agent returned unparseable intent — asking the user to rephrase',
        );
        return {
          action: 'none',
          clarification: UNPARSEABLE_INTENT_CLARIFICATION,
        };
      }
      this.logger.error(
        { correlationId, err },
        'Agent run failed — surfacing as AgentUnavailableError',
      );
      throw new AgentUnavailableError();
    }
  }

  /**
   * True when `user.kycTier` meets the minimum tier configured for
   * `capability` in `gating.capabilityMinTier` (root CLAUDE.md §7 / Task 1.2).
   *
   * This is a chat-entry UX pre-check ONLY — it exists so a tier_1
   * (email-verified) user's buy/receive request produces a proposal instead of
   * a false `needs_kyc`, matching the engine's authoritative gate
   * (`KycGateService.assertBaselineEligibility`,
   * `api/src/modules/identity/application/kyc-gate.service.ts`). It does not
   * replace that gate: `ProposalService`/`ExecutionService` re-check
   * capability→tier, velocity, and sanctions server-side before any money
   * moves (§3.1/§3.3). Reuses `meetsCapabilityMinTier` (identity domain) so the
   * capability→tier mapping is never duplicated — both this pre-check and the
   * engine read the SAME `gating.capabilityMinTier` config map.
   */
  private meetsCapability(user: UserRecord, capability: Capability): boolean {
    const capabilityMinTierMap =
      this.config.get<GatingConfig>('gating')?.capabilityMinTier ?? {};
    return meetsCapabilityMinTier(
      user.kycTier as KycTier,
      capability,
      capabilityMinTierMap,
    );
  }

  /**
   * Builds short-term conversation memory from the message repo: the last
   * HISTORY_TURN_LIMIT persisted turns, oldest→newest, as alternating user +
   * assistant turns. Authoritative server-side build (§3.2) — the agent never
   * loads history itself (no checkpointer, CLAUDE.md §6). A repo failure must not
   * break the turn, so it degrades to no memory rather than throwing.
   */
  private async loadHistory(
    conversationId: string,
  ): Promise<ConversationTurn[]> {
    try {
      // Repo returns newest-first; reverse to chronological order.
      const rows = await this.messageRepo.findWebHistory(conversationId, {
        limit: HISTORY_TURN_LIMIT,
      });
      const turns: ConversationTurn[] = [];
      for (const row of [...rows].reverse()) {
        turns.push({ role: 'user', content: row.userText });
        if (row.reply?.text) {
          turns.push({ role: 'assistant', content: row.reply.text });
        }
      }
      return turns;
    } catch (err: unknown) {
      this.logger.warn(
        { conversationId, err },
        'Failed to load conversation history — proceeding without memory',
      );
      return [];
    }
  }

  /**
   * Resolves WHICH saved beneficiary a sell/send routes to (Wave B — nicknames).
   *
   * Precedence:
   *   1. Explicit `beneficiaryId` from the request body (the user picked one in
   *      the resolve loop) — always wins.
   *   2. `recipientNickname` from the intent — a server-resolved LOOKUP KEY
   *      against the user's OWN saved beneficiaries (§3.1: never an address).
   *      Exactly one match → use it; several → choose_beneficiary outcome with
   *      HUMAN-SAFE masked details; none → needs_beneficiary with a targeted
   *      note. A spoken nickname always beats the silent default — a miss must
   *      NOT quietly route money to the default recipient.
   *   3. No nickname: the default beneficiary, else needs_beneficiary.
   *
   * Resolution yields only a beneficiaryId; the proposal service and engine
   * re-validate ownership, type, cooling-off, and sanctions before any money
   * moves (§3.1/§3.3).
   */
  private async resolvePayoutBeneficiary(
    userId: string,
    type: 'bank_account' | 'crypto_address',
    explicitBeneficiaryId: string | undefined,
    recipientNickname: string | undefined,
    matchCurrency?: string,
  ): Promise<
    | { resolved: true; beneficiaryId: string }
    | { resolved: false; outcome: AgentTurnOutcome; summaryText: string }
  > {
    // Explicit pick always wins — the proposal service re-validates ownership,
    // type, cooling-off, and (for a sell) the payout-currency match (§3.1/§3.3).
    if (explicitBeneficiaryId) {
      return { resolved: true, beneficiaryId: explicitBeneficiaryId };
    }

    if (recipientNickname) {
      const all = await this.beneficiaryService.resolveByNickname(
        userId,
        type,
        recipientNickname,
      );
      // Restrict a currency-scoped payout to matching-currency banks so a
      // wrong-currency nickname hit does not silently route money.
      const matches = matchCurrency
        ? all.filter((b) => this.beneficiaryMatchesCurrency(b, matchCurrency))
        : all;
      if (matches.length === 1) {
        return { resolved: true, beneficiaryId: matches[0].id };
      }
      if (matches.length > 1) {
        return {
          resolved: false,
          outcome: {
            kind: 'choose_beneficiary',
            beneficiaryType: type,
            nickname: recipientNickname,
            candidates: matches.map((match) => ({
              id: match.id,
              label: match.label,
              detail: maskBeneficiaryDetail(match),
            })),
          },
          summaryText: `You have ${matches.length} saved recipients called '${recipientNickname}'. Which one did you mean?`,
        };
      }
      const note = matchCurrency
        ? `No ${matchCurrency} bank account called '${recipientNickname}'. Add one first, or pick from your saved list.`
        : `No saved beneficiary called '${recipientNickname}'. Add one first, or pick from your saved list.`;
      return {
        resolved: false,
        outcome: { kind: 'needs_beneficiary', beneficiaryType: type, note },
        summaryText: note,
      };
    }

    // No nickname: for a currency-scoped payout, prefer a matching-currency bank
    // (default if it matches, else the single matching one) instead of routing to
    // a wrong-currency default.
    if (matchCurrency) {
      const bank = await this.resolveMatchingCurrencyBank(
        userId,
        type,
        matchCurrency,
      );
      if (bank) {
        return { resolved: true, beneficiaryId: bank.id };
      }
      const note = `Please add a ${matchCurrency} bank account first.`;
      return {
        resolved: false,
        outcome: { kind: 'needs_beneficiary', beneficiaryType: type, note },
        summaryText: note,
      };
    }

    const fallback = await this.beneficiaryService.getDefault(userId, type);
    if (fallback) {
      return { resolved: true, beneficiaryId: fallback.id };
    }
    return {
      resolved: false,
      outcome: { kind: 'needs_beneficiary', beneficiaryType: type },
      summaryText:
        type === 'bank_account'
          ? 'Please add a bank account first.'
          : 'Please add a crypto address first.',
    };
  }

  /**
   * Deterministic edge parser (§3.1 — NOT the model): scans the user's OWN
   * message for an address-shaped token and classifies its network via the
   * registry (`AssetRegistry.inferNetworkForAddress`). Used only to pre-fill the
   * user-confirmed send card and to force that card instead of the default
   * beneficiary; the engine re-validates the address before any money moves.
   *
   * Public for direct unit testing and for the send dispatch (Task 5).
   */
  parseAddressFromText(
    text: string,
  ): { address: string; network: string } | null {
    for (const token of text.split(/\s+/)) {
      if (token.length < MIN_ADDRESS_TOKEN_LENGTH) continue; // skip words
      const network = this.assetRegistry.inferNetworkForAddress(token);
      if (network) return { address: token, network };
    }
    return null;
  }

  /**
   * Resolve a CRYPTO send destination to a discriminated `SendDestination`
   * descriptor. Unlike `resolvePayoutBeneficiary` (the bank/sell path), this
   * NEVER falls through to the user's default beneficiary (§3.1 NO-MISROUTE): an
   * explicit-but-unsaved destination — a pasted address, a nickname that matched
   * nothing, or a bare "send N" — returns a `needs_beneficiary` card offering a
   * raw send, so money is never silently routed to the wrong recipient.
   *
   * Precedence:
   *   1. explicit `sendDestination` (user-confirmed raw address) → raw_address
   *   2. explicit `beneficiaryId` (picked in the resolve loop) → saved_beneficiary
   *   3. `recipientNickname` starting with `@` → a PUBLIC handle resolved via
   *      HandleService → internal_user; a miss (or a self-send) → clarification,
   *      NEVER the private-nickname lookup or the default (§3.1 NO-MISROUTE).
   *   4. `recipientNickname` (no `@`) → saved_beneficiary (1 match); >1 →
   *      choose_beneficiary; 0 → needs_beneficiary(allowRawSend) — the nickname
   *      miss offers the card, never the default.
   *   5. no explicit destination → needs_beneficiary(allowRawSend), pre-filled
   *      with a pasted address when the message contains one — NEVER the default.
   *
   * The proposal service and engine re-validate ownership, type, cooling-off,
   * the address pattern, and sanctions before any money moves (§3.1/§3.3).
   *
   * Public for direct unit testing and for the send dispatch (Task 5).
   */
  async resolveSendDestination(
    userId: string,
    req: { beneficiaryId?: string; sendDestination?: SendDestinationInput },
    recipientNickname: string | undefined,
    messageText: string,
  ): Promise<
    | { resolved: true; destination: SendDestination }
    | { resolved: false; outcome: AgentTurnOutcome; summaryText: string }
  > {
    // 1. A user-confirmed raw address from the send-to-address card / Flow (§3.1).
    if (req.sendDestination) {
      const d = req.sendDestination;
      return {
        resolved: true,
        destination: {
          kind: 'raw_address',
          address: d.address,
          network: d.network,
          ...(d.saveAsBeneficiary ? { save: { label: d.label } } : {}),
        },
      };
    }

    // 2. An explicit pick from the resolve loop — the engine re-validates.
    if (req.beneficiaryId) {
      return {
        resolved: true,
        destination: {
          kind: 'saved_beneficiary',
          beneficiaryId: req.beneficiaryId,
        },
      };
    }

    // 3. A spoken nickname — a server-resolved lookup key against the user's OWN
    //    saved recipients (§3.1: never an address). A miss offers the card, never
    //    the silent default.
    if (recipientNickname) {
      // 3a. An `@handle` is a PUBLIC handle (PayID / public nickname), not a
      //     private saved recipient — resolve it via the global HandleService
      //     to an internal_user transfer. A miss surfaces a clarification and
      //     NEVER falls through to the private-nickname lookup or the default
      //     beneficiary (§3.1 NO-MISROUTE). recipientUserId/displayHandle come
      //     from the resolver, never the model.
      const trimmedNickname = recipientNickname.trimStart();
      if (trimmedNickname.startsWith('@')) {
        const hit = await this.handleService.resolveHandle(trimmedNickname);
        if (hit === null) {
          const text = `No Handshake user ${trimmedNickname} — double-check the handle.`;
          return {
            resolved: false,
            outcome: { kind: 'clarification', text },
            summaryText: text,
          };
        }
        // Self-send → clarification (clean UX). The proposal service's
        // SelfSendError guard remains the authoritative gate (§3.1) — this only
        // avoids a needless round-trip to the engine for the obvious case.
        if (hit.userId === userId) {
          const text = `That's your own handle — you can't send money to yourself.`;
          return {
            resolved: false,
            outcome: { kind: 'clarification', text },
            summaryText: text,
          };
        }
        return {
          resolved: true,
          destination: {
            kind: 'internal_user',
            recipientUserId: hit.userId,
            displayHandle: `@${hit.handle}`,
            recipientDisplayName: hit.displayName,
          },
        };
      }

      const matches = await this.beneficiaryService.resolveByNickname(
        userId,
        'crypto_address',
        recipientNickname,
      );
      if (matches.length === 1) {
        return {
          resolved: true,
          destination: {
            kind: 'saved_beneficiary',
            beneficiaryId: matches[0].id,
          },
        };
      }
      if (matches.length > 1) {
        return {
          resolved: false,
          outcome: {
            kind: 'choose_beneficiary',
            beneficiaryType: 'crypto_address',
            nickname: recipientNickname,
            candidates: matches.map((match) => ({
              id: match.id,
              label: match.label,
              detail: maskBeneficiaryDetail(match),
            })),
          },
          summaryText: `You have ${matches.length} saved recipients called '${recipientNickname}'. Which one did you mean?`,
        };
      }
      const note = `No saved recipient called '${recipientNickname}'. Send to an address or add one.`;
      return {
        resolved: false,
        outcome: {
          kind: 'needs_beneficiary',
          beneficiaryType: 'crypto_address',
          note,
          allowRawSend: true,
        },
        summaryText: note,
      };
    }

    // 4. No explicit destination — offer the card, pre-filled from a pasted
    //    address if present. NEVER fall through to the default beneficiary (§3.1).
    const parsed = this.parseAddressFromText(messageText);
    return {
      resolved: false,
      outcome: {
        kind: 'needs_beneficiary',
        beneficiaryType: 'crypto_address',
        allowRawSend: true,
        ...(parsed ? { prefillAddress: parsed.address } : {}),
      },
      summaryText:
        'Where would you like to send it? Pick a saved recipient or paste an address.',
    };
  }

  /**
   * True when a beneficiary's payout currency equals `currency`. Legacy null
   * payoutCurrency rows predate the currency dimension → treated as the catalog
   * base fiat (NGN today; post-backfill no bank row is null).
   */
  private beneficiaryMatchesCurrency(
    beneficiary: BeneficiaryRecord,
    currency: string,
  ): boolean {
    const payoutCurrency =
      beneficiary.payoutCurrency ?? this.assetRegistry.defaultFiat();
    return payoutCurrency === currency;
  }

  /**
   * Resolves the bank to use for a currency-scoped payout without a nickname:
   * the default when it matches the currency, else the SINGLE matching-currency
   * bank. Returns null when there is no unambiguous match (none, or several) —
   * the caller then prompts to add/pick a matching-currency bank.
   */
  private async resolveMatchingCurrencyBank(
    userId: string,
    type: 'bank_account' | 'crypto_address',
    currency: string,
  ): Promise<BeneficiaryRecord | null> {
    const fallback = await this.beneficiaryService.getDefault(userId, type);
    if (fallback && this.beneficiaryMatchesCurrency(fallback, currency)) {
      return fallback;
    }
    const all = await this.beneficiaryService.listForUser(userId, type);
    const matching = all.filter((b) =>
      this.beneficiaryMatchesCurrency(b, currency),
    );
    return matching.length === 1 ? matching[0] : null;
  }

  /**
   * Maps a sell/send proposal-builder rejection to a client-safe clarification
   * string, or `null` when the error is unexpected and must propagate (mapped to
   * a 500 by the global filter).
   *
   * The copy mirrors the global DomainExceptionFilter's client-safe messages —
   * the raw domain message (which may carry balances, addresses, or compliance
   * event ids) is NEVER surfaced; the original is logged for diagnosis.
   */
  private proposalErrorClarification(err: unknown): string | null {
    if (err instanceof InsufficientBalanceError) {
      return 'You don’t have enough balance for this transaction. Try a smaller amount.';
    }
    if (err instanceof AmountTooSmallError) {
      return 'That amount is below the minimum allowed for this transaction.';
    }
    if (err instanceof SelfSendError) {
      return 'That’s your own wallet address — no transfer is needed. Choose a different recipient.';
    }
    if (err instanceof InvalidSendAddressError) {
      // A user-pasted raw address that failed the network's pattern check.
      // Surface a clean, actionable clarification — NEVER the raw domain
      // message (it echoes the invalid address back verbatim).
      return `That doesn’t look like a valid ${err.network} address — please check it and try again.`;
    }
    if (err instanceof BeneficiaryCoolingOffError) {
      return (
        'For your security, newly added recipients have a short cooling-off ' +
        'period before the first transfer. Please try again later.'
      );
    }
    if (err instanceof BeneficiaryWrongTypeError) {
      return 'That recipient can’t be used for this transaction.';
    }
    if (err instanceof SanctionsBlockedError) {
      return 'This transfer can’t be completed. Please use a different recipient.';
    }
    return null;
  }

  /**
   * Paginated conversation history for the authenticated user's web thread.
   * Reuses the persisted reply outcome so the FE maps each turn exactly as it
   * maps a live POST /chat/messages response. Returns turns oldest→newest;
   * `nextCursor` loads the previous (older) page via `?before=`.
   */
  async getHistory(input: GetHistoryInput): Promise<ChatHistoryResponse> {
    const conversation = await this.conversationRepo.findByUserId(input.userId);
    if (conversation === null) {
      return {
        conversationId: null,
        messages: [],
        nextCursor: null,
        hasMore: false,
      };
    }

    // Repo returns newest-first and fetches limit+1 so we can detect more pages.
    const turns = await this.messageRepo.findWebHistory(conversation.id, {
      before: input.before,
      limit: input.limit,
    });
    const hasMore = turns.length > input.limit;
    const page = hasMore ? turns.slice(0, input.limit) : turns;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    const messages = await Promise.all(
      [...page].reverse().map(async (turn) => ({
        messageId: turn.id,
        userText: turn.userText,
        outcome: await this.parseStoredOutcome(
          turn.reply?.outcome,
          input.userId,
        ),
        createdAt: turn.createdAt.toISOString(),
      })),
    );

    return { conversationId: conversation.id, messages, nextCursor, hasMore };
  }

  /**
   * Defensively re-validate a stored outcome JSON blob against the contract.
   * Returns null for missing/legacy/corrupt rows so the FE renders the user
   * bubble alone rather than failing the whole history load.
   *
   * For a `transactions` outcome the persisted statement `downloadUrl` carries a
   * time-limited signed token (linkTtlSeconds, default 900s). Re-serving it
   * verbatim on history reload yields a 401 expired link once the card is older
   * than the TTL, so the link is re-issued here from the stored window + txType,
   * scoped to the requesting user — always valid when rendered.
   *
   * For a `proposal` outcome the stored blob was captured at proposal-CREATION
   * time and carries NO execution status (Bug 2). Look up the proposal's CURRENT
   * status (read-only, §3.1) and attach it so a reloaded card can render a
   * terminal "Completed"/"Cancelled" state instead of a live quote whose confirm
   * would 409. A missing proposal (null status) leaves the outcome as-is.
   */
  private async parseStoredOutcome(
    raw: unknown,
    userId: string,
  ): Promise<AgentTurnOutcome | null> {
    if (raw === null || raw === undefined) return null;
    const parsed = AgentTurnOutcomeSchema.safeParse(raw);
    if (!parsed.success) return null;
    const outcome = parsed.data;
    if (outcome.kind === 'proposal') {
      const proposalStatus = await this.proposalService.getProposalStatus(
        outcome.proposalId,
      );
      return proposalStatus ? { ...outcome, proposalStatus } : outcome;
    }
    if (outcome.kind !== 'transactions') return outcome;
    const token = this.statementTokens.sign({
      userId,
      from: outcome.window.from,
      to: outcome.window.to,
      txType: outcome.txType,
    });
    return {
      ...outcome,
      downloadUrl: this.statementTokens.buildDownloadUrl(token),
    };
  }

  /**
   * Builds the plain-text balance reply from a snapshot using registry formatters
   * (no hardcoded symbols / number formatting). The mid-market fiat value is shown
   * as an approximate figure; the FX spread is never surfaced (user rule).
   */
  private buildBalanceSummary(snapshot: BalanceSnapshot): string {
    if (snapshot.balances.length === 0) {
      return snapshot.asset
        ? `You don't hold any ${snapshot.asset} yet.`
        : "You don't have any assets yet.";
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
      : 'Your balances:';
    return `${header}\n${lines.join('\n')}`;
  }

  // ---------------------------------------------------------------------------
  // Rate discovery (Wave K — read-only, §3.1)
  // ---------------------------------------------------------------------------

  /**
   * Text reply for a single-pair rate question. Surfaces the folded buy + sell
   * figure the engine transacts at; when the pair is not tradeable / unpriced the
   * rate provider throws — caught here and rendered as a graceful "no rate" line
   * (a discovery miss is not an error, never a 5xx).
   */
  private async buildRateReply(
    asset: string,
    fiatCurrency: string,
  ): Promise<string> {
    try {
      const rate = await this.ratesService.getEffectiveRate(
        asset as EffectiveRate['asset'],
        fiatCurrency,
      );
      return this.formatRateLine(rate);
    } catch {
      return `Sorry, I don't have a rate for ${asset}/${fiatCurrency} right now.`;
    }
  }

  /**
   * One human-readable rate line via registry formatters (no hardcoded symbols).
   * Shows the folded buy and sell figures only — the FX spread is NEVER itemized
   * (user rule / Wave K).
   */
  private formatRateLine(rate: EffectiveRate): string {
    const assetMeta = this.assetRegistry.asset(rate.asset);
    const buy = this.assetRegistry.formatFiat(rate.fiatCurrency, rate.buyRate);
    const sell = this.assetRegistry.formatFiat(
      rate.fiatCurrency,
      rate.sellRate,
    );
    return `${assetMeta.displayName} (${rate.asset}) — buy ${buy}, sell ${sell} per 1 ${rate.asset}.`;
  }

  /** Text reply listing every enabled, tradeable, priced pair (never throws). */
  private async buildRatesListReply(): Promise<string> {
    const { rates } = await this.ratesService.listEffectiveRates();
    if (rates.length === 0) {
      return 'No rates are available right now. Please try again later.';
    }
    const lines = rates.map((rate) => `• ${this.formatRateLine(rate)}`);
    return `Current rates:\n${lines.join('\n')}`;
  }
}
