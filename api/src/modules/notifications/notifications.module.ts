import { Module } from '@nestjs/common';
import { WebAuthModule } from '../auth/auth.module';
import { NOTIFICATION_REPOSITORY } from './application/ports/notification.repository.port';
import { NOTIFICATION_TEMPLATE_REPOSITORY } from './application/ports/notification-template.repository.port';
import { NotificationsService } from './application/notifications.service';
import { NotificationPrismaRepository } from './infrastructure/notification.prisma.repository';
import { NotificationTemplatePrismaRepository } from './infrastructure/notification-template.prisma.repository';
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
    {
      provide: NOTIFICATION_TEMPLATE_REPOSITORY,
      useClass: NotificationTemplatePrismaRepository,
    },
  ],
  // The admin Comms console (AdminModule) consumes the template repository token.
  exports: [NOTIFICATION_TEMPLATE_REPOSITORY],
})
export class NotificationsModule {}
