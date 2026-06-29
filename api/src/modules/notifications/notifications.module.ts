import { Module } from '@nestjs/common';
import { WebAuthModule } from '../auth/auth.module';
import { NOTIFICATION_REPOSITORY } from './application/ports/notification.repository.port';
import { NotificationsService } from './application/notifications.service';
import { NotificationPrismaRepository } from './infrastructure/notification.prisma.repository';
import { NotificationsController } from './presentation/notifications.controller';

@Module({
  imports: [WebAuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: NOTIFICATION_REPOSITORY,
      useClass: NotificationPrismaRepository,
    },
  ],
})
export class NotificationsModule {}
