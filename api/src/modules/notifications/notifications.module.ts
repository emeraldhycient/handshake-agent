import { Module } from '@nestjs/common';
import { WebAuthModule } from '../auth/auth.module';
import { NOTIFICATION_REPOSITORY } from './application/ports/notification.repository.port';
import { NOTIFICATION_TEMPLATE_REPOSITORY } from './application/ports/notification-template.repository.port';
import { NotificationsService } from './application/notifications.service';
import { NotificationTemplateSeedService } from './application/notification-template-seed.service';
import { NotificationPrismaRepository } from './infrastructure/notification.prisma.repository';
import { NotificationTemplatePrismaRepository } from './infrastructure/notification-template.prisma.repository';
import { NotificationsController } from './presentation/notifications.controller';

@Module({
  imports: [WebAuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    // Seeds the platform's REAL default templates (NTF-07) so the admin Comms
    // console is never empty. Invoked idempotently from AdminModule.onModuleInit
    // (mirrors the RBAC catalog/role boot seed); moves no money (§3.1).
    NotificationTemplateSeedService,
    {
      provide: NOTIFICATION_REPOSITORY,
      useClass: NotificationPrismaRepository,
    },
    {
      provide: NOTIFICATION_TEMPLATE_REPOSITORY,
      useClass: NotificationTemplatePrismaRepository,
    },
  ],
  // The admin Comms console (AdminModule) consumes the template repository token;
  // AdminModule also drives the boot seed via NotificationTemplateSeedService.
  exports: [NOTIFICATION_TEMPLATE_REPOSITORY, NotificationTemplateSeedService],
})
export class NotificationsModule {}
