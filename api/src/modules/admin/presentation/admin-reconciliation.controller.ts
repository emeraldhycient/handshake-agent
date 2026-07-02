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
  ComplianceEventItemSchema,
  ReconActionResponseSchema,
  ReconBreakListResponseSchema,
  ReconStatusSchema,
  type ComplianceEventItem,
  type ReconActionResponse,
  type ReconBreakListResponse,
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
  ReconResolveDto,
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
