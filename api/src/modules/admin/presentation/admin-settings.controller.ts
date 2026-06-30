import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  EffectiveSettingListResponseSchema,
  EffectiveSettingSchema,
  type EffectiveSetting,
  type EffectiveSettingListResponse,
} from '@handshake-agent/contracts';

import { AdminSettingsService } from '../application/admin-settings.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import { SettingsQueryDto, UpdateSettingDto } from './dto/admin-settings.dto';

/**
 * Layered-config (AppSetting) console (Phase 1, root CLAUDE.md §7). All routes are
 * permissioned (default-deny); the mutating PATCH additionally requires a fresh
 * step-up. The service holds no Prisma import and never moves money (§3.2).
 * Responses are parsed through the contract schema before they leave the boundary.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get('settings')
  @RequirePermission('api_route', 'GET /admin/settings', 'read')
  async list(
    @Query() query: SettingsQueryDto,
  ): Promise<EffectiveSettingListResponse> {
    const settings = await this.settings.listEffective(query.category);
    return EffectiveSettingListResponseSchema.parse({ settings });
  }

  @Get('settings/:key')
  @RequirePermission('api_route', 'GET /admin/settings/:key', 'read')
  async get(@Param('key') key: string): Promise<EffectiveSetting> {
    const setting = await this.settings.get(key);
    return EffectiveSettingSchema.parse(setting);
  }

  @Patch('settings/:key')
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'PATCH /admin/settings/:key', 'write')
  async update(
    @Param('key') key: string,
    @Body() body: UpdateSettingDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<EffectiveSetting> {
    const setting = await this.settings.update(
      key,
      body.value,
      body.scope,
      body.scopeValue,
      admin.adminId,
    );
    return EffectiveSettingSchema.parse(setting);
  }
}
