/**
 * DI token + port for the admin Agent conversation-LOG read repository (Phase 4
 * wave 2). READ-ONLY oversight of the agent's conversation threads, the inbound
 * messages + their validated intents, and the outbound replies.
 *
 * This is a thin read-only projection — it deliberately does NOT overlap with the
 * write-side conversation repositories used by ConversationService. The concrete
 * Prisma adapter lives in `conversations/infrastructure`; application/domain depend
 * only on this abstraction (clean-arch §4.1, CLAUDE.md §3.2). Nothing here moves
 * money (§3.1) — these shapes only project existing rows. The agent code itself
 * never reaches this (it holds no DB access §3.2); only the admin layer does.
 */
export const CONVERSATION_LOG_READ_REPOSITORY = Symbol(
  'CONVERSATION_LOG_READ_REPOSITORY',
);

// ---------------------------------------------------------------------------
// Record types (application-layer projections — never Prisma types)
// ---------------------------------------------------------------------------

/** One conversation summary row for the admin list (newest-first by createdAt). */
export interface ConversationLogRecord {
  id: string;
  userId: string | null;
  contactId: string | null;
  language: string;
  status: string;
  lastMessageAt: Date | null;
  createdAt: Date;
}

/** One inbound message + its (optional 1:1) validated intent. */
export interface ConversationLogMessageRecord {
  id: string;
  text: string;
  processingStatus: string;
  receivedAt: Date;
  intent: {
    action: string;
    /** Model confidence (0..1) or null when not captured. */
    confidence: number | null;
  } | null;
}

/** One outbound reply on the thread. */
export interface ConversationLogReplyRecord {
  id: string;
  text: string;
  status: string;
  sentAt: Date | null;
}

/** The full conversation-log detail aggregate. */
export interface ConversationLogDetailRecord {
  conversation: ConversationLogRecord;
  messages: ConversationLogMessageRecord[];
  replies: ConversationLogReplyRecord[];
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IConversationLogReadRepository {
  /**
   * Lists conversations newest-first via a (createdAt, id) keyset. Fetches
   * `limit + 1` rows internally to compute `nextCursor`.
   */
  listAll(page: {
    cursor?: string;
    limit: number;
  }): Promise<{ items: ConversationLogRecord[]; nextCursor: string | null }>;

  /**
   * Loads one conversation with its messages (+ each message's intent) and its
   * replies, all in chronological (oldest-first) order. Returns `null` when the
   * conversation id does not exist.
   */
  loadConversationLog(
    conversationId: string,
  ): Promise<ConversationLogDetailRecord | null>;
}
