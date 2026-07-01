import { Inject, Injectable } from '@nestjs/common';

import type {
  AgentConfigView,
  ConversationLogDetail,
  ConversationLogItem,
} from '@handshake-agent/contracts';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import {
  CONVERSATION_LOG_READ_REPOSITORY,
  type ConversationLogRecord,
  type IConversationLogReadRepository,
} from '../../conversations/application/ports/conversation-log-read.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';

/** Default page size for the admin conversation-log list when omitted. */
const DEFAULT_LIST_LIMIT = 20;

/**
 * READ-ONLY, operator-facing description of what the agent's system prompt does.
 * This is NOT the live prompt string and is NOT editable (§3.1/§6) — it is a fixed
 * preview so operators understand the agent's role without exposing or enabling any
 * editing of the actual prompt, and without ever surfacing the ANTHROPIC_API_KEY.
 */
const SYSTEM_PROMPT_PREVIEW =
  'The agent extracts a validated structured intent from each user message ' +
  '(buy / sell / send / receive / swap crypto, buy ticket, check balance, query ' +
  'transactions, or none). It only PROPOSES — it never moves money; the ' +
  'deterministic engine settles every transaction after confirmation, PIN, and ' +
  'step-up. The system prompt is generated from the live asset catalog and is ' +
  'read-only here (not admin-editable). The model id and enablement flag are ' +
  'tuned via /admin/settings.';

export interface AdminConversationListQuery {
  cursor?: string;
  limit?: number;
}

/**
 * Phase 4 (wave 2) — READ-ONLY admin Agent console. Surfaces the agent's
 * configuration (model id + enablement, both from the layered config) plus a
 * read-only system-prompt preview, and the conversation/intent/reply logs.
 *
 * It NEVER moves money (§3.1) and holds no Prisma import — it reaches data only
 * through injected ports / the layered config (§3.2). The system prompt is NOT
 * editable and the ANTHROPIC_API_KEY is NEVER returned (§3.1/§6).
 */
@Injectable()
export class AdminAgentService {
  constructor(
    @Inject(CONVERSATION_LOG_READ_REPOSITORY)
    private readonly conversations: IConversationLogReadRepository,
    private readonly effectiveConfig: EffectiveConfigService,
  ) {}

  /** The agent's read-only config view (model id + enablement + prompt preview). */
  getConfig(): AgentConfigView {
    return {
      modelId: this.effectiveConfig.get<string>('agent.modelId'),
      enabled: this.effectiveConfig.get<boolean>('agent.enabled'),
      systemPromptPreview: SYSTEM_PROMPT_PREVIEW,
    };
  }

  async listConversations(
    query: AdminConversationListQuery,
  ): Promise<{ items: ConversationLogItem[]; nextCursor: string | null }> {
    const result = await this.conversations.listAll({
      cursor: query.cursor,
      limit: query.limit ?? DEFAULT_LIST_LIMIT,
    });
    return {
      items: result.items.map((c) => this.toListItem(c)),
      nextCursor: result.nextCursor,
    };
  }

  async getConversation(id: string): Promise<ConversationLogDetail> {
    const log = await this.conversations.loadConversationLog(id);
    if (log === null) throw new AdminNotFoundError('Conversation');

    return {
      id: log.conversation.id,
      userId: log.conversation.userId,
      contactId: log.conversation.contactId,
      language: log.conversation.language,
      status: log.conversation.status,
      messages: log.messages.map((m) => ({
        id: m.id,
        text: m.text,
        processingStatus: m.processingStatus,
        receivedAt: m.receivedAt.toISOString(),
        intent:
          m.intent !== null
            ? { action: m.intent.action, confidence: m.intent.confidence }
            : null,
      })),
      replies: log.replies.map((r) => ({
        id: r.id,
        text: r.text,
        status: r.status,
        sentAt: r.sentAt !== null ? r.sentAt.toISOString() : null,
      })),
    };
  }

  private toListItem(c: ConversationLogRecord): ConversationLogItem {
    return {
      id: c.id,
      userId: c.userId,
      contactId: c.contactId,
      language: c.language,
      status: c.status,
      lastMessageAt:
        c.lastMessageAt !== null ? c.lastMessageAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
    };
  }
}
