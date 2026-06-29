export const REPLY_REPOSITORY = Symbol('REPLY_REPOSITORY');

export interface ConversationReplyRecord {
  id: string;
  conversationId: string;
  messageId: string | null;
  text: string;
  status: string;
  correlationId: string;
  createdAt: Date;
}

export interface CreateReplyData {
  conversationId: string;
  messageId: string;
  text: string;
  correlationId: string;
  /**
   * Rendered AgentTurnOutcome (contracts) for the web surface. Persisted as JSON
   * so GET /chat/messages can reconstruct the thread cards on reload. Optional:
   * the WhatsApp reply path does not set it.
   */
  outcome?: unknown;
}

export interface IReplyRepository {
  create(data: CreateReplyData): Promise<ConversationReplyRecord>;
  updateStatus(
    id: string,
    status: string,
    fields?: { sentAt?: Date; failureReason?: string },
  ): Promise<void>;
}
