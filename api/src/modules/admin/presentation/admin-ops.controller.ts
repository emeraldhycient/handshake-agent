import { Controller, Get, UseGuards } from '@nestjs/common';

import { OpsBoardSchema, type OpsBoard } from '@handshake-agent/contracts';

import { AdminOpsService } from '../application/admin-ops.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';

/**
 * Phase 6b — READ-ONLY "System / ops" board for the operator console: the
 * per-provider status board, the webhook-ingest queue depths + retries, and the
 * background-jobs / cron registry. Permissioned (default-deny via PermissionGuard)
 * under the existing `Metrics` category. Nothing here moves money (§3.1) — "Run now"
 * (triggering a job) is a Phase-7 engine-brokered write, not part of this read. The
 * response is parsed through its contract schema before leaving the boundary.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminOpsController {
  constructor(private readonly ops: AdminOpsService) {}

  @Get('ops')
  @RequirePermission('api_route', 'GET /admin/ops', 'read')
  async board(): Promise<OpsBoard> {
    return OpsBoardSchema.parse(await this.ops.board());
  }
}
