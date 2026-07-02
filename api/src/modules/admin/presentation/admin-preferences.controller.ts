import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

import {
  AdminPreferencesSchema,
  type AdminPreferences,
} from '@handshake-agent/contracts';

import { AdminPreferencesService } from '../application/admin-preferences.service';
import { AdminSessionGuard } from './admin-session.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { UpdateAdminPreferencesDto } from './dto/admin-preferences.dto';

/**
 * ADM Phase 8 — self-scoped admin notification preferences. BOTH routes resolve the
 * target adminId from the authenticated principal (`@CurrentAdmin`), never a path or
 * body param, so an admin can only ever read/write their OWN preferences. Like
 * `GET /admin/me`, these are session-guarded rather than catalog-permissioned:
 * managing one's own notification toggles is not a privileged capability, so every
 * authenticated admin has it (no PERMISSION_CATALOG entry). The PATCH is audited
 * server-side inside the service. Responses are parsed through the contract schema.
 */
@Controller('admin/me/preferences')
@UseGuards(AdminSessionGuard)
export class AdminPreferencesController {
  constructor(private readonly preferences: AdminPreferencesService) {}

  @Get()
  async get(@CurrentAdmin() admin: AdminContext): Promise<AdminPreferences> {
    const prefs = await this.preferences.get(admin.adminId);
    return AdminPreferencesSchema.parse(prefs);
  }

  @Patch()
  async update(
    @Body() body: UpdateAdminPreferencesDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<AdminPreferences> {
    const prefs = await this.preferences.update(admin.adminId, {
      emailAlerts: body.emailAlerts,
      approvalMentions: body.approvalMentions,
      weeklyDigest: body.weeklyDigest,
    });
    return AdminPreferencesSchema.parse(prefs);
  }
}
