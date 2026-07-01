import { Controller, Get, UseGuards } from '@nestjs/common';

import {
  ProviderRegistryViewSchema,
  type ProviderRegistryView,
} from '@handshake-agent/contracts';

import { AdminProvidersService } from '../application/admin-providers.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';

/**
 * Admin Providers registry read view (Phase 6b, design §6.27). Permissioned
 * (default-deny), no write path. Returns per-provider non-secret wiring, mock-mode,
 * bound capabilities, a posture-derived status, and secret-PRESENCE booleans only —
 * the secret VALUES never cross this boundary (§3.4 / §3.5) — plus a mock→live
 * readiness checklist. The response is parsed through its contract schema before it
 * leaves the boundary. Never moves money (§3.1); test-connection / key-reveal are
 * Phase 7.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminProvidersController {
  constructor(private readonly providers: AdminProvidersService) {}

  @Get('providers')
  @RequirePermission('api_route', 'GET /admin/providers', 'read')
  getRegistry(): ProviderRegistryView {
    return ProviderRegistryViewSchema.parse(this.providers.getRegistry());
  }
}
