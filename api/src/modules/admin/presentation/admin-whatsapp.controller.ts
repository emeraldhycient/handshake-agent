import { Controller, Get, UseGuards } from '@nestjs/common';

import {
  WhatsAppConfigViewSchema,
  type WhatsAppConfigView,
} from '@handshake-agent/contracts';

import { AdminWhatsAppConfigService } from '../application/admin-whatsapp-config.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';

/**
 * Admin Comms read-only WhatsApp configuration view (Phase 4 wave 1). Permissioned
 * (default-deny), no write path. Returns NON-SECRET values + secret-presence
 * booleans only — the secret VALUES never cross this boundary (§3.5). The response
 * is parsed through its contract schema before it leaves the boundary.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminWhatsAppController {
  constructor(private readonly whatsapp: AdminWhatsAppConfigService) {}

  @Get('whatsapp/config')
  @RequirePermission('api_route', 'GET /admin/whatsapp/config', 'read')
  getConfig(): WhatsAppConfigView {
    return WhatsAppConfigViewSchema.parse(this.whatsapp.getConfig());
  }
}
