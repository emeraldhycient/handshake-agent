import { Controller, Get, UseGuards } from '@nestjs/common';

import {
  AdminCatalogViewSchema,
  type AdminCatalogView,
} from '@handshake-agent/contracts';

import { AdminCatalogService } from '../application/admin-catalog.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';

/**
 * Phase 6b — READ-ONLY admin catalog console. Permissioned (default-deny); NO
 * write path (live-status edits are Phase 7). Surfaces the FULL asset + fiat
 * catalog (enabled AND disabled) for the Asset / Currency catalog screens — the
 * gap the enabled-only, secret-stripped public `GET /config` cannot fill. The
 * service never moves money (§3.1) and holds no DB credentials (§3.2); the
 * response is parsed through its contract schema before it leaves the boundary.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminCatalogController {
  constructor(private readonly catalog: AdminCatalogService) {}

  @Get('config/catalog')
  @RequirePermission('api_route', 'GET /admin/config/catalog', 'read')
  getCatalog(): AdminCatalogView {
    return AdminCatalogViewSchema.parse(this.catalog.getCatalog());
  }
}
