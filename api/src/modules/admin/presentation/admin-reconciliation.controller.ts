import { Controller, Get, UseGuards } from '@nestjs/common';

import {
  ReconBreakListResponseSchema,
  ReconStatusSchema,
  type ReconBreakListResponse,
  type ReconStatus,
} from '@handshake-agent/contracts';

import { AdminReconciliationService } from '../application/admin-reconciliation.service';
import { AdminSessionGuard } from './admin-session.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';

/**
 * Phase 6b — the admin RECONCILIATION surface (READ-ONLY): the provider-vs-ledger
 * break list + the reconciliation-cron status bar. Permissioned (default-deny via
 * PermissionGuard) under the Treasury category — reconciliation is a treasury-desk
 * oversight concern. The service never moves money (§3.1) and holds no DB
 * credentials (§3.2); responses are parsed through their contract schema before
 * leaving the boundary. The resolve/accept/escalate/run-now WRITES are Phase 7.
 */
@Controller('admin/reconciliation')
@UseGuards(AdminSessionGuard, PermissionGuard)
export class AdminReconciliationController {
  constructor(private readonly reconciliation: AdminReconciliationService) {}

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
}
