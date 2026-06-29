import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  INotificationRepository,
  NotificationRecord,
} from '../application/ports/notification.repository.port';

@Injectable()
export class NotificationPrismaRepository implements INotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(
    userId: string,
    limit: number,
  ): Promise<NotificationRecord[]> {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      select: {
        id: true,
        eventType: true,
        eventRef: true,
        templateVars: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      eventType: String(r.eventType),
      eventRef: r.eventRef,
      templateVars: (r.templateVars ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt,
    }));
  }
}
