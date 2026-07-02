import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  AdminOpsRunResponseSchema,
  OpsBoardSchema,
  type AdminOpsRunResponse,
  type OpsBoard,
} from '@handshake-agent/contracts';

import { AdminOpsService } from '../application/admin-ops.service';
import { AdminOpsRunService } from '../application/admin-ops-run.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import { AdminOpsRunDto } from './dto/admin-ops-recon-treasury-action.dto';

/**
 * Phase 6b READ + Phase 7 WRITE — the "System / ops" board for the operator console:
 * the per-provider status board, the webhook-ingest queue depths + retries, and the
 * background-jobs / cron registry (read), plus the "Run now" manual-run trigger
 * (write). Permissioned (default-deny via PermissionGuard). The read is under
 * `Metrics`; the run is under `Ops` (execute) and additionally step-up-gated.
 * Triggering a job re-drives an EXISTING deterministic worker — it moves no money
 * (§3.1). Responses are parsed through their contract schema before the boundary.
 */
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminOpsController {
  constructor(
    private readonly ops: AdminOpsService,
    private readonly opsRun: AdminOpsRunService,
  ) {}

  @Get('ops')
  @RequirePermission('api_route', 'GET /admin/ops', 'read')
  async board(): Promise<OpsBoard> {
    return OpsBoardSchema.parse(await this.ops.board());
  }

  // ── "Run now" (Phase 7, WRITE — engine-brokered; step-up-gated) ──────────────────

  @Post('ops/jobs/:id/run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission('api_route', 'POST /admin/ops/jobs/:id/run', 'execute')
  async run(
    @Param('id') id: string,
    @Body() dto: AdminOpsRunDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<AdminOpsRunResponse> {
    return AdminOpsRunResponseSchema.parse(
      await this.opsRun.run(id, dto.reason, admin.adminId),
    );
  }
}
