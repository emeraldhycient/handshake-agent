export const INTENT_REPOSITORY = Symbol('INTENT_REPOSITORY');

export interface CreateIntentData {
  messageId: string;
  conversationId: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface IIntentRepository {
  create(data: CreateIntentData): Promise<{ id: string }>;
}
