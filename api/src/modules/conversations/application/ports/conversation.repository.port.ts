export const CONVERSATION_REPOSITORY = Symbol('CONVERSATION_REPOSITORY');

export interface ConversationRecord {
  id: string;
  contactId: string | null;
  userId: string | null;
  status: string;
  lastMessageAt: Date | null;
  createdAt: Date;
}

export interface IConversationRepository {
  findByContactId(contactId: string): Promise<ConversationRecord | null>;
  findByUserId(userId: string): Promise<ConversationRecord | null>;
  create(data: {
    contactId?: string;
    userId?: string;
  }): Promise<ConversationRecord>;
  touch(id: string, lastMessageAt: Date): Promise<void>;
}
