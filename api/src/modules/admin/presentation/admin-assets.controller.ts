import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  AdminAssetsSyncResponseSchema,
  AdminDiscoveredAssetListResponseSchema,
  type AdminAssetsSyncResponse,
  type AdminDiscoveredAssetListResponse,
} from '@handshake-agent/contracts';

import { AdminAssetsService } from '../application/admin-assets.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';

/**
 * Asset-catalog DISCOVERY surface (CLAUDE.md §7). Lists the provider-discovered assets
 * awaiting review (read) and triggers an on-demand Blockradar re-sync (refresh).
 * Permissioned (default-deny via PermissionGuard) under the Config category. Discovery
 * moves NO money (§3.1) — it reads the provider's asset listing and merges metadata into
 * the in-memory overlay, exactly what CatalogSyncService already runs at boot. It is NOT
 * step-up-gated (a catalog refresh is not a sensitive config write, and gating a "Sync"
 * button behind TOTP is the wrong UX) — but it IS audited in the service. Responses are
 * parsed through their contract schema before the boundary.
 */
@Controller('admin/config/assets')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminAssetsController {
  constructor(private readonly assets: AdminAssetsService) {}

  // ── list newly-discovered assets (read) ─────────────────────────────────────────

  @Get('discovered')
  @RequirePermission('api_route', 'GET /admin/config/assets/discovered', 'read')
  listDiscovered(): AdminDiscoveredAssetListResponse {
    return AdminDiscoveredAssetListResponseSchema.parse(
      this.assets.listDiscovered(),
    );
  }

  // ── re-sync the Blockradar catalog (permissioned + audited refresh) ─────────────

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('api_route', 'POST /admin/config/assets/sync', 'write')
  async sync(
    @CurrentAdmin() admin: AdminContext,
  ): Promise<AdminAssetsSyncResponse> {
    return AdminAssetsSyncResponseSchema.parse(
      await this.assets.sync(admin.adminId),
    );
  }
}
