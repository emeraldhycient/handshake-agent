import { Inject, Injectable } from '@nestjs/common';
import type { NotificationListResponse } from '@handshake-agent/contracts';
import {
  NOTIFICATION_REPOSITORY,
  type INotificationRepository,
} from './ports/notification.repository.port';

const DEFAULT_LIMIT = 50;

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: INotificationRepository,
  ) {}

  async list(userId: string): Promise<NotificationListResponse> {
    const rows = await this.repo.findByUserId(userId, DEFAULT_LIMIT);
    return {
      items: rows.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        eventRef: r.eventRef,
        templateVars: r.templateVars,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
