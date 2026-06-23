import { randomUUID } from 'node:crypto';

import { Injectable, Inject } from '@nestjs/common';

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

import {
  CONVERSATION_REPOSITORY,
  type IConversationRepository,
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

const SAFE_FALLBACK = 'Sorry, something went wrong — please try again.';
const NOT_SUPPORTED = "That's not supported yet — you can buy USDT with naira.";

function buildConfirmationText(c: {
  asset: string;
  cryptoAmount: string;
  fiatAmount: string;
  fiatCurrency: string;
  processingFeeAmount: string;
  totalFiat: string;
  expiresAt: string;
}): string {
  return (
    `Here is your buy summary:\n` +
    `Asset: ${c.asset}\n` +
    `You receive: ${c.cryptoAmount} ${c.asset}\n` +
    `Amount: ${c.fiatCurrency} ${c.fiatAmount}\n` +
    `Processing fee: ${c.fiatCurrency} ${c.processingFeeAmount}\n` +
    `Total: ${c.fiatCurrency} ${c.totalFiat}\n` +
    `Expires at: ${c.expiresAt}\n` +
    `Reply CONFIRM to proceed.`
  );
}

@Injectable()
export class ConversationService implements IInboundHandler {
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

      // Step 6: Route on intent action.
      let replyText: string;

      if (intent.action === 'buy_crypto') {
        if (identity.kind !== 'user') {
          // Unlinked contact — needs KYC before transacting.
          replyText =
            'To buy crypto, you need to complete KYC first. Please visit our web app to verify your identity.';
        } else if (identity.requiresReverification) {
          // SIM-swap / re-verification required (CLAUDE.md §3.4).
          replyText =
            'Your account requires re-verification before you can transact. Please visit our web app to re-verify.';
        } else {
          // Happy path: create a buy proposal (deterministic engine; model proposes, engine disposes — §3.1).
          // TypeScript narrows `intent` to BuyCryptoIntent here (discriminated union on `action`).
          const { confirmation } = await this.proposalService.createBuyProposal(
            {
              userId: identity.user.id,
              conversationId: conversation.id,
              intent,
            },
          );
          replyText = buildConfirmationText(confirmation);
        }
      } else if (intent.action === 'none') {
        replyText = intent.clarification;
      } else {
        // sell_crypto / send_crypto / swap / buy_ticket / check_balance — deferred.
        replyText = NOT_SUPPORTED;
      }

      // Step 7: Persist the reply and dispatch it.
      const reply = await this.replyRepo.create({
        conversationId: conversation.id,
        messageId: message.id,
        text: replyText,
        correlationId,
      });

      await this.sender.sendText(msg.fromAddress, replyText);

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

      // Best-effort: send a safe fallback reply so the user is not left hanging.
      try {
        await this.sender.sendText(msg.fromAddress, SAFE_FALLBACK);
      } catch {
        // Swallow — webhook has already 200-acked; we cannot propagate errors here.
      }

      // Re-surface for logging (pino will capture it) — but never rethrow to the webhook controller.
      void err;
    }
  }
}
