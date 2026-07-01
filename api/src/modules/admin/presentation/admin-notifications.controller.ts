import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  NotificationTemplateSchema,
  NotificationTemplateListResponseSchema,
  NotificationTemplatePreviewResponseSchema,
  DeliveryLogResponseSchema,
  type NotificationTemplate,
  type NotificationTemplateListResponse,
  type NotificationTemplatePreviewResponse,
  type DeliveryLogResponse,
} from '@handshake-agent/contracts';

import { AdminNotificationTemplateService } from '../application/admin-notification-template.service';
import { AdminNotificationDeliveryService } from '../application/admin-notification-delivery.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import {
  NotificationTemplateUpsertDto,
  NotificationTemplatePreviewDto,
} from './dto/admin-notification.dto';

/**
 * Admin Comms notification-template console (Phase 4 wave 1, NTF-07). All routes
 * are permissioned (default-deny); the create/patch writes additionally require a
 * fresh step-up and are audited as config_change in the service. The preview is a
 * read (pure render). The service holds no Prisma import and never moves money
 * (§3.1). Responses are parsed through their contract schema before they leave the
 * boundary. The `preview` POST is declared before the composite-key routes so it
 * is never mistaken for a template path segment.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminNotificationsController {
  constructor(
    private readonly templates: AdminNotificationTemplateService,
    private readonly delivery: AdminNotificationDeliveryService,
  ) {}

  @Get('notification-templates')
  @RequirePermission('api_route', 'GET /admin/notification-templates', 'read')
  async list(): Promise<NotificationTemplateListResponse> {
    return NotificationTemplateListResponseSchema.parse(
      await this.templates.list(),
    );
  }

  /**
   * Phase 6b (Comms READ enrichment) — the read-only delivery log: recent issued
   * notifications (channel / template / event / issue-time / derived status) plus
   * aggregate bounce/complaint rates. Permissioned (default-deny); no write path,
   * moves no money (§3.1). Parsed through its contract schema before it leaves the
   * boundary.
   */
  @Get('notifications/delivery-log')
  @RequirePermission(
    'api_route',
    'GET /admin/notifications/delivery-log',
    'read',
  )
  async deliveryLog(): Promise<DeliveryLogResponse> {
    return DeliveryLogResponseSchema.parse(await this.delivery.deliveryLog());
  }

  @Post('notification-templates/preview')
  @RequirePermission(
    'api_route',
    'POST /admin/notification-templates/preview',
    'read',
  )
  preview(
    @Body() body: NotificationTemplatePreviewDto,
  ): NotificationTemplatePreviewResponse {
    return NotificationTemplatePreviewResponseSchema.parse(
      this.templates.preview(body),
    );
  }

  @Post('notification-templates')
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'POST /admin/notification-templates', 'write')
  async create(
    @Body() body: NotificationTemplateUpsertDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<NotificationTemplate> {
    return NotificationTemplateSchema.parse(
      await this.templates.upsert(body, admin.adminId),
    );
  }

  @Get('notification-templates/:templateKey/:language/:channel')
  @RequirePermission(
    'api_route',
    'GET /admin/notification-templates/:templateKey/:language/:channel',
    'read',
  )
  async get(
    @Param('templateKey') templateKey: string,
    @Param('language') language: string,
    @Param('channel') channel: string,
  ): Promise<NotificationTemplate> {
    return NotificationTemplateSchema.parse(
      await this.templates.get(templateKey, language, channel),
    );
  }

  @Patch('notification-templates/:templateKey/:language/:channel')
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'PATCH /admin/notification-templates/:templateKey/:language/:channel',
    'write',
  )
  async update(
    @Body() body: NotificationTemplateUpsertDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<NotificationTemplate> {
    return NotificationTemplateSchema.parse(
      await this.templates.upsert(body, admin.adminId),
    );
  }
}
