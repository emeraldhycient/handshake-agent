import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  WebhookDetailSchema,
  WebhookListResponseSchema,
  WebhookMetricsSchema,
  type WebhookDetail,
  type WebhookListResponse,
  type WebhookMetrics,
} from '@handshake-agent/contracts';

import { AdminWebhooksService } from '../application/admin-webhooks.service';
import { WebhookMetricsService } from '../../webhooks/application/webhook-metrics.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import { WebhookListQueryDto, WebhookRetryDto } from './dto/admin-webhooks.dto';

/**
 * Track A — the admin WEBHOOKS CONSOLE. All routes are permissioned (default-deny
 * via PermissionGuard, Ops category). list/detail/metrics are reads; retry
 * re-enqueues a webhook for the worker (execute) and additionally requires a fresh
 * step-up. The retry NEVER settles inline — settlement stays engine-brokered in
 * the worker handler (§3.1). Responses are parsed through their contract schema.
 */
@Controller('admin/webhooks')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminWebhooksController {
  constructor(
    private readonly webhooks: AdminWebhooksService,
    private readonly metrics: WebhookMetricsService,
  ) {}

  @Get()
  @RequirePermission('api_route', 'GET /admin/webhooks', 'read')
  async list(
    @Query() query: WebhookListQueryDto,
  ): Promise<WebhookListResponse> {
    return WebhookListResponseSchema.parse(await this.webhooks.list(query));
  }

  @Get('metrics')
  @RequirePermission('api_route', 'GET /admin/webhooks/metrics', 'read')
  async getMetrics(): Promise<WebhookMetrics> {
    return WebhookMetricsSchema.parse(await this.metrics.snapshot());
  }

  @Get(':id')
  @RequirePermission('api_route', 'GET /admin/webhooks/:id', 'read')
  async detail(@Param('id') id: string): Promise<WebhookDetail> {
    return WebhookDetailSchema.parse(await this.webhooks.detail(id));
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'POST /admin/webhooks/:id/retry', 'execute')
  async retry(
    @Param('id') id: string,
    @Body() dto: WebhookRetryDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<WebhookDetail> {
    return WebhookDetailSchema.parse(
      await this.webhooks.retry(id, admin.adminId, dto.reason),
    );
  }
}
