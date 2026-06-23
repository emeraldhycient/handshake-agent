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

export interface IMessageRepository {
  findByExternalId(
    externalMessageId: string,
  ): Promise<ConversationMessageRecord | null>;
  create(data: CreateMessageData): Promise<ConversationMessageRecord>;
  updateStatus(id: string, status: string, errorReason?: string): Promise<void>;
}
