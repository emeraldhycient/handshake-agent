export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');

export interface NotificationRecord {
  id: string;
  eventType: string;
  eventRef: string;
  templateVars: Record<string, unknown>;
  createdAt: Date;
}

export interface INotificationRepository {
  findByUserId(userId: string, limit: number): Promise<NotificationRecord[]>;
}
