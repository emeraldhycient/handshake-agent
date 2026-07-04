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
  ComplianceEventItemSchema,
  PersistedReconBreakSchema,
  ReconActionResponseSchema,
  ReconBreakListResponseSchema,
  ReconRunDetailSchema,
  ReconRunListResponseSchema,
  ReconStatusSchema,
  type ComplianceEventItem,
  type PersistedReconBreak,
  type ReconActionResponse,
  type ReconBreakListResponse,
  type ReconRunDetail,
  type ReconRunListResponse,
  type ReconStatus,
} from '@handshake-agent/contracts';

import { AdminReconciliationService } from '../application/admin-reconciliation.service';
import { AdminReconciliationActionService } from '../application/admin-reconciliation-action.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { AdminStepUpGuard } from './admin-step-up.guard';
import { CurrentAdmin, type AdminContext } from './current-admin.decorator';
import { RequirePermission } from './require-permission.decorator';
import {
  EscalateBreakDto,
  ReconAcceptDto,
  ReconBreakActionDto,
  ReconResolveDto,
  ReconRunListQueryDto,
} from './dto/admin-ops-recon-treasury-action.dto';

/**
 * Phase 6b READ + Phase 7 WRITES — the admin RECONCILIATION surface: the
 * provider-vs-ledger break list + cron status bar (read), plus the resolve / accept
 * dispositions (write). Permissioned (default-deny via PermissionGuard) under the
 * Treasury category. RESOLVE is engine-brokered (re-drives settlement via the
 * engine's atomic path) and step-up-gated; ACCEPT is a dual-control no-debit
 * disposition. Neither moves money directly (§3.1) — over-credits are never
 * auto-debited. Responses are parsed through their contract schema before the
 * boundary.
 */
@Controller('admin/reconciliation')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminReconciliationController {
  constructor(
    private readonly reconciliation: AdminReconciliationService,
    private readonly actions: AdminReconciliationActionService,
  ) {}

  // ── break list ──────────────────────────────────────────────────────────────────

  @Get('breaks')
  @RequirePermission('api_route', 'GET /admin/reconciliation/breaks', 'read')
  async listBreaks(): Promise<ReconBreakListResponse> {
    return ReconBreakListResponseSchema.parse(
      await this.reconciliation.listBreaks(),
    );
  }

  // ── cron status bar ───────────────────────────────────────────────────────────────

  @Get('status')
  @RequirePermission('api_route', 'GET /admin/reconciliation/status', 'read')
  async status(): Promise<ReconStatus> {
    return ReconStatusSchema.parse(await this.reconciliation.status());
  }

  // ── durable run history + persisted-break lifecycle (Go-readiness #3) ────────────

  @Get('runs')
  @RequirePermission('api_route', 'GET /admin/reconciliation/runs', 'read')
  async listRuns(
    @Query() query: ReconRunListQueryDto,
  ): Promise<ReconRunListResponse> {
    return ReconRunListResponseSchema.parse(
      await this.reconciliation.listRuns(query),
    );
  }

  @Get('runs/:id')
  @RequirePermission('api_route', 'GET /admin/reconciliation/runs/:id', 'read')
  async getRun(@Param('id') id: string): Promise<ReconRunDetail> {
    return ReconRunDetailSchema.parse(await this.reconciliation.getRun(id));
  }

  @Get('run-breaks/:id')
  @RequirePermission(
    'api_route',
    'GET /admin/reconciliation/run-breaks/:id',
    'read',
  )
  async getBreak(@Param('id') id: string): Promise<PersistedReconBreak> {
    return PersistedReconBreakSchema.parse(
      await this.reconciliation.getBreak(id),
    );
  }

  @Post('run-breaks/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'POST /admin/reconciliation/run-breaks/:id/acknowledge',
    'write',
  )
  async acknowledgeBreak(
    @Param('id') id: string,
    @Body() dto: ReconBreakActionDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<PersistedReconBreak> {
    return PersistedReconBreakSchema.parse(
      await this.actions.acknowledgeBreak(id, dto.reason, admin.adminId),
    );
  }

  @Post('run-breaks/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'POST /admin/reconciliation/run-breaks/:id/resolve',
    'write',
  )
  async resolveBreak(
    @Param('id') id: string,
    @Body() dto: ReconBreakActionDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<PersistedReconBreak> {
    return PersistedReconBreakSchema.parse(
      await this.actions.resolveBreak(id, dto.reason, admin.adminId),
    );
  }

  // ── resolve (Phase 7, WRITE — engine-brokered; step-up-gated) ────────────────────

  @Post('breaks/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'POST /admin/reconciliation/breaks/:id/resolve',
    'execute',
  )
  async resolve(
    @Param('id') id: string,
    @Body() dto: ReconResolveDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<ReconActionResponse> {
    return ReconActionResponseSchema.parse(
      await this.actions.resolve(id, dto.reason, admin.adminId),
    );
  }

  // ── accept (Phase 7, WRITE — dual-control, no debit) ─────────────────────────────

  @Post('breaks/:id/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'POST /admin/reconciliation/breaks/:id/accept',
    'write',
  )
  async accept(
    @Param('id') id: string,
    @Body() dto: ReconAcceptDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<ReconActionResponse> {
    return ReconActionResponseSchema.parse(
      await this.actions.accept(id, dto.reason, admin.adminId),
    );
  }

  // ── escalate (Phase 8, WRITE — opens a compliance case; step-up-gated) ───────────

  @Post('breaks/:id/escalate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'POST /admin/reconciliation/breaks/:id/escalate',
    'write',
  )
  async escalate(
    @Param('id') id: string,
    @Body() dto: EscalateBreakDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<ComplianceEventItem> {
    return ComplianceEventItemSchema.parse(
      await this.actions.escalate(id, dto.reason, admin.adminId),
    );
  }
}
