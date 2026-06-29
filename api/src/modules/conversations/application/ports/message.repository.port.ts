export const MESSAGE_REPOSITORY = Symbol('MESSAGE_REPOSITORY');

export interface ConversationMessageRecord {
  id: string;
  conversationId: string;
  externalMessageId: string;
  channel: string;
  senderAddress: string;
  text: string;
  rawUserText: string;
  processingStatus: string;
  correlationId: string;
  createdAt: Date;
}

export interface CreateMessageData {
  conversationId: string;
  externalMessageId: string;
  channel: string;
  senderAddress: string;
  text: string;
  rawUserText: string;
  processingStatus: string;
  correlationId: string;
}

/**
 * Read model for one persisted web-chat turn: the inbound user message joined
 * with its reply's text + rendered outcome. Used to rehydrate the web thread.
 */
export interface ConversationTurnRecord {
  id: string;
  userText: string;
  createdAt: Date;
  reply: { text: string; outcome: unknown } | null;
}

export interface FindWebHistoryOptions {
  /** Message-id cursor: return only turns strictly older than this id. */
  before?: string;
  /** Max turns to return; the repo fetches one extra to detect `hasMore`. */
  limit: number;
}

export interface IMessageRepository {
  findByExternalId(
    externalMessageId: string,
  ): Promise<ConversationMessageRecord | null>;
  create(data: CreateMessageData): Promise<ConversationMessageRecord>;
  updateStatus(id: string, status: string, errorReason?: string): Promise<void>;
  /**
   * Web-channel turns for a conversation, newest-first (DESC by id), fetching
   * `limit + 1` rows so the caller can compute pagination. Each turn includes
   * its reply text + outcome via the message↔reply relation.
   */
  findWebHistory(
    conversationId: string,
    opts: FindWebHistoryOptions,
  ): Promise<ConversationTurnRecord[]>;
}
