import { Controller, Get, UseGuards } from '@nestjs/common';
import type { NotificationListResponse } from '@handshake-agent/contracts';
import { NotificationListResponseSchema } from '@handshake-agent/contracts';
import {
  JwtAuthGuard,
  type AuthenticatedUser,
} from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import { NotificationsService } from '../application/notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationListResponse> {
    return NotificationListResponseSchema.parse(
      await this.notifications.list(user.userId),
    );
  }
}
