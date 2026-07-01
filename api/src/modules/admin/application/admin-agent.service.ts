import { Inject, Injectable } from '@nestjs/common';

import {
  IntentSchema,
  type AgentConfigView,
  type AgentGuardrail,
  type AgentInsightsView,
  type AgentTool,
  type AgentToolKind,
  type ConversationLogDetail,
  type ConversationLogItem,
} from '@handshake-agent/contracts';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import {
  CONVERSATION_LOG_READ_REPOSITORY,
  type ConversationLogRecord,
  type IConversationLogReadRepository,
} from '../../conversations/application/ports/conversation-log-read.repository.port';
import {
  AGENT_USAGE_READ_REPOSITORY,
  type IAgentUsageReadRepository,
} from '../application/ports/agent-usage-read.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';

/** Default page size for the admin conversation-log list when omitted. */
const DEFAULT_LIST_LIMIT = 20;

/** The Cost & usage card window, in hours — a rolling 24h. */
const USAGE_WINDOW_HOURS = 24;

/**
 * Intent actions that only READ data (return information; move no money) vs the
 * proposal actions that PROPOSE a transaction (never execute — §3.1). Sourced from
 * the real `IntentSchema` discriminated union so the registry can never drift from
 * the agent's actual capability surface; a new intent that is not classified here
 * defaults to a proposal (safer to over-flag as a write than under-flag).
 */
const READ_ONLY_ACTIONS: ReadonlySet<string> = new Set([
  'check_balance',
  'query_transactions',
  'receive_crypto',
  'none',
]);

/** The agent's intent-action capability set, derived once from the contract union. */
const INTENT_ACTIONS: readonly string[] = IntentSchema.options.map(
  (option) => option.shape.action.value,
);

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
    @Inject(AGENT_USAGE_READ_REPOSITORY)
    private readonly usage: IAgentUsageReadRepository,
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

  /**
   * READ-ONLY Agent-console insights: the guardrail params (architectural facts +
   * the config-tunable max-tool-calls), the typed-tool registry (derived from the
   * real intent-action set), the live system-prompt version, and REAL rolling-24h
   * usage counts. No secret is surfaced and no token/cost is fabricated — the
   * schema stores none (§3.1/§3.6).
   */
  async getInsights(): Promise<AgentInsightsView> {
    const since = new Date(Date.now() - USAGE_WINDOW_HOURS * 60 * 60 * 1000);
    const usage = await this.usage.countUsageSince(since);

    return {
      guardrails: this.buildGuardrails(),
      tools: this.buildToolRegistry(),
      promptVersion: {
        label: 'live',
        status: 'live',
        promptChars: SYSTEM_PROMPT_PREVIEW.length,
      },
      usage24h: {
        conversations: usage.conversations,
        inboundMessages: usage.inboundMessages,
        outboundReplies: usage.outboundReplies,
        windowHours: USAGE_WINDOW_HOURS,
      },
    };
  }

  /**
   * The guardrail rows: three architectural invariants of the agent's construction
   * (§3.1/§6) plus the max-tool-calls value resolved from the layered config (§7),
   * so nothing is hardcoded that ops should be able to tune.
   */
  private buildGuardrails(): AgentGuardrail[] {
    const maxToolCalls = this.effectiveConfig.get<number>(
      'agent.maxToolCallsPerTurn',
    );
    return [
      { label: 'Structured output', value: 'IntentSchema (enforced)' },
      { label: 'Checkpointer', value: 'none (extractable)' },
      { label: 'PIN + step-up', value: 'required to execute' },
      { label: 'Max tool calls / turn', value: String(maxToolCalls) },
    ];
  }

  /**
   * The typed-tool registry, derived from the real `IntentSchema` capability set —
   * `read` actions return data, everything else PROPOSES a transaction and never
   * executes (§3.1). Sorted read-first for a stable, scannable card.
   */
  private buildToolRegistry(): AgentTool[] {
    return INTENT_ACTIONS.map((name) => {
      const kind: AgentToolKind = READ_ONLY_ACTIONS.has(name)
        ? 'read'
        : 'write';
      return { name, kind };
    }).sort((a, b) =>
      a.kind === b.kind
        ? a.name.localeCompare(b.name)
        : a.kind === 'read'
          ? -1
          : 1,
    );
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
